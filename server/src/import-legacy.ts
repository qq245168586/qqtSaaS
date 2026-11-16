import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { statSync } from 'node:fs';
import { z } from 'zod';
import Decimal from 'decimal.js';
import sharp from 'sharp';
import { createStorage, Storage } from './storage';
import { EntityManager } from 'typeorm';
import { db, rows, insert, update, execute, Row, now } from './db';
import { amounts, minute, date, taskSchema } from './validation';
import { validatePrintTemplate } from './print-template-model';

export interface ImportOptions {
  delivery: string;
  tasks: string;
  sourceKey: string;
  execute: boolean;
  replaceDelivery?: boolean;
}
interface Source {
  db: DatabaseSync;
  tables: Set<string>;
  rows: Record<string, Row[]>;
}
export interface Report {
  mode: 'dry-run' | 'execute';
  task_company: 'tmy';
  source_key: string;
  counts: Record<string, number>;
  date_only_tasks: number;
  image_bytes: number;
  inserted: number;
  reused: number;
  skipped: number;
  removed: Record<string, number>;
  warnings: string[];
}
const deliveryTables = [
  'customer_categories',
  'customers',
  'products',
  'personnel',
  'delivery_notes',
  'print_templates',
] as const;
const taskTables = ['departments', 'employees', 'categories', 'tasks', 'task_images'] as const;
function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function timestamp(value: unknown, fallback: string): string {
  const s = text(value);
  if (!s) return fallback;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) {
    minute.parse(s.slice(0, 16));
    return s.length === 16 ? s + ':00' : s;
  }
  const parsed = new Date(s);
  if (Number.isNaN(parsed.valueOf())) throw new Error('旧记录时间无效');
  return new Date(parsed.valueOf() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}
