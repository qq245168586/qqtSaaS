import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
const pending = new Map<string, Promise<Uint8Array>>();
export function imageType(bytes: Uint8Array): string {
  if (bytes[0] === 137 && Buffer.from(bytes.subarray(1, 4)).toString() === 'PNG')
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (
    Buffer.from(bytes.subarray(0, 4)).toString() === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString() === 'WEBP'
  )
    return 'image/webp';
  throw new Error('附件不是有效图片');
}
export async function cachedImage(
  directory: string,
  key: string,
  download: () => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const name = createHash('sha256').update(key).digest('hex');
  const file = path.join(directory, name + '.json');
  const active = pending.get(file);
  if (active) return active;
  const job = (async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const record: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (
        typeof record === 'object' &&
        record !== null &&
        'data' in record &&
        'hash' in record &&
        typeof record.data === 'string' &&
        typeof record.hash === 'string'
      ) {
        const bytes = Buffer.from(record.data, 'base64');
        imageType(bytes);
        if (createHash('sha256').update(bytes).digest('hex') === record.hash) return bytes;
      }
    } catch {
      /* Corrupt/incomplete entries are downloaded again. */
    }
    const bytes = await download();
    if (bytes.length > 10 * 1024 * 1024) throw new Error('图片超过10MiB');
    imageType(bytes);
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(
        temp,
        JSON.stringify({
          hash: createHash('sha256').update(bytes).digest('hex'),
          data: Buffer.from(bytes).toString('base64'),
        }),
        { mode: 0o600 },
      );
      await unlink(file).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      });
      await rename(temp, file);
    } finally {
      await unlink(temp).catch(() => undefined);
    }
    return bytes;
  })();
  pending.set(file, job);
  try {
    return await job;
  } finally {
    pending.delete(file);
  }
}

export async function invalidateImage(directory: string, key: string): Promise<void> {
  const file = path.join(directory, createHash('sha256').update(key).digest('hex') + '.json');
  await pending.get(file)?.catch(() => undefined);
  await unlink(file).catch(() => undefined);
}
