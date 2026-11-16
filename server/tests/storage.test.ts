import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, symlink, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { DiskStorage } from '../src/storage';
const key = '1/tasks/2/12345678-1234-1234-1234-123456789012.png';
test('私有附件原子写入/不覆盖/0600权限/读取与删除', async () => {
  const root = await mkdtemp(join(tmpdir(), 'attachments-'));
  try {
    const storage = await DiskStorage.create(root, 'https://114.215.185.184', 's'.repeat(32));
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } })
      .png()
      .toBuffer();
    assert.deepEqual(await storage.put(key, png), { created: true });
    assert.deepEqual(await storage.read(key), png);
    assert.equal((await stat(join(root, key))).mode & 0o777, 0o600);
    assert.deepEqual(await storage.put(key, png), { created: false });
    await assert.rejects(storage.put(key, Buffer.concat([png, Buffer.from('different')])));
    assert.deepEqual(await readdir(join(root, '1/tasks/2')), [
      '12345678-1234-1234-1234-123456789012.png',
    ]);
    await storage.delete(key);
    await assert.rejects(storage.read(key));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('签名拒绝缺失、过期、篡改、变更公司/缩略图用途与路径穿越', async () => {
  const root = await mkdtemp(join(tmpdir(), 'signatures-'));
  try {
    const storage = await DiskStorage.create(root, 'https://114.215.185.184', 's'.repeat(32));
    const url = new URL(storage.signatureUrl(key));
    const expires = Number(url.searchParams.get('expires'));
    const sig = url.searchParams.get('signature') ?? '';
    assert.doesNotThrow(() => storage.verify(key, 'original', expires, sig));
    assert.throws(() => storage.verify(key, 'original', expires, ''));
    assert.throws(() => storage.verify(key, 'thumbnail', expires, sig));
    assert.throws(() => storage.verify(key.replace(/^1/, '2'), 'original', expires, sig));
    assert.throws(() => storage.verify(key, 'original', expires - 99999, sig));
    assert.throws(() => storage.verify('../secret', 'original', expires, sig));
    await assert.rejects(storage.read('/etc/passwd'));
    await assert.rejects(storage.read('1/tasks/2/../../etc/passwd'));
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(root, '2'));
    await assert.rejects(
      storage.put(key.replace(/^1/, '2'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
