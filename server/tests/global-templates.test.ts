import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrintTemplate, validatePrintTemplate } from '../src/print-template-model';
import { globalTemplateInput, globalTemplateView } from '../src/templates';
import { GlobalTemplates1790091000000 } from '../src/migrations/global-templates';
import type { QueryRunner } from 'typeorm';

test('全局模板兼容旧公司字段后剥离，保留8/9列表格和19个元素', () => {
  const t = createPrintTemplate('sample');
  assert.equal(t.table.columnWeights.length, 9);
  for (const companyId of ['tri', 'tmy'])
    for (const width of [8, 9]) {
      const legacy = {
        ...t,
        companyId,
        table: { ...t.table, columnWeights: t.table.columnWeights.slice(0, width) },
      };
      const parsed = validatePrintTemplate(legacy);
      assert.equal('companyId' in parsed, false);
      assert.equal(parsed.table.columnWeights.length, width);
      assert.equal(Object.keys(parsed.elements).length, 19);
    }
  assert.throws(() =>
    validatePrintTemplate({ ...t, table: { ...t.table, columnWeights: [1, 2] } }),
  );
});
test('模板请求不接收company字段，响应不泄露旧归属或内部唯一列，默认与ID以记录为准', () => {
  const t = createPrintTemplate('old-id');
  const input = { name: '通用', is_default: true, config_json: t };
  assert.equal(globalTemplateInput.parse(input).is_default, true);
  assert.throws(() => globalTemplateInput.parse({ ...input, company_code: 'tri' }));
  assert.throws(() => globalTemplateInput.parse({ ...input, company_id: '1' }));
  const result = globalTemplateView({
    id: '42',
    name: '通用',
    company_id: '1',
    company_code: 'tri',
    company_name: '旧公司',
    global_default_slot: 1,
    is_default: 1,
    config_json: JSON.stringify({ ...t, companyId: 'tri' }),
  });
  for (const key of ['company_id', 'company_code', 'company_name', 'global_default_slot'])
    assert.equal(key in result, false);
  assert.deepEqual(
    { ...validatePrintTemplate(result.config_json), isDefault: undefined },
    { ...t, id: '42', name: '通用', isDefault: undefined },
  );
  assert.equal(validatePrintTemplate(result.config_json).isDefault, true);
});
test('迁移保留行、选择唯一默认；DDL可重跑，不自动回滚归属', async () => {
  const statements: string[] = [];
  const indices = [{ name: 'uk_company_name' }, { name: 'idx_company_default' }];
  let hasColumn = false;
  const runner = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('information_schema.statistics'))
        return indices
          .filter(
            (index) =>
              !sql.includes("INDEX_NAME='uk_global_default'") || index.name === 'uk_global_default',
          )
          .map((index) => ({ INDEX_NAME: index.name }));
      if (sql.includes('information_schema.columns'))
        return hasColumn ? [{ COLUMN_NAME: 'global_default_slot' }] : [];
      if (sql.startsWith('ALTER TABLE print_templates DROP INDEX')) {
        const name = sql.split(' ').at(-1);
        indices.splice(
          indices.findIndex((index) => index.name === name),
          1,
        );
      }
      if (sql.startsWith('SELECT id')) return [{ id: '1' }];
      if (sql.startsWith('ALTER TABLE print_templates ADD')) hasColumn = true;
      if (sql.startsWith('CREATE UNIQUE')) indices.push({ name: 'uk_global_default' });
      return [];
    },
    getTable: async () => {
      throw new Error('禁止依赖TypeORM生成列metadata');
    },
    hasColumn: async () => {
      throw new Error('禁止依赖TypeORM生成列metadata');
    },
    dropIndex: async () => {
      throw new Error('必须使用原生DDL');
    },
  } as unknown as QueryRunner;
  const migration = new GlobalTemplates1790091000000();
  await migration.up(runner);
  await migration.up(runner);
  assert.equal(statements.filter((s) => s.startsWith('CREATE UNIQUE INDEX')).length, 1);
  assert.equal(statements.filter((s) => s.startsWith('ALTER TABLE print_templates ADD')).length, 1);
  assert.ok(statements.some((s) => s.includes('ORDER BY is_default DESC,updated_at DESC,id DESC')));
  assert.ok(statements.some((s) => s.includes("JSON_REMOVE(config_json,'$.companyId')")));
  assert.ok(statements.every((s) => !/^DELETE|^TRUNCATE|^DROP TABLE/.test(s)));
  await assert.rejects(migration.down());
});

