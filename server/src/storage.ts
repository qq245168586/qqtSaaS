import { constants } from 'node:fs';
import { mkdir, lstat, realpath, open, link, unlink } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { z } from 'zod';
export const keySchema = z
  .string()
  .regex(
    /^(?:[1-9]\d{0,19}\/tasks\/[1-9]\d{0,19}|wiki)\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.png$/,
  );
export type ImageVariant = 'original' | 'thumbnail';
export interface Storage {
  put(key: string, data: Buffer): Promise<{ created: boolean }>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signatureUrl(key: string, variant?: ImageVariant, expires?: number): string;
  verify(key: string, variant: ImageVariant, expires: number, signature: string): void;
}
export class DiskStorage implements Storage {
  private constructor(
    private readonly root: string,
    private readonly base: string,
    private readonly signingKey: Buffer,
  ) {}
  static async create(directory: string, baseUrl: string, secret: string): Promise<DiskStorage> {
    if (!directory || !directory.startsWith('/')) throw new Error('ATTACHMENT_DIR必须为绝对路径');
    if (Buffer.byteLength(secret) < 32) throw new Error('附件签名密钥未配置');
    const base = new URL(baseUrl);
    if (
      base.protocol !== 'https:' &&
      !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(base.hostname))
    )
      throw new Error('BASE_URL必须为HTTPS');
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !['', '/'].includes(base.pathname)
    )
      throw new Error('BASE_URL必须为纯站点地址');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink()) throw new Error('附件根目录不能为软链接');
    const root = await realpath(directory);
    return new DiskStorage(
      root,
      base.origin,
      createHmac('sha256', secret).update('tmytri:private-attachments:v1').digest(),
    );
  }
  private async path(key: string, create = false): Promise<string> {
    keySchema.parse(key);
    const candidate = resolve(this.root, key);
    if (!candidate.startsWith(this.root + sep)) throw new Error('附件路径越界');
    const parts = key.split('/');
    let parent = this.root;
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part);
      if (create)
        await mkdir(parent, { mode: 0o700 }).catch((e: unknown) => {
          if (!(e instanceof Error) || !('code' in e) || e.code !== 'EEXIST') throw e;
        });
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('附件路径不能包含软链接');
      const actual = await realpath(parent);
      if (!actual.startsWith(this.root + sep)) throw new Error('附件路径越界');
    }
    return candidate;
  }
  async put(key: string, data: Buffer): Promise<{ created: boolean }> {
    if (
      data.length > 10 * 1024 * 1024 ||
      !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error('附件必须为不超过10MiB的PNG');
    const path = await this.path(key, true);
    const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, path);
        return { created: true };
      } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
          const existing = await this.read(key);
          if (existing.equals(data)) return { created: false };
          throw new Error('附件Key已存在不同内容，拒绝覆盖');
        }
        throw error;
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async read(key: string): Promise<Buffer> {
    const path = await this.path(key);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('附件不是有效文件');
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }
  async delete(key: string): Promise<void> {
    try {
      const path = await this.path(key);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('附件不是普通文件');
      await unlink(path);
    } catch (error: unknown) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
  }
  private signature(key: string, variant: ImageVariant, expires: number): string {
    return createHmac('sha256', this.signingKey)
      .update(`${key}\n${variant}\n${expires}`)
      .digest('hex');
  }
  signatureUrl(
    key: string,
    variant: ImageVariant = 'original',
    expires = Math.floor(Date.now() / 1000) + 300,
  ): string {
    keySchema.parse(key);
    const query = new URLSearchParams({
      key,
      variant,
      expires: String(expires),
      signature: this.signature(key, variant, expires),
    });
    return `${this.base}/api/files/image?${query}`;
  }
  verify(key: string, variant: ImageVariant, expires: number, signature: string): void {
    keySchema.parse(key);
    z.enum(['original', 'thumbnail']).parse(variant);
    const time = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(expires) ||
      expires <= time ||
      expires > time + 900 ||
      !/^([a-f0-9]{64})$/.test(signature)
    )
      throw new Error('附件签名无效或已过期');
    if (
      !timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(this.signature(key, variant, expires), 'hex'),
      )
    )
      throw new Error('附件签名无效');
  }
}
export function createStorage(): Promise<DiskStorage> {
  return DiskStorage.create(
    process.env.ATTACHMENT_DIR ?? '/var/lib/tmy-phase2/attachments',
    process.env.BASE_URL ?? 'https://114.215.185.184',
    process.env.JWT_SECRET ?? '',
  );
}
