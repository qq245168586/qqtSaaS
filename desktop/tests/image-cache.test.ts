import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cachedImage, invalidateImage } from '../electron/image-cache';
test('stable attachment cache downloads once across concurrent requests and validates corruption/deletion', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'image-cache-'));
  let count = 0;
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/kcAAAAASUVORK5CYII=',
    'base64',
  );
  const download = async () => {
    count++;
    return image;
  };
  try {
    await Promise.all([
      cachedImage(dir, 'attachment:1', download),
      cachedImage(dir, 'attachment:1', download),
    ]);
    await cachedImage(dir, 'attachment:1', download);
    assert.equal(count, 1);
    const [file] = await readdir(dir);
    await writeFile(path.join(dir, file), 'corrupt');
    await cachedImage(dir, 'attachment:1', download);
    assert.equal(count, 2);
    await invalidateImage(dir, 'attachment:1');
    await cachedImage(dir, 'attachment:1', download);
    assert.equal(count, 3);
    await assert.rejects(cachedImage(dir, 'bad', async () => Buffer.from('html')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
