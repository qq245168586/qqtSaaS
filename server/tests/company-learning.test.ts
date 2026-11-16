import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  chooseCompany,
  learningKeywords,
  rememberCompany,
  suggestCompany,
  forgetCompany,
} from '../src/company-learning';
import { db } from '../src/db';
import type { User } from '../src/auth';
test('主营规则覆盖蛋糕茶歇月饼糕点/意面方包；混合未知低置信，人工可覆盖', () => {
  for (const text of ['蛋糕', '茶歇', '月饼', '糕点', '布丁', '焦糖布丁', '布丁烧'])
    assert.equal(chooseCompany(text, []).company_code, 'tri');
  for (const text of ['意面', '方包', '意大利面'])
    assert.equal(chooseCompany(text, []).company_code, 'tmy');
  assert.equal(chooseCompany('蛋糕和方包', []).company_match.source, 'fallback');
  assert.equal(chooseCompany('未知商品', []).company_match.confidence, 0);
  assert.deepEqual(learningKeywords('蛋糕蛋糕', ['我的新品', '我的新品']), ['蛋糕', '我的新品']);
});
test('学习必须同关键词>=3独立纠正且>=70%，一次误选不能覆盖默认', () => {
  assert.equal(
    chooseCompany('蛋糕', [{ keyword: '蛋糕', company_code: 'tmy', votes: 2 }]).company_code,
    'tri',
  );
  assert.equal(
    chooseCompany('蛋糕', [{ keyword: '蛋糕', company_code: 'tmy', votes: 3 }]).company_match
      .source,
    'learned',
  );
  assert.equal(
    chooseCompany('蛋糕', [
      { keyword: '蛋糕', company_code: 'tmy', votes: 2 },
      { keyword: '蛋糕', company_code: 'tri', votes: 1 },
    ]).company_match.source,
    'default',
  );
  assert.equal(
    chooseCompany('蛋糕', [
      { keyword: '蛋糕', company_code: 'tmy', votes: 7 },
      { keyword: '蛋糕', company_code: 'tri', votes: 3 },
    ]).company_code,
    'tmy',
  );
  assert.equal(
    chooseCompany('方包', [{ keyword: '蛋糕', company_code: 'tri', votes: 30 }]).company_code,
    'tmy',
  );
});
test('真实SQLite纠正采样：接受建议不计、重复保存不加票、改公司覆盖、删除撤回、失败回滚', async (t) => {
  const memory = new DatabaseSync(':memory:');
  memory.exec(
    'CREATE TABLE company_choice_samples(entity_type TEXT,entity_id TEXT,keyword TEXT,company_code TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(entity_type,entity_id,keyword));',
  );
  t.after(() => memory.close());
  t.mock.method(db.manager, 'query', async (sql: string, params: SQLInputValue[] = []) => {
    const query = memory.prepare(
      sql.replace('DATE_SUB(NOW(),INTERVAL 180 DAY)', "datetime('now','-180 days')"),
    );
    return sql.startsWith('SELECT') ? query.all(...params) : query.run(...params);
  });
  const user: User = {
    id: '1',
    company_id: '2',
    company_code: 'tmy',
    write_company_code: 'tmy',
    username: 'admin',
    real_name: '测试',
    role: 'boss',
    employee_id: null,
    must_change_password: false,
  };
  const count = () =>
    Number(memory.prepare('SELECT COUNT(*) n FROM company_choice_samples').get()?.n);
  await rememberCompany(
    'task',
    '100',
    { ...user, write_company_code: undefined },
    '蛋糕',
    db.manager,
  );
  assert.equal(count(), 0);
  await rememberCompany(
    'task',
    '100',
    { ...user, company_code: 'tri', write_company_code: 'tri' },
    '蛋糕',
    db.manager,
  );
  assert.equal(count(), 0);
  for (const id of ['1', '2', '3']) await rememberCompany('task', id, user, '蛋糕', db.manager);
  assert.equal(count(), 3);
  assert.equal((await suggestCompany('蛋糕')).company_code, 'tmy');
  await rememberCompany('task', '3', user, '蛋糕', db.manager, [], 'tmy');
  assert.equal(count(), 3);
  await rememberCompany('task', '4', user, '蛋糕', db.manager);
  assert.equal(count(), 3);
  await rememberCompany(
    'task',
    '3',
    { ...user, company_code: 'tri', write_company_code: 'tri' },
    '蛋糕',
    db.manager,
    [],
    'tmy',
  );
  assert.equal(count(), 2);
  assert.equal((await suggestCompany('蛋糕')).company_code, 'tri');
  memory.exec('BEGIN');
  await forgetCompany('task', '1', db.manager);
  memory.exec('ROLLBACK');
  assert.equal(count(), 2);
  await forgetCompany('task', '1', db.manager);
  assert.equal(count(), 1);
  memory.exec("UPDATE company_choice_samples SET updated_at='2020-01-01'");
  assert.equal((await suggestCompany('蛋糕')).company_match.source, 'default');
});
