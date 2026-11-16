import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { EntityManager } from 'typeorm';
import { db, rows, insert, execute, Row, now } from './db';
import { AuthRequest, manager } from './auth';
import { id, pageSchema } from './validation';
import { validatePrintTemplate } from './print-template-model';
export const globalTemplateInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    is_default: z.union([z.literal(0), z.literal(1), z.boolean()]).transform(Boolean),
    config_json: z.unknown(),
  })
  .strict();
export function globalTemplateView(r: Row): Row {
  const {
    company_id: _company,
    company_code: _code,
    company_name: _name,
    global_default_slot: _slot,
    ...record
  } = r;
  const input: unknown =
    typeof r.config_json === 'string' ? JSON.parse(r.config_json) : r.config_json;
  const config = validatePrintTemplate(input);
  return {
    ...record,
    config_json: {
      ...config,
      id: String(r.id),
      name: String(r.name),
      isDefault: Boolean(r.is_default),
    },
  };
}
async function record(recordId: string, m: EntityManager = db.manager): Promise<Row> {
  id.parse(recordId);
  const [r] = await rows(
    'SELECT * FROM print_templates WHERE id=? AND deleted_at IS NULL',
    [recordId],
    m,
  );
  if (!r) throw new NotFoundException('模板不存在');
  return r;
}
/** All template writes take the same ordered company locks, including an empty template table. */
async function lockTemplates(m: EntityManager): Promise<void> {
  await rows('SELECT id FROM companies ORDER BY id FOR UPDATE', [], m);
}
async function ensureDefault(m: EntityManager): Promise<void> {
  const [selected] = await rows(
    'SELECT id FROM print_templates WHERE deleted_at IS NULL ORDER BY is_default DESC,updated_at DESC,id DESC LIMIT 1',
    [],
    m,
  );
  if (selected)
    await execute(
      'UPDATE print_templates SET is_default=1,updated_at=updated_at WHERE id=?',
      [selected.id],
      m,
    );
}
@Controller('print-templates')
export class TemplatesController {
  @Get() async list(@Req() req: AuthRequest, @Query() q: Record<string, unknown>): Promise<Row> {
    manager(req.user);
    const p = pageSchema.parse(q);
    const [count] = await rows(
      'SELECT COUNT(*) total FROM print_templates WHERE deleted_at IS NULL',
    );
    const items = await rows(
      'SELECT * FROM print_templates WHERE deleted_at IS NULL ORDER BY is_default DESC,id DESC LIMIT ? OFFSET ?',
      [p.page_size, (p.page - 1) * p.page_size],
    );
    return { items: items.map(globalTemplateView), total: Number(count.total), ...p };
  }
  @Get(':id') async get(@Req() req: AuthRequest, @Param('id') recordId: string): Promise<Row> {
    manager(req.user);
    return globalTemplateView(await record(recordId));
  }
  @Post() create(@Req() req: AuthRequest, @Body() body: unknown): Promise<Row> {
    return this.save(req, body);
  }
  @Put(':id') edit(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
    @Body() body: unknown,
  ): Promise<Row> {
    return this.save(req, body, recordId);
  }
  private async save(req: AuthRequest, body: unknown, recordId?: string): Promise<Row> {
    manager(req.user);
    const v = globalTemplateInput.parse(body);
    let config;
    try {
      config = validatePrintTemplate(v.config_json);
    } catch (error: unknown) {
      throw new BadRequestException(error instanceof Error ? error.message : '模板不合法');
    }
    const saved = await db.transaction(async (m) => {
      await lockTemplates(m);
      const old = recordId ? await record(recordId, m) : undefined;
      const useDefault = v.is_default || Boolean(old?.is_default);
      if (useDefault)
        await execute(
          'UPDATE print_templates SET is_default=0,updated_at=updated_at WHERE is_default=1',
          [],
          m,
        );
      const configText = JSON.stringify({ ...config, name: v.name, isDefault: useDefault });
      let result = recordId;
      if (result) {
        await execute(
          'UPDATE print_templates SET name=?,is_default=?,config_json=?,updated_by=? WHERE id=?',
          [v.name, useDefault ? 1 : 0, configText, req.user.id, result],
          m,
        );
      } else
        result = await insert(
          'print_templates',
          {
            company_id: null,
            name: v.name,
            is_default: useDefault ? 1 : 0,
            config_json: configText,
            created_by: req.user.id,
            updated_by: req.user.id,
          },
          m,
        );
      await ensureDefault(m);
      return result;
    });
    return globalTemplateView(await record(saved));
  }
  @Delete(':id') async remove(
    @Req() req: AuthRequest,
    @Param('id') recordId: string,
  ): Promise<null> {
    manager(req.user);
    await db.transaction(async (m) => {
      await lockTemplates(m);
      await record(recordId, m);
      await execute(
        'UPDATE print_templates SET deleted_at=?,is_default=0,updated_by=? WHERE id=?',
        [now(), req.user.id, recordId],
        m,
      );
      await ensureDefault(m);
    });
    return null;
  }
}
