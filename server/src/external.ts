import { AiErrorCode, AiRequestError, aiFieldHint } from './ai-errors';
import { normalizeTodoDraft } from './ai-assistant';
import { suggestCompany } from './company-learning';
import { companyFilter } from './company-scope';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { createStorage, Storage } from './storage';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { db, rows, insert, execute, update, Row, now } from './db';
import { explicitRetailDetails, retailDetailsPrompt } from './retail-details';
import { AuthRequest, manager } from './auth';
import { taskRecord } from './tasks';
import {
  aiDraftSchema,
  aiSystemPrompt,
  matchCategoryCatalog,
  matchDepartmentCatalog,
  mergeOrderLineItems,
} from './ai-draft';
import { normalizeAiExpectedDelivery } from './ai-time';
import { suggestAssignee } from './assignee-learning';
import {
  aiConfigInput,
  aiConfigView,
  resolveAiConfig,
  saveAiConfig,
  type AiRuntimeConfig,
} from './ai-config';
import { WebPasswordGate } from './public-access';
import {
  assistantForClient,
  assistantInput,
  assistantModelResponse,
  assistantSystemPrompt,
  checkAssistantScope,
  assistantDate,
  matchAssistantEmployee,
  explicitAssistantCompany,
} from './ai-assistant';
import { employeeAvailable } from './employee-policy';
import { orderChannels } from './order-channels';
async function storage(): Promise<Storage> {
  try {
    return await createStorage();
  } catch {
    throw new ServiceUnavailableException('服务器附件目录不可用');
  }
}
function imageView(r: Row, client: Storage): Row {
  return {
    ...r,
    url: client.signatureUrl(String(r.oss_key)),
    thumbnail_url: client.signatureUrl(String(r.oss_key), 'thumbnail'),
  };
}
@Controller('tasks')
export class ImagesController {
  @Get(':id/images') async list(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
  ): Promise<Row> {
    const task = await taskRecord(recordId, req.user);
    const images = await rows(
      'SELECT * FROM task_images WHERE company_id=? AND task_id=? ORDER BY sort,id',
      [task.company_id, recordId],
    );
    return {
      items: images.length
        ? await Promise.all(images.map(async (r) => imageView(r, await storage())))
        : [],
      total: images.length,
      page: 1,
      page_size: 12,
    };
  }
  @Post(':id/images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async upload(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<Row> {
    manager(req.user);
    if (!file) throw new BadRequestException('请选择图片');
    const client = await storage();
    let png: Buffer;
    try {
      const meta = await sharp(file.buffer, {
        limitInputPixels: 24000000,
        animated: false,
      }).metadata();
      if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1)
        throw new Error('format');
      png = await sharp(file.buffer, { limitInputPixels: 24000000 }).rotate().png().toBuffer();
    } catch {
      throw new BadRequestException('图片必须为 PNG/JPEG/WebP 且不超过 2400 万像素');
    }
    if (png.length > 10 * 1024 * 1024) throw new BadRequestException('转换后图片超过 10 MiB');
    let key = '';
    let companyId = req.user.company_id;
    let uploaded = false;
    let committed = false;
    try {
      const imageId = await db.transaction(async (m) => {
        const task = await taskRecord(recordId, req.user, m, true);
        companyId = String(task.company_id);
        key = `${companyId}/tasks/${recordId}/${randomUUID()}.png`;
        const [count] = await rows(
          'SELECT COUNT(*) total FROM task_images WHERE company_id=? AND task_id=?',
          [companyId, recordId],
          m,
        );
        if (Number(count.total) >= 12) throw new BadRequestException('每任务最多 12 张图片');
        const result = await client.put(key, png);
        uploaded = result.created;
        return insert(
          'task_images',
          {
            company_id: companyId,
            task_id: recordId,
            oss_key: key,
            oss_url: `disk://${key}`,
            file_name: file.originalname.slice(0, 255),
            file_size: png.length,
            mime_type: 'image/png',
            sort: Number(count.total),
          },
          m,
        );
      });
      committed = true;
      const [image] = await rows('SELECT * FROM task_images WHERE id=? AND company_id=?', [
        imageId,
        companyId,
      ]);
      return imageView(image, client);
    } catch (error: unknown) {
      if (uploaded && !committed) await client.delete(key).catch(() => undefined);
      throw error;
    }
  }
  @Delete('images/:imageId') async remove(
    @Req() req: AuthRequest,
    @Param('imageId') imageId: string,
  ): Promise<null> {
    manager(req.user);
    const client = await storage();
    const removed: { entry?: { key: string; data: Buffer } } = {};
    try {
      await db.transaction(async (m) => {
        const [r] = await rows(
          `SELECT * FROM task_images WHERE id=? AND ${companyFilter(req.user).sql} FOR UPDATE`,
          [imageId, ...companyFilter(req.user).params],
          m,
        );
        if (!r) throw new BadRequestException('图片不存在');
        await taskRecord(String(r.task_id), req.user, m);
        const key = String(r.oss_key);
        const data = await client.read(key);
        await client.delete(key);
        removed.entry = { key, data };
        await execute(
          'DELETE FROM task_images WHERE id=? AND company_id=?',
          [imageId, r.company_id],
          m,
        );
      });
    } catch (error: unknown) {
      if (removed.entry) await client.put(removed.entry.key, removed.entry.data);
      throw error;
    }
    return null;
  }
}
export async function aiCompletion(
  config: AiRuntimeConfig,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  json: boolean,
): Promise<string> {
  const url = new URL(`${config.api_base_url}/chat/completions`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model_name,
        temperature: 0.1,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages,
      }),
      signal: AbortSignal.timeout(60000),
      redirect: 'error',
    });
  } catch (error) {
    const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
    throw new AiRequestError(
      timeout ? AiErrorCode.Timeout : AiErrorCode.Network,
      'provider',
      timeout
        ? 'AI 响应超时，请稍后重试或将内容分批识别。'
        : '服务器无法连接 AI 服务，请稍后重试。',
      503,
    );
  }
  if (!response.ok) {
    if (response.status === 429)
      throw new AiRequestError(
        AiErrorCode.RateLimit,
        'provider',
        'AI 服务请求过于频繁或额度不足，请稍后重试或检查服务额度。',
        503,
      );
    if ([401, 403].includes(response.status))
      throw new AiRequestError(
        AiErrorCode.Authentication,
        'provider',
        'AI 服务密钥无效或没有访问权限，请在设置中检查 AI 模型配置。',
        503,
      );
    throw new AiRequestError(
      AiErrorCode.Unavailable,
      'provider',
      'AI 服务暂时不可用，请稍后重试；持续失败时请检查模型配置。',
      503,
    );
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new AiRequestError(
      AiErrorCode.Json,
      'provider',
      'AI 服务返回了无法读取的结果，请重新识别。',
    );
  }
  const result = z
    .object({
      choices: z
        .array(z.object({ message: z.object({ content: z.string().trim().min(1).max(1000000) }) }))
        .min(1),
    })
    .safeParse(raw);
  if (!result.success)
    throw new AiRequestError(
      AiErrorCode.Fields,
      'provider',
      'AI 服务没有返回有效的识别内容，请重新识别或检查模型配置。',
      502,
      result.error.issues,
    );
  return result.data.choices[0].message.content;
}