test('真实SQLite执行模板控制器：跨公司共用、全局默认切换/删除回退、唯一索引拒绝多默认', async (t) => {
  const { DatabaseSync } = await import('node:sqlite');
  const { db } = await import('../src/db');
  const { TemplatesController } = await import('../src/templates');
  const memory = new DatabaseSync(':memory:');
  memory.exec(`CREATE TABLE companies(id INTEGER PRIMARY KEY);INSERT INTO companies VALUES(1),(2);
 CREATE TABLE print_templates(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER,name TEXT NOT NULL,is_default INTEGER NOT NULL DEFAULT 0,config_json TEXT NOT NULL,created_by INTEGER,updated_by INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT,global_default_slot INTEGER GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL AND is_default=1 THEN 1 ELSE NULL END) STORED);
 CREATE UNIQUE INDEX uk_global_default ON print_templates(global_default_slot);`);
  t.after(() => memory.close());
  t.mock.method(db.manager, 'query', async (sql: string, params: unknown[] = []) => {
    const statement = memory.prepare(sql.replace(/ FOR UPDATE$/, ''));
    const values = params.map((value) =>
      value === null ? null : typeof value === 'number' ? value : String(value),
    );
    if (sql.startsWith('SELECT'))
      return statement
        .all(...values)
        .map((row) => ({ ...row, ...('id' in row ? { id: String(row.id) } : {}) }));
    const result = statement.run(...values);
    return { insertId: String(result.lastInsertRowid) };
  });
  t.mock.method(db, 'transaction', async (run: (m: typeof db.manager) => Promise<unknown>) => {
    memory.exec('BEGIN');
    try {
      const result = await run(db.manager);
      memory.exec('COMMIT');
      return result;
    } catch (error) {
      memory.exec('ROLLBACK');
      throw error;
    }
  });
  const makeReq = (company_code: 'tri' | 'tmy') =>
    ({
      user: {
        id: '1',
        company_id: company_code === 'tri' ? '1' : '2',
        company_code,
        username: 'admin',
        real_name: '测试',
        role: 'boss',
        employee_id: null,
        must_change_password: false,
      },
    }) as import('../src/auth').AuthRequest;
  const controller = new TemplatesController();
  const input = { name: '同名布局', is_default: false, config_json: createPrintTemplate('sample') };
  const first = await controller.create(makeReq('tri'), input);
  assert.equal(first.is_default, 1);
  const second = await controller.create(makeReq('tmy'), input);
  assert.equal(second.is_default, 0);
  assert.equal((await controller.get(makeReq('tmy'), String(first.id))).id, first.id);
  assert.equal((await controller.list(makeReq('tri'), {})).total, 2);
  await controller.edit(makeReq('tmy'), String(second.id), { ...input, is_default: true });
  assert.equal((await controller.get(makeReq('tri'), String(first.id))).is_default, 0);
  assert.throws(() =>
    memory.prepare('UPDATE print_templates SET is_default=1 WHERE id=?').run(String(first.id)),
  );
  await controller.remove(makeReq('tri'), String(second.id));
  assert.equal((await controller.get(makeReq('tmy'), String(first.id))).is_default, 1);
  await controller.remove(makeReq('tmy'), String(first.id));
  assert.equal((await controller.list(makeReq('tri'), {})).total, 0);
});
