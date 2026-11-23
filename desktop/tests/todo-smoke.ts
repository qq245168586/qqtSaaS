import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { z } from 'zod';
const profile = await mkdtemp(path.join(tmpdir(), 'tmy-todo-smoke-'));
const bodySchema = z.object({
  title: z.string(),
  note: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  progress: z.number(),
  recurrence: z.enum(['once', 'monthly']),
  version: z.number().optional(),
});
type Todo = z.infer<typeof bodySchema> & {
  id: string;
  version: number;
  overdue: boolean;
  reminder: boolean;
  cycle_month: string | null;
};
const history: Array<{ id: string; reason: string; archived_at: string; snapshot: Todo }> = [];
let items: Todo[] = [];
let parseCalls = 0;
let listCalls = 0;
let updateCalls = 0;
const server = createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', 'http://localhost');
  let data: unknown = { items: [], total: 0, total_amount: '0.00', page: 1, page_size: 20 };
  if (u.pathname === '/api/auth/access-mode') data = { public_access: true };
  else if (u.pathname === '/api/auth/enter')
    data = {
      access_token: 'test',
      user: {
        id: '0',
        company_id: '1',
        company_code: 'tmy',
        username: 'test',
        real_name: '测试',
        role: 'boss',
        must_change_password: false,
        public_access: true,
      },
    };
  else if (u.pathname === '/api/ai/assistant/parse') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input = z
      .object({ supported_modules: z.array(z.string()) })
      .parse(JSON.parse(Buffer.concat(chunks).toString()));
    assert.ok(input.supported_modules.includes('todo'));
    if (++parseCalls === 1) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          code: 503,
          data: null,
          message: 'AI 服务请求过于频繁或额度不足，请稍后重试。',
          error_code: 'AI_RATE_LIMIT',
          error_stage: 'provider',
        }),
      );
      return;
    }
    data = {
      clarification: '',
      items: [
        {
          module: 'todo',
          source_text: '添加待办，采购确认，进度25%',
          warnings: ['请补时间'],
          value: {
            title: 'AI采购确认',
            note: '核对原料',
            starts_at: null,
            ends_at: null,
            progress: 100,
            recurrence: 'monthly',
          },
        },
      ],
    };
  } else if (u.pathname === '/api/todos/reminders')
    data = {
      overdue_count: items.filter((i) => i.reminder).length,
      server_now: '2026-11-13 18:00:00',
    };
  else if (u.pathname === '/api/todos' && req.method === 'GET') {
    listCalls++;
    const filter = u.searchParams.get('status');
    const selected = items.filter((i) =>
      filter === 'done'
        ? i.progress === 100
        : filter === 'overdue'
          ? i.overdue
          : filter === 'all' || i.progress < 100,
    );
    data = { items: selected, total: selected.length, server_now: '2026-11-13 18:00:00' };
  } else if (u.pathname === '/api/todos/1/history')
    data = { items: history, total: history.length, page: 1, page_size: 20 };
  else if (u.pathname.startsWith('/api/todos') && req.method !== 'GET') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (u.pathname.endsWith('/restart')) {
      const old = items[0];
      assert.equal(z.object({ version: z.number() }).parse(raw).version, old.version);
      assert.equal(old.progress, 100);
      history.push({
        id: '1',
        reason: 'restart',
        archived_at: '2026-11-15 10:00:00',
        snapshot: { ...old },
      });
      items = [
        {
          ...old,
          progress: 0,
          starts_at: '2026-11-15 10:00',
          ends_at: '2026-11-15 19:00',
          version: old.version + 1,
          overdue: false,
          reminder: true,
        },
      ];
      data = items[0];
    } else if (req.method === 'DELETE') {
      items = [];
      data = null;
    } else {
      if (req.method === 'PUT') updateCalls++;
      const v = bodySchema.parse(raw);
      const item = {
        ...v,
        id: '1',
        version: (v.version ?? 0) + 1,
        overdue: v.progress < 100 && v.ends_at <= '2026-11-13 18:00',
        reminder:
          v.progress < 100 && (v.recurrence === 'monthly' || v.ends_at <= '2026-11-13 18:00'),
        cycle_month: v.recurrence === 'monthly' ? v.ends_at.slice(0, 7) : null,
      };
      items = [item];
      data = item;
    }
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ code: 0, message: 'ok', data }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const addr = server.address();
assert(addr && typeof addr !== 'string');
await writeFile(
  path.join(profile, 'connection.json'),
  JSON.stringify(`http://127.0.0.1:${addr.port}`),
);
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, TMY_PHASE2_TEST_DIR: profile },
});
try {
  const p = await app.firstWindow();
  p.setDefaultTimeout(15000);
  await p.getByRole('menuitem', { name: '总览', exact: true }).click();
  await p.getByRole('menuitem', { name: '待办事项', exact: true }).click();
  await p.getByRole('button', { name: '新增待办' }).click();
  const dialog = p.getByRole('dialog');
  await dialog.getByLabel('事项', { exact: true }).fill('测试原料采购');
  await dialog.getByLabel('备注', { exact: true }).fill('确认采购数量，核对库存后联系供应商。');
  await dialog.locator('.ant-select-selector').click();
  await p
    .locator('.ant-select-dropdown:visible:not(.todo-status-options)')
    .getByTitle('月度任务', { exact: true })
    .click();
  await dialog.getByLabel('开始时间', { exact: true }).fill('2026-11-13T08:00');
  await dialog.getByLabel('截止时间', { exact: true }).fill('2026-11-13T17:00');
  await dialog.getByRole('button', { name: '确 定', exact: true }).click();
  await p.getByText('测试原料采购', { exact: true }).waitFor();
  await p.locator('.todo-overdue').waitFor();
  assert.equal(items.length, 1);
  assert.equal(await p.locator('.app-sidebar .ant-badge-dot').count(), 1);
  assert.equal(items[0].progress, 0);
  assert.equal(await p.locator('.todo-workspace .ant-progress').count(), 0);
  assert.equal(await p.locator('.todo-index').first().innerText(), '1');
  assert.equal(await p.locator('.todo-workspace input[type=checkbox]').count(), 0);
  const noteStyle = await p.locator('.todo-note').evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      border: style.borderTopWidth,
      radius: style.borderRadius,
      background: style.backgroundColor,
    };
  });
  assert.deepEqual(noteStyle, { border: '0px', radius: '0px', background: 'rgba(0, 0, 0, 0)' });
  await p.waitForFunction(() => !document.querySelector('.todo-workspace .ant-spin-spinning'));
  const callsBeforeUpdate = listCalls;
  await p.evaluate(() => {
    document.documentElement.dataset.todoFlash = 'false';
    const observer = new MutationObserver(() => {
      if (document.querySelector('.todo-workspace .ant-spin-spinning'))
        document.documentElement.dataset.todoFlash = 'true';
      if (document.documentElement.dataset.todoFlash === 'checked') observer.disconnect();
    });
    observer.observe(document.querySelector('.todo-workspace')!, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  });
  await p.locator('.todo-status .ant-select-selector').click();
  assert.equal(items[0].progress, 0, '展开状态选项不能直接完成');
  await p.locator('.todo-status-options:visible').getByTitle('已完成', { exact: true }).click();
  await p.getByText('测试原料采购', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(items[0].progress, 100);
  assert.equal(updateCalls, 1);
  assert.equal(listCalls - callsBeforeUpdate, 1, '状态修改只刷新列表一次');
  assert.equal(
    await p.evaluate(() => document.documentElement.dataset.todoFlash),
    'false',
    '后台刷新无白色遮罩',
  );
  await p.evaluate(() => {
    document.documentElement.dataset.todoFlash = 'checked';
  });
  await p.locator('.app-sidebar .ant-badge-dot').waitFor({ state: 'hidden' });
  await p.locator('.todo-workspace .ant-select-selector').first().click();
  await p
    .locator('.ant-select-dropdown:visible:not(.todo-status-options)')
    .getByTitle('已完成', { exact: true })
    .click();
  await p.getByText('测试原料采购', { exact: true }).waitFor();
  await p.locator('.todo-status .ant-select-selector').click();
  assert.equal(items[0].progress, 100, '展开状态选项不能直接取消完成');
  await p.locator('.todo-status-options:visible').getByTitle('未完成', { exact: true }).click();
  await p.getByText('测试原料采购', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(items[0].progress, 0);
  await p.locator('.app-sidebar .ant-badge-dot').waitFor();
  await p.locator('.todo-workspace .ant-select-selector').first().click();
  await p
    .locator('.ant-select-dropdown:visible:not(.todo-status-options)')
    .getByTitle('未完成', { exact: true })
    .click();
  await p.getByText('测试原料采购', { exact: true }).waitFor();
  assert.equal(items[0].recurrence, 'monthly');
  await p.locator('.todo-status .ant-select-selector').click();
  assert.equal(items[0].progress, 0, '展开状态选项不能直接完成');
  await p.locator('.todo-status-options:visible').getByTitle('已完成', { exact: true }).click();
  await p.getByText('测试原料采购', { exact: true }).waitFor({ state: 'hidden' });
  await p.locator('.todo-workspace .ant-select-selector').first().click();
  await p
    .locator('.ant-select-dropdown:visible:not(.todo-status-options)')
    .getByTitle('已完成', { exact: true })
    .click();
  await p.getByRole('button', { name: '重新开始', exact: true }).click();
  await p.getByText('测试原料采购', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(items[0].starts_at, '2026-11-15 10:00');
  assert.equal(items[0].ends_at, '2026-11-15 19:00');
  await p.locator('.todo-workspace .ant-select-selector').first().click();
  await p
    .locator('.ant-select-dropdown:visible:not(.todo-status-options)')
    .getByTitle('未完成', { exact: true })
    .click();
  await p.getByRole('button', { name: '历史', exact: true }).click();
  await p.getByRole('dialog').getByText('手动重新开始', { exact: true }).waitFor();
  await p.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await p.screenshot({ path: '/tmp/tmy-todo-monthly-preview.png' });
  await p.getByRole('button', { name: '删除', exact: true }).click();
  await p.getByRole('dialog').getByRole('button', { name: '确 定', exact: true }).click();
  await p.getByText('测试原料采购', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(items.length, 0);
  await p.locator('.global-ai-trigger').click();
  await p.getByLabel('全局AI输入').fill('添加待办，采购确认，进度25%');
  await p.getByRole('button', { name: '识别并预填' }).click();
  await p.getByText('AI 服务限流或额度不足', { exact: true }).waitFor();
  assert.equal(await p.getByLabel('全局AI输入').inputValue(), '添加待办，采购确认，进度25%');
  assert.equal(items.length, 0);
  await p.getByRole('button', { name: '识别并预填' }).click();
  await p.getByRole('button', { name: '打开待办事项填写页' }).click();
  await p.getByRole('dialog').getByLabel('事项', { exact: true }).waitFor();
  assert.equal(items.length, 0, 'AI预填不能写入');
  assert.equal(
    await p.getByRole('dialog').getByLabel('事项', { exact: true }).inputValue(),
    'AI采购确认',
  );
  await p.getByRole('dialog').getByRole('button', { name: '确 定', exact: true }).click();
  assert.match(
    await p.getByRole('dialog').getByLabel('开始时间', { exact: true }).inputValue(),
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
  );
  await p.getByText('请选择截止时间', { exact: true }).waitFor();
  assert.equal(items.length, 0, '缺失时间不可保存');
  await p.getByRole('dialog').getByLabel('开始时间', { exact: true }).fill('2026-11-13T08:00');
  await p.getByRole('dialog').getByLabel('截止时间', { exact: true }).fill('2026-11-13T17:00');
  await p.getByRole('dialog').getByRole('button', { name: '确 定', exact: true }).click();
  await p.getByText('已创建', { exact: true }).waitFor();
  assert.equal(items.length, 1);
  assert.equal(items[0].progress, 0);
  console.log(
    'Monthly type, explicit status selection, row numbers, plain notes, non-flashing refresh, restart, history, reminders, deletion and AI incomplete default verified using isolated data.',
  );
} finally {
  await app.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