@Controller('ai')
export class AiController {
  @Post('retail-details/:id') async repairRetailDetails(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
  ): Promise<Row> {
    manager(req.user);
    const old = await taskRecord(recordId, req.user);
    const source = [old.source_text, old.detail, old.title, old.remark].filter(Boolean).join('\n');
    const raw = await aiCompletion(
      await resolveAiConfig(String(old.company_id)),
      [
        { role: 'system', content: retailDetailsPrompt },
        { role: 'user', content: source },
      ],
      true,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gu, ''));
    } catch {
      throw new BadRequestException('AI返回格式无效，请重试');
    }
    const result = z
      .object({
        product_summary: z.string().trim().max(500),
        delivery_address: z.string().trim().max(500),
      })
      .strict()
      .parse(parsed);
    const explicit = explicitRetailDetails(source);
    await db.transaction(async (m) => {
      const current = await taskRecord(recordId, req.user, m, true);
      if (
        ['source_text', 'detail', 'title', 'remark', 'product_summary', 'delivery_address'].some(
          (key) => current[key] !== old[key],
        )
      )
        throw new BadRequestException('订单已被修改，请刷新后重试');
      await update(
        'tasks',
        recordId,
        String(old.company_id),
        {
          product_summary:
            current.product_summary || result.product_summary || explicit.product_summary || null,
          delivery_address:
            current.delivery_address ||
            explicit.delivery_address ||
            result.delivery_address ||
            null,
          updated_by: req.user.id,
        },
        m,
      );
    });
    return {
      product_summary: old.product_summary || result.product_summary || explicit.product_summary,
      delivery_address:
        old.delivery_address || explicit.delivery_address || result.delivery_address,
    };
  }
  private readonly configGate = new WebPasswordGate();

  private protectConfig(req: AuthRequest, password: string | undefined): void {
    if (req.user.public_access)
      this.configGate.check('web', password, req.ip ?? req.socket.remoteAddress ?? 'unknown');
  }

  @Get('config') async config(@Req() req: AuthRequest): Promise<Row> {
    manager(req.user);
    return aiConfigView(req.user.company_id);
  }

  @Put('config') async saveConfig(@Req() req: AuthRequest, @Body() body: unknown): Promise<Row> {
    manager(req.user);
    const input = aiConfigInput.parse(body);
    this.protectConfig(req, input.admin_password);
    await saveAiConfig(req.user, input);
    return aiConfigView(req.user.company_id);
  }

  @Post('config/test') async testConfig(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ): Promise<{ available: true }> {
    manager(req.user);
    const input = z
      .object({ admin_password: z.string().max(1024).optional() })
      .strict()
      .parse(body);
    this.protectConfig(req, input.admin_password);
    await aiCompletion(
      await resolveAiConfig(req.user.company_id),
      [{ role: 'user', content: '只回复 OK' }],
      false,
    );
    return { available: true };
  }

  @Post('assistant/parse') async assistant(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ): Promise<Row> {
    manager(req.user);
    const parsedInput = assistantInput.safeParse(body);
    if (!parsedInput.success)
      throw new AiRequestError(
        AiErrorCode.Input,
        'input',
        '识别内容为空、过长或模块选项无效，请检查输入后重试。',
        400,
        parsedInput.error.issues,
      );
    const input = parsedInput.data;
    const scope = companyFilter(req.user);
    const [departments, categories, employees, customers] = await Promise.all([
      rows('SELECT id,name FROM departments WHERE deleted_at IS NULL ORDER BY sort,id'),
      rows('SELECT id,name FROM categories WHERE deleted_at IS NULL ORDER BY sort,id'),
      rows(
        'SELECT id,name,department_id,status,left_on,deleted_at FROM employees WHERE deleted_at IS NULL',
      ),
      rows(
        `SELECT id,name,address,phone,(SELECT code FROM companies WHERE id=customers.company_id) company_code FROM customers WHERE ${scope.sql} AND deleted_at IS NULL`,
        scope.params,
      ),
    ]);
    const currentTime = now();
    let config: AiRuntimeConfig;
    try {
      config = await resolveAiConfig(req.user.company_id);
    } catch {
      throw new AiRequestError(
        AiErrorCode.Configuration,
        'configuration',
        'AI 配置读取失败或尚未完整配置，请在设置中检查模型地址、名称和密钥。',
        503,
      );
    }
    const content = await aiCompletion(
      config,
      [
        {
          role: 'system',
          content: assistantSystemPrompt(
            currentTime,
            input.module,
            departments,
            categories,
            employees,
          ),
        },
        { role: 'user', content: input.text },
      ],
      true,
    );
    let json: unknown;
    try {
      json = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/gu, ''));
    } catch {
      throw new AiRequestError(
        AiErrorCode.Json,
        'validation',
        'AI 返回的内容无法解析，请重新识别或将多件事项分开输入。',
      );
    }
    const parsedResult = assistantModelResponse.safeParse(json);
    if (!parsedResult.success)
      throw new AiRequestError(
        AiErrorCode.Fields,
        'validation',
        aiFieldHint(parsedResult.error.issues),
        502,
        parsedResult.error.issues,
      );
    let result = parsedResult.data;
    try {
      checkAssistantScope(result, input);
    } catch (e) {
      throw new AiRequestError(
        AiErrorCode.Scope,
        'validation',
        e instanceof Error ? e.message : '识别结果与所选模块或原文不一致，请重新识别。',
        422,
      );
    }
    const compatible = assistantForClient(result, input.supported_modules);
    if (result.items.length && !compatible.items.length)
      throw new AiRequestError(AiErrorCode.Client, 'compatibility', compatible.clarification, 409);
    result = compatible;
    if (result.items.length > 1 && result.items.every((item) => item.module === 'retail')) {
      const first = result.items[0];
      const merged = mergeOrderLineItems(
        result.items.flatMap((item) => (item.module === 'retail' ? [item.value] : [])),
        input.text,
      );
      if (merged.length === 1 && first.module === 'retail')
        result.items = [
          { ...first, source_excerpt: input.text, value: { ...first.value, ...merged[0] } },
        ];
    }
    const items: Row[] = [];
    for (const item of result.items) {
      const warnings: string[] = [];
      const source = item.source_excerpt;
      if (item.module === 'todo') {
        const value = normalizeTodoDraft(item.value, source, currentTime);
        if (!value.ends_at) warnings.push('请补充待办截止时间');
        if (value.starts_at && value.ends_at && value.ends_at < value.starts_at)
          warnings.push('截止时间早于开始时间，请核对');
        items.push({ module: 'todo', source_text: source, warnings, value });
        continue;
      }
      if (item.module === 'schedule') {
        const value = item.value;
        const date = assistantDate(source, value.work_date, currentTime);
        const employeeId =
          value.employee_name.trim() && source.includes(value.employee_name.trim())
            ? matchAssistantEmployee(
                employees,
                value.employee_name,
                date ?? currentTime.slice(0, 10),
              )
            : null;
        if (!date) warnings.push('原文缺少日期，请填写排班日期');
        if (!employeeId) warnings.push('员工未知、重名或该日期已离职，请重新选择员工');
        if (value.shift_kind === 'rest' && value.timeoff_minutes)
          warnings.push('例休不扣调休小时，已清除调休时长');
        items.push({
          module: 'schedule',
          source_text: source,
          warnings,
          value: {
            ...value,
            employee_id: employeeId,
            work_date: date,
            start_time: value.shift_kind === 'work' ? (value.start_time ?? '08:00') : null,
            overtime_minutes: value.shift_kind === 'comp_leave' ? 0 : value.overtime_minutes,
            timeoff_minutes:
              value.shift_kind === 'rest'
                ? 0
                : value.shift_kind === 'comp_leave'
                  ? value.timeoff_minutes || 480
                  : value.timeoff_minutes,
          },
        });
        continue;
      }
      const suggestion = await suggestCompany(source);
      const company = explicitAssistantCompany(source) ?? suggestion.company_code;
      if (!req.user.public_access && company !== req.user.company_code)
        throw new BadRequestException('当前账户不能创建其他公司的记录');
      if (item.module === 'retail') {
        const recovered = explicitRetailDetails(item.source_excerpt);
        item.value.delivery_address ||= recovered.delivery_address;
        item.value.product_summary ||= recovered.product_summary;
        const { category_name, department_name, employee_name, order_taker_name, ...value } =
          item.value;
        const date = normalizeAiExpectedDelivery(source, value.expected_delivery_at, currentTime);
        const departmentId = matchDepartmentCatalog(departments, department_name, source);
        const explicitEmployee = !!employee_name.trim() && source.includes(employee_name.trim());
        const named = explicitEmployee
          ? matchAssistantEmployee(
              employees,
              employee_name,
              date?.slice(0, 10) ?? currentTime.slice(0, 10),
            )
          : null;
        const employee = employees.find((e) => String(e.id) === named);
        const finalDepartment = employee ? String(employee.department_id) : departmentId;
        const assignee = explicitEmployee
          ? named
          : finalDepartment
            ? (
                await suggestAssignee(
                  req.user,
                  finalDepartment,
                  source,
                  db.manager,
                  date?.slice(0, 10) ?? currentTime.slice(0, 10),
                )
              ).employee_id
            : null;
        const orderTaker =
          order_taker_name.trim() && source.includes(order_taker_name.trim())
            ? matchAssistantEmployee(
                employees,
                order_taker_name,
                date?.slice(0, 10) ?? currentTime.slice(0, 10),
              )
            : null;
        if (!date) warnings.push('原文缺少交付日期，填写后才能创建');
        if (!assignee) warnings.push('请核对部门并选择执行人');
        if (!value.product_summary.trim()) warnings.push('请填写订单中的实际商品名称');
        if (!orderTaker) warnings.push('请选择接单人');
        const channels = await orderChannels(req.user);
        items.push({
          module: 'retail',
          source_text: source,
          warnings,
          value: {
            ...value,
            company_code: company,
            company_match: suggestion.company_match,
            source_text: source,
            order_channel: value.order_channel || channels.default_channel,
            delivery_fee: value.delivery_fee ?? 0,
            category_id: matchCategoryCatalog(categories, category_name, company, source),
            department_id: finalDepartment,
            assignee_employee_id: assignee,
            order_taker_employee_id: orderTaker,
            expected_delivery_at: date,
          },
        });
      } else {
        const value = item.value;
        const date = assistantDate(source, value.delivery_date, currentTime);
        const matches = customers.filter(
          (c) => c.company_code === company && c.name === value.customer_name_snapshot,
        );
        const customer = matches.length === 1 ? matches[0] : undefined;
        if (!date) warnings.push('原文缺少送货日期，请填写后创建');
        if (value.items.length > 5) warnings.push('单张送货单最多5行，请在填写页调整明细');
        if (value.items.some((line) => line.quantity == null || line.unit_price == null))
          warnings.push('存在缺失数量或单价，请逐行补齐');
        const names = {
          maker_name: value.maker_name,
          warehouse_name: value.warehouse_name,
          sales_name: value.sales_name,
          deliverer_name: value.deliverer_name,
        };
        for (const field of Object.keys(names) as (keyof typeof names)[]) {
          const person = employees.find((e) => e.name === names[field]);
          if (person && !employeeAvailable(person, date ?? currentTime.slice(0, 10))) {
            names[field] = '';
            warnings.push('原文人员在该日期已离职，请重新选择');
          }
        }
        items.push({
          module: 'delivery',
          source_text: source,
          warnings,
          value: {
            ...value,
            ...names,
            company_code: company,
            delivery_date: date ?? '',
            customer_id: customer ? String(customer.id) : null,
            customer_address_snapshot:
              value.customer_address_snapshot || String(customer?.address ?? ''),
            customer_phone_snapshot: value.customer_phone_snapshot || String(customer?.phone ?? ''),
            is_draft: false,
            items: value.items.map((line) => ({
              ...line,
              unit: line.unit || '个',
              quantity: line.quantity ?? '',
              unit_price: line.unit_price ?? '',
            })),
          },
        });
      }
    }
    return { items, clarification: result.clarification };
  }

  @Post('parse') async parse(@Req() req: AuthRequest, @Body() body: unknown): Promise<Row> {
    manager(req.user);
    const { text } = z
      .object({ text: z.string().trim().min(1).max(50000) })
      .strict()
      .parse(body);
    const departments = await rows(
      'SELECT id,name FROM departments WHERE deleted_at IS NULL ORDER BY sort,id',
    );
    const categories = await rows(
      'SELECT id,name FROM categories WHERE deleted_at IS NULL ORDER BY sort,id',
    );
    const currentTime = now();
    const content = await aiCompletion(
      await resolveAiConfig(req.user.company_id),
      [
        { role: 'system', content: aiSystemPrompt(currentTime, departments, categories) },
        { role: 'user', content: text },
      ],
      true,
    );
    let json: unknown;
    try {
      json = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/gu, ''));
    } catch {
      throw new BadRequestException('AI 返回的不是合法 JSON');
    }
    const result = z.object({ items: z.array(aiDraftSchema).min(1).max(100) }).parse(json);
    const normalized = mergeOrderLineItems(result.items, text);
    return {
      items: await Promise.all(
        normalized.map(async ({ category_name, department_name, ...fields }) => {
          const suggestion = await suggestCompany(`${fields.title} ${fields.content}`);
          const details = `${fields.title} ${fields.content} ${fields.note}`;
          const categoryId = matchCategoryCatalog(
            categories,
            category_name,
            suggestion.company_code,
            details,
          );
          const departmentId = matchDepartmentCatalog(departments, department_name, details);
          return {
            ...suggestion,
            ...fields,
            expected_delivery_at: normalizeAiExpectedDelivery(
              details,
              fields.expected_delivery_at,
              currentTime,
            ),
            source_text: text,
            category_id: categoryId,
            department_id: departmentId,
            assignee_employee_id: departmentId
              ? (
                  await suggestAssignee(
                    req.user,
                    departmentId,
                    details,
                    db.manager,
                    normalizeAiExpectedDelivery(
                      details,
                      fields.expected_delivery_at,
                      currentTime,
                    )?.slice(0, 10) ?? currentTime.slice(0, 10),
                  )
                ).employee_id
              : null,
          };
        }),
      ),
    };
  }
}
