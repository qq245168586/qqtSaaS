import { hash } from 'bcryptjs';
import { db, rows, insert, execute } from './db';
void (async () => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!password || Buffer.byteLength(password) < 12 || Buffer.byteLength(password) > 72)
    throw new Error('INITIAL_ADMIN_PASSWORD 必须为 12–72 字节，禁止使用默认密码');
  await db.initialize();
  await db.transaction(async (m) => {
    for (const name of ['蛋糕部', '面包部', '制面部'])
      await execute('INSERT IGNORE INTO departments(company_id,name) VALUES(NULL,?)', [name], m);
    for (const name of ['定制蛋糕', '茶歇', '门店供应配送'])
      await execute('INSERT IGNORE INTO categories(company_id,name) VALUES(NULL,?)', [name], m);
    for (const [code, name] of [
      ['tri', '趣趣特'],
      ['tmy', '天美意'],
    ]) {
      await execute(
        'INSERT IGNORE INTO companies(code,name,short_name) VALUES(?,?,?)',
        [code, name, name],
        m,
      );
      const [company] = await rows('SELECT id FROM companies WHERE code=?', [code], m);
      const company_id = String(company.id);
      for (const [table, names] of [['customer_categories', ['未分类']]] as const) {
        for (const n of names)
          await execute(
            `INSERT IGNORE INTO ${table}(company_id,name) VALUES(?,?)`,
            [company_id, n],
            m,
          );
      }
      if (
        !(
          await rows(
            'SELECT id FROM users WHERE company_id=? AND username=?',
            [company_id, 'admin'],
            m,
          )
        ).length
      )
        await insert(
          'users',
          {
            company_id,
            username: 'admin',
            password_hash: await hash(password, 12),
            real_name: '管理员',
            role: 'boss',
            must_change_password: 1,
          },
          m,
        );
    }
  });
  await db.destroy();
  console.log('初始化完成，已有账户不会被覆盖');
})().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
