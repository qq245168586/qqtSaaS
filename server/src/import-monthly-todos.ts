import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { db, insert, now, rows } from './db';
import { monthlyTimes, todoCreate } from './todos-core';

const inputSchema = z
  .object({
    source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    source_name: z.string().min(1).max(200),
    items: z
      .array(
        z
          .object({
            row: z.number().int().positive(),
            title: z.string().trim().min(1).max(200),
            due_day: z.number().int().min(1).max(31).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

// Explicit CLI only; never executes from API startup. Re-imports skip the same source row.
async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error('请提供已核对的月度检查 JSON 文件');
  const input = inputSchema.parse(JSON.parse(await readFile(filename, 'utf8')));
  if (new Set(input.items.map((i) => i.row)).size !== input.items.length)
    throw new Error('来源行号重复');
  await db.initialize();
  try {
    const current = now(),
      month = current.slice(0, 7);
    const result = await db.transaction(async (m) => {
      const ids: string[] = [];
      let created = 0,
        skipped = 0;
      for (const item of input.items) {
        const key = `${input.source_sha256}:${item.row}`;
        const [old] = await rows(
          'SELECT id FROM todo_items WHERE import_key=? FOR UPDATE',
          [key],
          m,
        );
        if (old) {
          ids.push(String(old.id));
          skipped++;
          continue;
        }
        // 2000-01 has 31 days: null explicitly represents month end.
        const anchor = `2000-01-${String(item.due_day ?? 31).padStart(2, '0')} 23:59`;
        const times = monthlyTimes(anchor, month);
        const v = todoCreate.parse({
          title: item.title,
          note: `来源：${input.source_name} · 第${item.row}行\n按月复核；原文中的每日、每周要求保留。`,
          ...times,
          recurrence: 'monthly',
          progress: 0,
        });
        ids.push(
          await insert(
            'todo_items',
            {
              ...v,
              cycle_month: month,
              monthly_anchor_end: anchor,
              completed_at: null,
              import_key: key,
              version: 1,
              created_at: current,
              updated_at: current,
            },
            m,
          ),
        );
        created++;
      }
      return { created, skipped, total: ids.length, ids, month };
    });
    console.log(JSON.stringify(result));
  } finally {
    await db.destroy();
  }
}
if (require.main === module)
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : '导入失败');
    process.exitCode = 1;
  });
