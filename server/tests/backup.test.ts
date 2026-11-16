import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup } from '../src/backup';
import type { User } from '../src/auth';
import type { Row } from '../src/db';
const user: User = {
  id: '1',
  company_id: '1',
  company_code: 'tri',
  username: 'test',
  real_name: '测试',
  role: 'boss',
  employee_id: null,
  must_change_password: false,
};
function fixture(): {
  version: 2;
  company_id: string;
  exported_at: string;
  tables: Record<string, Row[]>;
} {
  return {
    version: 2,
    company_id: '1',
    exported_at: '2026-09-22 12:00:00',
    tables: Object.fromEntries(
      [
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
      ].map((t) => [t, []]),
    ),
  };
}
test('备份拒绝跨公司数据、未知字段以及覆盖账号表', () => {
  const original = fixture();
  assert.equal(validateBackup(original, user).company_id, '1');
  assert.throws(() => validateBackup({ ...original, company_id: '2' }, user));
  const other = fixture();
  other.tables.departments = [{ id: '1', company_id: '2', name: '跨公司' }];
  assert.throws(() => validateBackup(other, user));
  const extra = fixture();
  extra.tables.users = [];
  assert.throws(() => validateBackup(extra, user));
  const field = fixture();
  field.tables.departments = [{ id: '1', company_id: '1', name: '部门', injected_column: 1 }];
  assert.throws(() => validateBackup(field, user));
});
test('备份恢复拒绝孤立员工引用', () => {
  const b = fixture();
  b.tables.employees = [{ id: '1', company_id: '1', department_id: '999', name: '测试' }];
  assert.throws(() => validateBackup(b, user));
});
test('备份恢复核对有效单据金额；保留已删单据历史金额', () => {
  const b = fixture();
  b.tables.delivery_notes = [{ id: '1', company_id: '1', total_amount: '1.00', deleted_at: null }];
  assert.throws(() => validateBackup(b, user));
  b.tables.delivery_notes[0].deleted_at = '2026-09-22 12:00:00';
  assert.doesNotThrow(() => validateBackup(b, user));
});
test('公司备份不能覆盖全局打印模板，空模板集合继续兼容', () => {
  const b = fixture();
  b.tables.print_templates = [
    { id: '1', company_id: '1', name: '旧公司模板', is_default: 1, config_json: {} },
  ];
  assert.throws(() => validateBackup(b, user), /全局共享/);
  b.tables.print_templates = [];
  assert.doesNotThrow(() => validateBackup(b, user));
});
