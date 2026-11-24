import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DiagnosticStore,
  DiagnosticRateLimit,
  diagnosticEventSchema,
} from '../src/client-diagnostics';
import { diagnosticEventSchema as clientSchema } from '../../desktop/electron/client-diagnostics';

test('诊断协议双端一致，拒绝任意正文和无效字段', () => {
  const event = {
    id: randomUUID(),
    at: new Date().toISOString(),
    app_version: '2.1.33',
    code: 'update_incomplete',
    phase: 'failed',
    exit_code: -1,
  };
  assert.deepEqual(diagnosticEventSchema.parse(event), clientSchema.parse(event));
  for (const schema of [diagnosticEventSchema, clientSchema]) {
    assert.equal(schema.safeParse({ ...event, message: '客户电话' }).success, false);
    assert.equal(schema.safeParse({ ...event, route: '/api/tasks?token=secret' }).success, false);
    assert.equal(
      schema.safeParse({ ...event, frames: ['/Users/name/main.js:1:2'] }).success,
      false,
    );
  }
});
test('服务端保存事件、去重、更新设备版本，跨天清理过期日志', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'server-diag-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let now = new Date('2026-11-24T00:00:00Z');
  const store = new DiagnosticStore(dir, () => now);
  const identity = {
    device_id: randomUUID(),
    app_version: '2.1.33',
    platform: 'win32' as const,
    arch: 'x64' as const,
  };
  const event = diagnosticEventSchema.parse({
    id: randomUUID(),
    at: now.toISOString(),
    app_version: '2.1.33',
    code: 'update_requested',
    target_version: '2.1.34',
  });
  await Promise.all([
    store.save(identity, [event], randomUUID()),
    store.save(identity, [event], randomUUID()),
  ]);
  assert.equal(
    (await readFile(path.join(dir, 'events-2026-11-24.jsonl'), 'utf8')).trim().split('\n').length,
    1,
  );
  await store.save({ ...identity, app_version: '2.1.34' }, [], randomUUID());
  assert.equal(
    JSON.parse(await readFile(path.join(dir, 'devices.json'), 'utf8'))[identity.device_id]
      .app_version,
    '2.1.34',
  );
  await writeFile(path.join(dir, 'events-2026-10-01.jsonl'), 'old');
  await writeFile(path.join(dir, 'unrelated.txt'), 'keep');
  now = new Date('2026-11-25T00:00:00Z');
  await store.save(identity, [], randomUUID());
  const files = await readdir(dir);
  assert.ok(!files.includes('events-2026-10-01.jsonl'));
  assert.ok(files.includes('unrelated.txt'));
});
test('每 IP 上传限流，时间窗口过后恢复', () => {
  const limit = new DiagnosticRateLimit();
  for (let i = 0; i < 60; i++) assert.equal(limit.allow('test', 1000), true);
  assert.equal(limit.allow('test', 1000), false);
  assert.equal(limit.allow('test', 61000), true);
});
