import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { SummaryController } from '../src/delivery';
import { db, type Row } from '../src/db';
import type { AuthRequest } from '../src/auth';

test('四种送货汇总的分类过滤、聚合及显式业务字段一致', async (t) => {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE companies(id TEXT,code TEXT,name TEXT);
    INSERT INTO companies VALUES('1','tri','趣趣特'),('2','tmy','天美意');
    CREATE TABLE customer_categories(id TEXT,name TEXT,deleted_at TEXT);
    INSERT INTO customer_categories VALUES('10','零售',NULL),('11','批发',NULL);
    CREATE TABLE customers(id TEXT,company_id TEXT,name TEXT,category_id TEXT);
    INSERT INTO customers VALUES('100','2','甲','10'),('101','2','乙','11'),('200','1','丙','10');
    CREATE TABLE delivery_notes(id TEXT,company_id TEXT,customer_id TEXT,customer_name_snapshot TEXT,
      delivery_date TEXT,note_number TEXT,total_amount NUMERIC,is_draft INTEGER,deleted_at TEXT,
      created_by TEXT,updated_by TEXT);
    INSERT INTO delivery_notes VALUES
      ('1','2','100','甲','2026-09-20','N1',15,0,NULL,'secret','secret'),
      ('2','2','100','甲','2026-09-22','N2',10,0,NULL,'secret','secret'),
      ('3','2',NULL,'乙','2026-09-21','N3',7,0,NULL,'secret','secret'),
      ('4','2',NULL,'新客户','2026-09-21','N4',3,0,NULL,'secret','secret'),
      ('5','1','200','丙','2026-09-21','N5',100,0,NULL,'secret','secret'),
      ('6','2','100','甲','2026-09-21','N6',900,1,NULL,'secret','secret'),
      ('7','2','100','甲','2026-09-21','N7',900,0,'deleted','secret','secret'),
      ('8','2','100','甲','2026-08-21','N8',900,0,NULL,'secret','secret');
    CREATE TABLE delivery_note_items(company_id TEXT,delivery_note_id TEXT,product_name TEXT,spec TEXT,unit TEXT,quantity NUMERIC,amount NUMERIC);
    INSERT INTO delivery_note_items VALUES
      ('2','1','A','','个',1,2),('2','1','A','','个',1,3),('2','1','B','大','盒',1,10),
      ('2','2','A','','个',2,10),('2','3','A','','个',1,7),('2','4','C','','个',1,3),
      ('1','5','A','','个',10,100),('2','6','A','','个',900,900),
      ('2','7','A','','个',900,900),('2','8','A','','个',900,900);
  `);
  t.mock.method(db.manager, 'query', async (sql: string, params: SQLInputValue[] = []) =>
    database.prepare(sql).all(...params),
  );
  const req = {
    user: { id: '1', company_id: '2', company_code: 'tmy', role: 'boss' },
  } as AuthRequest;
  const controller = new SummaryController();
  const query = { start_date: '2026-09-01', end_date: '2026-09-30' };
  const run = async (mode: string, customer_category_id?: string) =>
    (await controller.summary(req, { ...query, mode, customer_category_id })).items as Row[];
  try {
    const customers = await run('customers');
    assert.deepEqual(
      { ...customers.find((r) => r.customer_name_snapshot === '甲') },
      {
        customer_name_snapshot: '甲',
        category_name: '零售',
        note_count: 2,
        item_count: 4,
        quantity: 5,
        total_amount: 25,
        last_delivery_date: '2026-09-22',
      },
    );
    const categories = await run('categories');
    assert.deepEqual(
      { ...categories.find((r) => r.category_name === '零售') },
      {
        category_name: '零售',
        customer_count: 1,
        note_count: 2,
        item_count: 4,
        quantity: 5,
        total_amount: 25,
      },
    );
    const products = await run('products');
    assert.deepEqual(
      { ...products.find((r) => r.product_name === 'A') },
      {
        product_name: 'A',
        spec: '',
        unit: '个',
        note_count: 3,
        quantity: 5,
        total_amount: 22,
      },
    );
    const notes = await run('notes');
    assert.equal(notes.length, 4);
    assert.deepEqual(
      Object.keys(notes[0]).sort(),
      [
        'company_code',
        'company_name',
        'delivery_date',
        'note_number',
        'customer_name_snapshot',
        'category_name',
        'item_count',
        'quantity',
        'total_amount',
      ].sort(),
    );
    for (const mode of ['customers', 'categories', 'products', 'notes']) {
      const filtered = await run(mode, '11');
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].total_amount, 7);
      const unclassified = await run(mode, 'uncategorized');
      assert.equal(unclassified.length, 1);
      assert.equal(unclassified[0].total_amount, 3);
      assert.deepEqual(await run(mode, '999'), []);
    }
    assert.equal((await run('notes', '')).length, 4);
    await assert.rejects(run('notes', '1 OR 1=1'));
    await assert.rejects(controller.summary(req, { ...query, end_date: '2026-08-01' }));
    req.user.public_access = true;
    assert.equal((await run('notes')).length, 5);
    assert.equal((await run('categories', '10'))[0].customer_count, 2);
    assert.equal((await run('categories', '10'))[0].total_amount, 125);
    const onlyTri = await controller.summary(req, { ...query, mode: 'notes', company_code: 'tri' });
    assert.equal(onlyTri.total, 1);
    const empty = await controller.summary(req, {
      start_date: '2030-01-01',
      end_date: '2030-01-31',
      mode: 'notes',
    });
    assert.equal(empty.total, 0);
    assert.match(String(empty.empty_reason), /日期或分类/);
    assert.equal((empty.available_range as Row).note_count, 6);
    assert.equal((empty.available_range as Row).first_date, '2026-08-21');
    assert.equal(typeof (await run('customers'))[0].note_count, 'number');
  } finally {
    database.close();
  }
});
