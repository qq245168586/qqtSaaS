import { db } from './db';
void (async () => {
  await db.initialize();
  await db.runMigrations({ transaction: 'none' });
  console.log('数据库迁移完成');
  await db.destroy();
})().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
