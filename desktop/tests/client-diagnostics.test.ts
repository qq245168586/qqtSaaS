import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ClientDiagnostics,
  clientHeaders,
  safeError,
  safeRoute,
  type DiagnosticEvent,
} from '../electron/client-diagnostics';
import {
  beginUpdateReceipt,
  readUpdateReceipt,
  clearUpdateReceipt,
} from '../electron/update-receipt';

function directory(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'client-diag-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('设备编号跨升级保持一致，请求编号独立且 UA 标明版本', (t) => {
  const dir = directory(t);
  const first = new ClientDiagnostics(dir, '2.1.33', 'win32', 'x64');
  const next = new ClientDiagnostics(dir, '2.1.34', 'win32', 'x64');
  assert.equal(first.identity.device_id, next.identity.device_id);
  const a = clientHeaders(first.identity),
    b = clientHeaders(next.identity);
  assert.match(b['User-Agent'], /TMY-TRI-Manager\/2.1.34 \(win32; x64\) Device\//);
  assert.notEqual(a['X-Request-ID'], b['X-Request-ID']);
  assert.equal(b['X-Device-ID'], first.identity.device_id);
});
test('断网保留队列，重启补传，仅移除确认收到的记录且上传期间的新事件不丢失', async (t) => {
  const dir = directory(t);
  const client = new ClientDiagnostics(dir, '2.1.33', 'win32', 'x64');
  client.record('app_started');
  client.record('app_started');
  client.record('update_requested', { target_version: '2.1.34' });
  await client.flush(async () => {
    throw new Error('offline');
  });
  const restarted = new ClientDiagnostics(dir, '2.1.34', 'win32', 'x64');
  await restarted.flush(async (events) => {
    assert.equal(events.length, 2);
    assert.equal(events[0].app_version, '2.1.33');
    restarted.record('update_succeeded', { target_version: '2.1.34' });
    return [events[0].id];
  });
  let last: DiagnosticEvent[] = [];
  await restarted.flush(async (events) => {
    last = events;
    return events.map((e) => e.id);
  });
  assert.deepEqual(
    last.map((e) => e.code),
    ['update_requested', 'update_succeeded'],
  );
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'client-diagnostics.json'), 'utf8')), []);
});
test('队列容量和上传批次受限，错误不携带正文、用户名目录或查询令牌', async (t) => {
  const dir = directory(t),
    client = new ClientDiagnostics(dir, '2.1.33', 'win32', 'x64');
  for (let n = 0; n < 230; n++) client.record('http_error', { status: 300 + n });
  const events = JSON.parse(
    readFileSync(path.join(dir, 'client-diagnostics.json'), 'utf8'),
  ) as DiagnosticEvent[];
  assert.equal(events.length, 200);
  await client.flush(async (batch) => {
    assert.equal(batch.length, 30);
    return [];
  });
  const error = new Error('客户姓名 secret SQL token');
  error.stack = 'Error: secret\n at run (/Users/private-name/project/main.js:42:12)';
  assert.deepEqual(safeError(error), { error_type: 'Error', frames: ['main.js:42:12'] });
  assert.equal(safeRoute('https://example.com/api/tasks/123?token=secret'), '/api/tasks/:id');
});
test('更新成功依据实际运行版本；退出码为零也不能冒充更新成功', (t) => {
  const dir = directory(t),
    receipt = beginUpdateReceipt(dir, '2.1.33', '2.1.34');
  writeFileSync(
    receipt.file,
    '\uFEFF' +
      JSON.stringify({ attempt_id: receipt.attempt_id, phase: 'installer_finished', exit_code: 0 }),
  );
  assert.equal(readUpdateReceipt(dir, '2.1.33')?.success, false);
  assert.equal(readUpdateReceipt(dir, '2.1.34')?.success, true);
  assert.equal(readUpdateReceipt(dir, '2.1.35')?.success, true);
  writeFileSync(
    receipt.file,
    JSON.stringify({
      attempt_id: '00000000-0000-4000-8000-000000000000',
      phase: 'failed',
      exit_code: 1,
    }),
  );
  assert.equal(readUpdateReceipt(dir, '2.1.33')?.phase, 'unknown');
  clearUpdateReceipt(dir);
  assert.equal(readUpdateReceipt(dir, '2.1.34'), null);
});