export function legacyDue(
  value: unknown,
  note: unknown,
): { expected_delivery_at: string | null; remark: string } {
  const s = text(value).replace('T', ' ');
  if (!s) return { expected_delivery_at: null, remark: text(note) };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    date.parse(s);
    return {
      expected_delivery_at: null,
      remark: [text(note), `旧系统预计日期：${s}（具体时间待补充）`].filter(Boolean).join('\n'),
    };
  }
  return { expected_delivery_at: minute.parse(s.slice(0, 16)), remark: text(note) };
}
function money(value: unknown): string {
  const d = new Decimal(text(value) || '0');
  if (!d.isFinite() || d.isNegative() || d.gt('9999999999.99'))
    throw new Error('旧数据金额或数量超出范围');
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}
function source(path: string, allowed: readonly string[]): Source {
  statSync(path);
  const sqlite = new DatabaseSync(resolve(path), { readOnly: true });
  try {
    sqlite.exec('PRAGMA query_only=ON');
    const integrity = sqlite.prepare('PRAGMA quick_check').get();
    if (!integrity || Object.values(integrity)[0] !== 'ok') throw new Error('SQLite完整性检查失败');
    const tables = new Set(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => String(r.name)),
    );
    const result: Record<string, Row[]> = {};
    for (const t of allowed) {
      if (tables.has(t)) {
        const statement =
          t === 'task_images'
            ? 'SELECT id,task_id,file_name,created_at,length(data) file_size FROM task_images'
            : `SELECT * FROM ${t}`;
        result[t] = sqlite.prepare(statement).all() as Row[];
      } else result[t] = [];
    }
    return { db: sqlite, tables, rows: result };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
function json(value: unknown): Row {
  return z.record(z.unknown()).parse(typeof value === 'string' ? JSON.parse(value) : value);
}
async function imageData(s: Source, image: Row): Promise<Buffer> {
  const r = s.db.prepare('SELECT data FROM task_images WHERE id=?').get(Number(image.id));
  if (!(r?.data instanceof Uint8Array)) throw new Error('图片BLOB缺失');
  const data = Buffer.from(r.data);
  if (data.length > 10 * 1024 * 1024) throw new Error('旧图片超过10MiB');
  const meta = await sharp(data, { limitInputPixels: 24000000 }).metadata();
  if (meta.format !== 'png') throw new Error('旧库图片不是PNG，请先核查源数据');
  return data;
}

export async function importLegacy(options: ImportOptions): Promise<Report> {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,24}$/)
    .parse(options.sourceKey);
  const delivery = source(options.delivery, deliveryTables);
  let tasks: Source | undefined;
  const report: Report = {
    mode: options.execute ? 'execute' : 'dry-run',
    task_company: 'tmy',
    source_key: options.sourceKey,
    counts: {},
    date_only_tasks: 0,
    image_bytes: 0,
    inserted: 0,
    reused: 0,
    skipped: 0,
    removed: {},
    warnings: ['settings、API密钥和原启动密码不读取、不迁移；账号保持云端现状。'],
  };
  if (options.replaceDelivery)
    report.warnings.push(
      '权威送货库模式：事务内删除云端送货单、明细、任务关联、送货资料和旧送货迁移标记后完整重建；任务与云端全局打印模板保留。',
    );
  const uploaded: string[] = [];
  let storage: Storage | undefined;
  try {
    tasks = source(options.tasks, taskTables);
    if (!delivery.tables.has('delivery_notes') || !tasks.tables.has('tasks'))
      throw new Error('源文件不是对应的旧送货/任务数据库');
    for (const [t, list] of Object.entries(delivery.rows))
      report.counts[`delivery.${t}`] = list.length;
    for (const [t, list] of Object.entries(tasks.rows)) report.counts[`tasks.${t}`] = list.length;
    // Validate all source records and blobs before connecting to or writing cloud MySQL.
    for (const r of delivery.rows.delivery_notes) {
      z.enum(['tri', 'tmy']).parse(r.company_id);
      const p = json(r.payload);
      date.parse(p.date);
      z.string()
        .min(1)
        .max(50)
        .parse(p.number ?? r.number);
      const items = z.array(z.record(z.unknown())).max(5).parse(p.items);
      for (const i of items) {
        money(i.quantity);
        money(i.unitPrice);
      }
    }
    const departmentIds = new Set(tasks.rows.departments.map((r) => text(r.id)));
    const employeeIds = new Set(tasks.rows.employees.map((r) => text(r.id)));
    const categoryIds = new Set(tasks.rows.categories.map((r) => text(r.id)));
    const taskIds = new Set(tasks.rows.tasks.map((r) => text(r.id)));
    for (const r of tasks.rows.employees)
      if (!departmentIds.has(text(r.department_id))) throw new Error('员工部门引用缺失');
    for (const r of tasks.rows.tasks) {
      if (
        !departmentIds.has(text(r.department_id)) ||
        !employeeIds.has(text(r.assignee_id)) ||
        (r.category_id !== null &&
          r.category_id !== undefined &&
          !categoryIds.has(text(r.category_id)))
      )
        throw new Error('任务组织或分类引用缺失');
      const due = legacyDue(r.due_date, r.note);
      if (/^\d{4}-\d{2}-\d{2}$/.test(text(r.due_date))) report.date_only_tasks++;
      taskSchema.parse({
        title: r.title,
        content: r.content ?? '',
        source_text: r.source_text ?? '',
        category_id: r.category_id ? text(r.category_id) : null,
        department_id: text(r.department_id),
        assignee_employee_id: text(r.assignee_id),
        status: r.status,
        priority: r.priority,
        task_type: r.task_type,
        expected_delivery_at: due.expected_delivery_at,
        note: due.remark,
      });
    }
    const imageCounts = new Map<string, number>();
    for (const image of tasks.rows.task_images) {
      if (!taskIds.has(text(image.task_id))) throw new Error('图片任务引用缺失');
      imageCounts.set(text(image.task_id), (imageCounts.get(text(image.task_id)) ?? 0) + 1);
      await imageData(tasks, image);
      report.image_bytes += Number(image.file_size);
    }
    if ([...imageCounts.values()].some((n) => n > 12)) throw new Error('旧任务附件超过12张');
    for (const template of delivery.rows.print_templates)
      validatePrintTemplate(json(template.payload));
    if (!options.execute) {
      if (tasks.rows.task_images.length)
        report.warnings.push('图片将写入服务器私有附件目录；正式执行前核对磁盘容量与目录权限。');
      return report;
    }
    if (tasks.rows.task_images.length) storage = await createStorage();
    await db.initialize();
    const legacyTasks = tasks;
    await db.transaction(async (m) => {
      const companies = await rows(
        'SELECT id,code FROM companies WHERE code IN (?,?) ORDER BY id FOR UPDATE',
        ['tri', 'tmy'],
        m,
      );
      if (companies.length !== 2) throw new Error('请先初始化tri/tmy公司');
      if (options.replaceDelivery) {
        const [existing] = await rows(
          `SELECT
            (SELECT COUNT(*) FROM delivery_note_items) delivery_note_items,
            (SELECT COUNT(*) FROM delivery_notes) delivery_notes,
            (SELECT COUNT(*) FROM customers) customers,
            (SELECT COUNT(*) FROM products) products,
            (SELECT COUNT(*) FROM personnel) personnel,
            (SELECT COUNT(*) FROM customer_categories) customer_categories,
            (SELECT COUNT(*) FROM company_choice_samples WHERE entity_type='delivery') company_choice_samples`,
          [],
          m,
        );
        for (const [key, value] of Object.entries(existing)) report.removed[key] = Number(value);
        await execute("DELETE FROM company_choice_samples WHERE entity_type='delivery'", [], m);
        await execute('DELETE FROM delivery_note_items', [], m);
        await execute('DELETE FROM delivery_notes', [], m);
        await execute('DELETE FROM customers', [], m);
        await execute('DELETE FROM products', [], m);
        await execute('DELETE FROM personnel', [], m);
        await execute('DELETE FROM customer_categories', [], m);
        await execute(
          "DELETE FROM app_meta WHERE meta_key LIKE ? AND meta_key NOT LIKE '%:print_templates:%'",
          [`legacy:${options.sourceKey}:delivery:%`],
          m,
        );
      }
      const company = (code: unknown): string => {
        const c = companies.find((v) => v.code === code);
        if (!c) throw new Error('来源公司无效');
        return text(c.id);
      };
      const markerCompany = text(companies[0].id);
      const markerKey = `legacy:${options.sourceKey}:started-at`;
      const [marker] = await rows(
        'SELECT meta_value FROM app_meta WHERE company_id=? AND meta_key=?',
        [markerCompany, markerKey],
        m,
      );
      const migrationTime = marker ? text(marker.meta_value) : now();
      if (!marker)
        await insert(
          'app_meta',
          { company_id: markerCompany, meta_key: markerKey, meta_value: migrationTime },
          m,
        );
      const mapping = new Map<string, string>();
      const mapped = async (
        table: string,
        oldId: unknown,
        companyId: string,
        values: Row,
        natural?: Row,
        sourceTag = 'delivery',
      ): Promise<string> => {
        const old = text(oldId);
        const key = `legacy:${options.sourceKey}:${sourceTag}:${table}:${digest(old).slice(0, 24)}`;
        const fingerprint = digest(values);
        const [saved] = await rows(
          'SELECT meta_value FROM app_meta WHERE company_id=? AND meta_key=?',
          [companyId, key],
          m,
        );
        if (saved) {
          const prior = json(saved.meta_value);
          if (prior.hash !== fingerprint)
            throw new Error(`已迁移源记录发生变化：${sourceTag}.${table}；禁止覆盖，请人工核查`);
          report.skipped++;
          mapping.set(`${sourceTag}:${table}:${companyId}:${old}`, text(prior.id));
          return text(prior.id);
        }
        let target: string | undefined;
        if (natural) {
          const globalDirectory = ['departments', 'employees'].includes(table);
          const fields = Object.keys(natural);
          const found = await rows(
            `SELECT * FROM ${table} WHERE ${globalDirectory ? '' : 'company_id=? AND '}${fields.map((k) => `\`${k}\` <=> ?`).join(' AND ')}`,
            [...(globalDirectory ? [] : [companyId]), ...Object.values(natural)],
            m,
          );
          if (found.length) {
            if (table === 'delivery_notes')
              throw new Error('已有相同历史单号但无迁移标记，拒绝覆盖');
            if (!['departments', 'categories', 'customer_categories'].includes(table))
              throw new Error(`现有${table}同名资料无本次迁移标记，拒绝覆盖`);
            target = text(found[0].id);
            if (table !== 'departments') await update(table, target, companyId, values, m);
            report.reused++;
          }
        }
        if (!target) {
          const stored =
            table === 'print_templates'
              ? {
                  ...values,
                  company_id: null,
                  is_default: 0,
                  config_json: JSON.stringify(validatePrintTemplate(json(values.config_json))),
                }
              : {
                  ...values,
                  company_id: ['departments', 'employees'].includes(table) ? null : companyId,
                };
          target = await insert(table, stored, m);
          report.inserted++;
        }
        await insert(
          'app_meta',
          {
            company_id: companyId,
            meta_key: key,
            meta_value: JSON.stringify({
              id: target,
              hash: fingerprint,
              old_id: old,
              source: sourceTag,
            }),
          },
          m,
        );
        mapping.set(`${sourceTag}:${table}:${companyId}:${old}`, target);
        return target;
      };
      const ref = (table: string, oldId: unknown, companyId: string, tag = 'delivery'): string => {
        const result = mapping.get(`${tag}:${table}:${companyId}:${text(oldId)}`);
        if (!result) throw new Error(`映射缺失：${tag}.${table}`);
        return result;
      };
      const categoryNames = new Map<string, string>();
      for (const r of delivery.rows.customer_categories) {
        const c = company(r.company_id);
        const name = z.string().min(1).max(50).parse(r.name);
        const target = await mapped(
          'customer_categories',
          r.id,
          c,
          {
            name,
            created_at: timestamp(r.created_at, migrationTime),
            updated_at: timestamp(r.updated_at, migrationTime),
            deleted_at: Number(r.active) === 0 ? timestamp(r.updated_at, migrationTime) : null,
          },
          { name },
        );
        categoryNames.set(`${c}:${name}`, target);
      }
      for (const r of delivery.rows.customers) {
        const c = company(r.company_id);
        const name = text(r.name);
        const cat = text(r.category) || '未分类';
        let categoryId = categoryNames.get(`${c}:${cat}`);
        if (!categoryId) {
          categoryId = await mapped(
            'customer_categories',
            `derived:${cat}`,
            c,
            { name: cat },
            { name: cat },
          );
          categoryNames.set(`${c}:${cat}`, categoryId);
        }
        await mapped(
          'customers',
          r.id,
          c,
          {
            name,
            code: r.code ?? null,
            address: r.address ?? null,
            contact: r.contact ?? null,
            phone: r.phone ?? null,
            category_id: categoryId,
            active: Number(r.active ?? 1),
            created_at: timestamp(r.updated_at, migrationTime),
            updated_at: timestamp(r.updated_at, migrationTime),
          },
          { name },
        );
      }
      for (const r of delivery.rows.products) {
        const c = company(r.company_id);
        const name = text(r.name),
          spec = text(r.specification);
        await mapped(
          'products',
          r.id,
          c,
          {
            name,
            spec,
            unit: text(r.unit),
            default_price: money(r.default_price),
            active: Number(r.active ?? 1),
            updated_at: timestamp(r.updated_at, migrationTime),
          },
          { name, spec },
        );
      }
      for (const r of delivery.rows.personnel) {
        const c = company(r.company_id);
        const name = text(r.name);
        await mapped(
          'personnel',
          r.id,
          c,
          {
            name,
            role_type: 'general',
            last_used_at: r.last_used_at ? timestamp(r.last_used_at, migrationTime) : null,
            created_at: timestamp(r.created_at, migrationTime),
            updated_at: timestamp(r.updated_at, migrationTime),
            deleted_at: Number(r.active) === 0 ? timestamp(r.updated_at, migrationTime) : null,
          },
          { name },
        );
      }
      for (const r of delivery.rows.delivery_notes) {
        const c = company(r.company_id);
        const p = json(r.payload);
        const items = z.array(z.record(z.unknown())).parse(p.items);
        const normalized = items.map((i) => ({
          product_name: text(i.name),
          spec: text(i.specification),
          unit: text(i.unit),
          quantity: money(i.quantity),
          unit_price: money(i.unitPrice),
          remark: text(i.remark),
        }));
        const totals = amounts(normalized);
        const customerName = text(p.customerName);
        const [customer] = await rows(
          'SELECT id FROM customers WHERE company_id=? AND name=?',
          [c, customerName],
          m,
        );
        const recordId = await mapped(
          'delivery_notes',
          r.id,
          c,
          {
            note_number: text(p.number ?? r.number),
            delivery_date: text(p.date),
            customer_id: customer?.id ?? null,
            customer_name_snapshot: customerName,
            customer_address_snapshot: text(p.customerAddress),
            customer_phone_snapshot: text(p.customerPhone),
            maker_name: text(p.maker),
            warehouse_name: text(p.keeper),
            sales_name: text(p.salesperson),
            deliverer_name: text(p.deliveryPerson),
            total_amount: totals.total,
            is_draft: 0,
            printed_at: p.printedAt ? timestamp(p.printedAt, migrationTime) : null,
            source_number: p.sourceNumber ?? null,
            page: Number(p.page ?? 1),
            total_pages: Number(p.totalPages ?? 1),
            created_at: timestamp(p.createdAt ?? r.updated_at, migrationTime),
            updated_at: timestamp(r.updated_at, migrationTime),
          },
          { note_number: text(p.number ?? r.number) },
        );
        for (const [index, item] of normalized.entries())
          await mapped('delivery_note_items', `${r.id}:${index}`, c, {
            ...item,
            delivery_note_id: recordId,
            amount: totals.lines[index],
            sort: index + 1,
          });
      }
      for (const r of options.replaceDelivery ? [] : delivery.rows.print_templates) {
        const c = company(r.company_id);
        const template = validatePrintTemplate(json(r.payload));
        await mapped(
          'print_templates',
          r.id,
          c,
          {
            name: text(r.name),
            is_default: Number(r.is_default ?? 0),
            // Preserve the original fingerprint shape for repeat imports after the global-template migration.
            config_json: JSON.stringify({
              version: template.version,
              id: template.id,
              companyId: json(r.payload).companyId,
              ...Object.fromEntries(
                Object.entries(template).filter(([key]) => !['version', 'id'].includes(key)),
              ),
            }),
            updated_at: timestamp(r.updated_at, migrationTime),
          },
          { name: text(r.name) },
        );
      }
      await rows('SELECT id FROM companies ORDER BY id FOR UPDATE', [], m);
      const [globalDefault] = await rows(
        'SELECT id FROM print_templates WHERE deleted_at IS NULL ORDER BY is_default DESC,updated_at DESC,id DESC LIMIT 1',
        [],
        m,
      );
      if (globalDefault)
        await execute(
          'UPDATE print_templates SET is_default=1,updated_at=updated_at WHERE id=?',
          [globalDefault.id],
          m,
        );
      const c = company('tmy');
      for (const table of ['departments', 'categories'] as const)
        for (const r of legacyTasks.rows[table]) {
          const name = text(r.name);
          await mapped(
            table,
            r.id,
            c,
            {
              name,
              sort: Number(r.sort ?? 0),
              created_at: timestamp(r.created_at, migrationTime),
              deleted_at: r.deleted_at ? timestamp(r.deleted_at, migrationTime) : null,
            },
            { name },
            'tasks',
          );
        }
      for (const r of legacyTasks.rows.employees)
        await mapped(
          'employees',
          r.id,
          c,
          {
            name: text(r.name),
            department_id: ref('departments', r.department_id, c, 'tasks'),
            status: Number(r.active) === 0 ? 'left' : 'active',
            created_at: timestamp(r.created_at, migrationTime),
            deleted_at: r.deleted_at ? timestamp(r.deleted_at, migrationTime) : null,
          },
          undefined,
          'tasks',
        );
      for (const r of legacyTasks.rows.tasks) {
        const due = legacyDue(r.due_date, r.note);
        await mapped(
          'tasks',
          r.id,
          c,
          {
            title: text(r.title),
            detail: text(r.content),
            source_text: text(r.source_text),
            category_id: r.category_id ? ref('categories', r.category_id, c, 'tasks') : null,
            department_id: ref('departments', r.department_id, c, 'tasks'),
            assignee_employee_id: ref('employees', r.assignee_id, c, 'tasks'),
            status: r.status,
            priority: r.priority,
            task_type: r.task_type,
            ...due,
            created_at: timestamp(r.created_at, migrationTime),
            updated_at: timestamp(r.updated_at, migrationTime),
          },
          undefined,
          'tasks',
        );
      }
      for (const r of legacyTasks.rows.task_images) {
        const data = await imageData(legacyTasks, r);
        const taskId = ref('tasks', r.task_id, c, 'tasks');
        const imageHash = digest({
          source: options.sourceKey,
          id: r.id,
          data: createHash('sha256').update(data).digest('hex'),
        });
        const imageUuid = `${imageHash.slice(0, 8)}-${imageHash.slice(8, 12)}-${imageHash.slice(12, 16)}-${imageHash.slice(16, 20)}-${imageHash.slice(20, 32)}`;
        const stableKey = `${c}/tasks/${taskId}/${imageUuid}.png`;
        const mapKey = `legacy:${options.sourceKey}:tasks:task_images:${digest(text(r.id)).slice(0, 24)}`;
        const previous = await rows(
          'SELECT id FROM app_meta WHERE company_id=? AND meta_key=?',
          [c, mapKey],
          m,
        );
        if (!previous.length) {
          if (!storage) throw new Error('附件存储不可用');
          const written = await storage.put(stableKey, data);
          if (written.created) uploaded.push(stableKey);
        }
        await mapped(
          'task_images',
          r.id,
          c,
          {
            task_id: taskId,
            oss_key: stableKey,
            oss_url: `disk://${stableKey}`,
            file_name: text(r.file_name),
            file_size: data.length,
            mime_type: 'image/png',
            sort: 0,
            created_at: timestamp(r.created_at, migrationTime),
          },
          undefined,
          'tasks',
        );
      }
    });
    return report;
  } catch (error: unknown) {
    const cleanupFailed: string[] = [];
    if (storage)
      for (const key of uploaded)
        try {
          await storage.delete(key);
        } catch {
          cleanupFailed.push(key);
        }
    if (cleanupFailed.length)
      throw new Error(
        `迁移失败且${cleanupFailed.length}个本次新建附件清理失败，请根据迁移记录人工核查；原事务已回滚。`,
      );
    throw error;
  } finally {
    delivery.db.close();
    tasks?.db.close();
    if (db.isInitialized) await db.destroy();
  }
}

if (require.main === module) {
  const { values } = parseArgs({
    options: {
      delivery: { type: 'string' },
      tasks: { type: 'string' },
      'source-key': { type: 'string', default: 'initial-v1' },
      execute: { type: 'boolean', default: false },
      'replace-delivery': { type: 'boolean', default: false },
    },
  });
  if (!values.delivery || !values.tasks) {
    console.error(
      '用法 node dist/import-legacy.js --delivery <只读送货快照> --tasks <只读任务快照> [--source-key initial-v1] [--replace-delivery] [--execute]',
    );
    process.exitCode = 1;
  } else
    void importLegacy({
      delivery: values.delivery,
      tasks: values.tasks,
      sourceKey: values['source-key'] ?? 'initial-v1',
      execute: values.execute ?? false,
      replaceDelivery: values['replace-delivery'] ?? false,
    })
      .then((report) => console.log(JSON.stringify(report, null, 2)))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : '迁移失败');
        process.exitCode = 1;
      });
}
