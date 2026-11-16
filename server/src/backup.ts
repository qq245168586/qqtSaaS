import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { db, rows, insert, execute, Row, now } from './db';
import { AuthRequest, User } from './auth';
import { keySchema } from './storage';
import { id, taskSchema, amounts, statuses, itemSchema } from './validation';
const tables = [
  'departments',
  'employees',
  'categories',
  'customer_categories',
  'customers',
  'products',
  'personnel',
  'tasks',
  'task_images',
  'delivery_notes',
  'delivery_note_items',
  'print_templates',
  'ai_configs',
  'settings',
  'app_meta',
] as const;
type Table = (typeof tables)[number];
const globalReferenceTables = new Set<Table>(['departments', 'employees', 'categories']);
const backupSchema = z
  .object({
    version: z.literal(2),
    company_id: id,
    exported_at: z.string(),
    tables: z.record(z.array(z.record(z.unknown())).max(20000)),
  })
  .strict();
const ddl = readFileSync(join(__dirname, 'migrations/schema.sql'), 'utf8');
const columns = new Map<string, Set<string>>();
for (const match of ddl.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE/g))
  columns.set(match[1], new Set(Array.from(match[2].matchAll(/^  `([^`]+)`/gm), (m) => m[1])));
async function snapshot(u: User, m: EntityManager): Promise<z.infer<typeof backupSchema>> {
  const data: Record<string, Row[]> = {};
  for (const t of tables)
    data[t] =
      t === 'print_templates'
        ? []
        : globalReferenceTables.has(t)
          ? await rows(`SELECT * FROM ${t} ORDER BY id`, [], m)
          : await rows(`SELECT * FROM ${t} WHERE company_id=? ORDER BY id`, [u.company_id], m);
  return { version: 2, company_id: u.company_id, exported_at: now(), tables: data };
}
export function validateBackup(raw: unknown, u: User): z.infer<typeof backupSchema> {
  const b = backupSchema.parse(raw);
  if (b.company_id !== u.company_id) throw new BadRequestException('备份公司与当前账号不符');
  if (Object.keys(b.tables).sort().join() !== [...tables].sort().join())
    throw new BadRequestException('备份表集合不完整');
  const sets = new Map<Table, Set<string>>();
  for (const t of tables) {
    const set = new Set<string>();
    for (const r of b.tables[t]) {
      id.parse(r.id);
      if (
        globalReferenceTables.has(t)
          ? r.company_id !== null && r.company_id !== undefined
          : String(r.company_id) !== u.company_id
      )
        throw new BadRequestException('备份存在跨公司记录');
      if (set.has(String(r.id))) throw new BadRequestException('备份ID重复');
      set.add(String(r.id));
      for (const [key, value] of Object.entries(r)) {
        if (!columns.get(t)?.has(key)) throw new BadRequestException('备份包含未知字段');
        if (value !== null && !['string', 'number', 'boolean', 'object'].includes(typeof value))
          throw new BadRequestException('备份包含非法字段');
        if (typeof value === 'object' && value !== null && key !== 'config_json')
          throw new BadRequestException('非JSON字段不能为对象');
        if (typeof value === 'string' && value.length > 100000)
          throw new BadRequestException('备份字段过长');
      }
    }
    sets.set(t, set);
  }
  const refs: Array<[Table, string, Table]> = [
    ['employees', 'department_id', 'departments'],
    ['tasks', 'department_id', 'departments'],
    ['tasks', 'assignee_employee_id', 'employees'],
    ['tasks', 'order_taker_employee_id', 'employees'],
    ['tasks', 'category_id', 'categories'],
    ['task_images', 'task_id', 'tasks'],
    ['customers', 'category_id', 'customer_categories'],
    ['delivery_notes', 'customer_id', 'customers'],
    ['delivery_notes', 'source_task_id', 'tasks'],
    ['delivery_note_items', 'delivery_note_id', 'delivery_notes'],
  ];
  for (const [t, key, target] of refs)
    for (const r of b.tables[t])
      if (r[key] !== null && r[key] !== undefined && !sets.get(target)?.has(String(r[key])))
        throw new BadRequestException(`备份关联缺失 ${t}.${key}`);
  for (const r of b.tables.tasks) {
    taskSchema.parse({
      title: r.title,
      order_channel: r.order_channel,
      customer_name: r.customer_name,
      product_summary: r.product_summary,
      delivery_address: r.delivery_address,
      order_amount: r.order_amount,
      delivery_fee: r.delivery_fee ?? 0,
      content: r.detail ?? '',
      source_text: r.source_text ?? '',
      category_id: r.category_id,
      department_id: r.department_id,
      assignee_employee_id: r.assignee_employee_id,
      order_taker_employee_id: r.order_taker_employee_id,
      status: r.status,
      priority: r.priority,
      task_type: r.task_type,
      expected_delivery_at: r.expected_delivery_at
        ? String(r.expected_delivery_at).slice(0, 16)
        : null,
      note: r.remark ?? '',
    });
    const e = b.tables.employees.find((v) => String(v.id) === String(r.assignee_employee_id));
    if (!e || (r.status !== 'canceled' && String(e.department_id) !== String(r.department_id)))
      throw new BadRequestException('任务部门员工不一致');
  }
  for (const r of b.tables.task_images) {
    keySchema.parse(r.oss_key);
    if (!String(r.oss_key).startsWith(`${u.company_id}/tasks/`))
      throw new BadRequestException('图片文件不属于当前公司');
  }
  for (const note of b.tables.delivery_notes) {
    const items = b.tables.delivery_note_items.filter(
      (i) => String(i.delivery_note_id) === String(note.id),
    );
    if (items.length > 5) throw new BadRequestException('送货单超过5行');
    for (const i of items)
      itemSchema.parse({
        product_name: i.product_name,
        spec: i.spec,
        unit: i.unit,
        quantity: i.quantity,
        unit_price: i.unit_price,
        remark: i.remark ?? '',
      });
    const total = amounts(
      items.map((i) => ({ quantity: String(i.quantity), unit_price: String(i.unit_price) })),
    );
    if (!note.deleted_at && total.total !== String(note.total_amount))
      throw new BadRequestException('送货单金额不一致');
  }
  const imageCounts = new Map<string, number>();
  for (const image of b.tables.task_images) {
    const key = String(image.task_id);
    imageCounts.set(key, (imageCounts.get(key) ?? 0) + 1);
  }
  if ([...imageCounts.values()].some((count) => count > 12))
    throw new BadRequestException('任务图片超过12张');
  if (b.tables.print_templates.length)
    throw new BadRequestException(
      '打印模板已全局共享，公司备份不能恢复模板；请单独导入模板或使用主机全量备份',
    );
  return b;
}
@Controller('backup')
export class BackupController {
  private boss(u: User): void {
    if (u.role !== 'boss') throw new ForbiddenException('仅老板可备份恢复');
  }
  @Get('export') async export(@Req() req: AuthRequest): Promise<z.infer<typeof backupSchema>> {
    this.boss(req.user);
    return db.transaction((m) => snapshot(req.user, m));
  }
  @Post('restore') async restore(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ): Promise<{ restored: true; safety_backup: string }> {
    this.boss(req.user);
    const { backup, confirm_company_code } = z
      .object({ backup: z.unknown(), confirm_company_code: z.string() })
      .strict()
      .parse(body);
    if (confirm_company_code !== req.user.company_code)
      throw new BadRequestException('请明确确认公司代码');
    const b = validateBackup(backup, req.user);
    const dir = process.env.BACKUP_DIR;
    if (!dir) throw new BadRequestException('服务器尚未配置 BACKUP_DIR，无法保留恢复前备份');
    const filename = `before-restore-${req.user.company_id}-${Date.now()}-${randomUUID()}.json`;
    await db.transaction(async (m) => {
      await rows('SELECT id FROM companies WHERE id=? FOR UPDATE', [req.user.company_id], m);
      for (const t of tables)
        for (const row of b.tables[t]) {
          if (globalReferenceTables.has(t)) continue;
          const conflict = await rows(
            `SELECT id FROM ${t} WHERE id=? AND company_id<>?`,
            [row.id, req.user.company_id],
            m,
          );
          if (conflict.length) throw new BadRequestException('备份ID与其他公司冲突，禁止恢复');
        }
      const users = await rows(
        'SELECT employee_id FROM users WHERE company_id=? AND employee_id IS NOT NULL AND deleted_at IS NULL',
        [req.user.company_id],
        m,
      );
      const employeeIds = new Set(b.tables.employees.map((row) => String(row.id)));
      if (users.some((user) => !employeeIds.has(String(user.employee_id))))
        throw new BadRequestException('备份缺少现有账号关联的员工，不能恢复');
      const original = await snapshot(req.user, m);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(join(dir, filename), JSON.stringify(original), { mode: 0o600, flag: 'wx' });
      // Restored snapshots are not fresh human corrections. Discard votes for replaced documents.
      await execute(
        "DELETE FROM company_choice_samples WHERE entity_type='task' AND entity_id IN (SELECT id FROM tasks WHERE company_id=?)",
        [req.user.company_id],
        m,
      );
      await execute(
        "DELETE FROM company_choice_samples WHERE entity_type='delivery' AND entity_id IN (SELECT id FROM delivery_notes WHERE company_id=?)",
        [req.user.company_id],
        m,
      );
      for (const t of [...tables].reverse())
        if (!globalReferenceTables.has(t))
          await execute(`DELETE FROM ${t} WHERE company_id=?`, [req.user.company_id], m);
      for (const t of tables)
        for (const row of b.tables[t]) {
          if (globalReferenceTables.has(t)) continue;
          const values = { ...row };
          if (columns.get(t)?.has('updated_by')) values.updated_by = req.user.id;
          if (columns.get(t)?.has('created_by')) values.created_by = req.user.id;
          if (values.config_json && typeof values.config_json !== 'string')
            values.config_json = JSON.stringify(values.config_json);
          await insert(t, values, m);
        }
    });
    return { restored: true, safety_backup: filename };
  }
}
