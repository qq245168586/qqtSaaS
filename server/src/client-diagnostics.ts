import 'dotenv/config';
import {
  Body,
  Controller,
  Post,
  Req,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  writeFile,
  appendFile,
  stat,
  readdir,
  unlink,
  rename,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AuthRequest } from './auth';
const version = z
  .string()
  .max(40)
  .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
export const diagnosticEventSchema = z
  .object({
    id: z.string().uuid(),
    at: z.string().datetime(),
    app_version: version,
    code: z.enum([
      'app_started',
      'http_error',
      'network_error',
      'ipc_error',
      'renderer_error',
      'renderer_crashed',
      'main_error',
      'update_state',
      'update_requested',
      'update_helper',
      'update_succeeded',
      'update_incomplete',
    ]),
    request_id: z.string().uuid().optional(),
    status: z.number().int().min(0).max(599).optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).optional(),
    route: z
      .string()
      .max(160)
      .regex(/^\/[a-zA-Z/:_-]*$/)
      .optional(),
    error_type: z
      .string()
      .max(60)
      .regex(/^[a-zA-Z0-9_.-]+$/)
      .optional(),
    frames: z
      .array(
        z
          .string()
          .regex(/^[a-zA-Z0-9_.-]+\.[cm]?js:\d+:\d+$/)
          .max(120),
      )
      .max(8)
      .optional(),
    phase: z
      .enum([
        'idle',
        'checking',
        'up-to-date',
        'downloading',
        'downloaded',
        'installing',
        'error',
        'helper_ready',
        'waiting_for_exit',
        'installer_started',
        'installer_finished',
        'failed',
        'unknown',
      ])
      .optional(),
    target_version: version.optional(),
    exit_code: z.number().int().optional(),
  })
  .strict();
export type DiagnosticEvent = z.infer<typeof diagnosticEventSchema>;

const identitySchema = z.object({
  device_id: z.string().uuid(),
  app_version: version,
  platform: z.enum(['win32', 'darwin', 'linux']),
  arch: z.enum(['x64', 'arm64', 'ia32', 'arm']),
});
type Identity = z.infer<typeof identitySchema>;
export function requestIdentity(req: Request): Identity | null {
  const parsed = identitySchema.safeParse({
    device_id: req.get('X-Device-ID'),
    app_version: req.get('X-App-Version'),
    platform: req.get('X-Client-Platform'),
    arch: req.get('X-Client-Arch'),
  });
  return parsed.success ? parsed.data : null;
}
export class DiagnosticStore {
  private serial: Promise<unknown> = Promise.resolve();
  private seen = new Set<string>();
  private deviceSeen = new Map<string, string>();
  private initializedDay = '';
  private pending = 0;
  constructor(
    private readonly directory: string,
    private readonly now = () => new Date(),
  ) {}
  private async initialize() {
    const day = this.now().toISOString().slice(0, 10);
    if (this.initializedDay === day) return;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const cutoff = this.now().getTime() - 30 * 86400000;
    for (const filename of await readdir(this.directory)) {
      if (
        /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(filename) &&
        Date.parse(filename.slice(7, 17)) < cutoff
      )
        await unlink(path.join(this.directory, filename));
    }
    this.initializedDay = day;
  }
  async save(identity: Identity, events: DiagnosticEvent[], requestId: string): Promise<string[]> {
    if (this.pending >= 100) throw new ServiceUnavailableException('诊断服务繁忙，请稍后重试');
    this.pending++;
    const job = this.serial.then(async () => {
      if (
        !events.length &&
        this.deviceSeen.get(identity.device_id) ===
          identity.app_version + ':' + this.now().toISOString().slice(0, 16)
      )
        return [];
      await this.initialize();
      const day = this.now().toISOString().slice(0, 10);
      const file = path.join(this.directory, `events-${day}.jsonl`);
      const fresh = events.filter((event) => !this.seen.has(identity.device_id + ':' + event.id));
      const content = fresh
        .map(
          (event) =>
            JSON.stringify({
              received_at: this.now().toISOString(),
              ...identity,
              request_id: requestId,
              event,
            }) + '\n',
        )
        .join('');
      const size = content
        ? await stat(file)
            .then((s) => s.size)
            .catch(() => 0)
        : 0;
      if (size + Buffer.byteLength(content) > 10 * 1024 * 1024)
        throw new ServiceUnavailableException('诊断日志暂存已满，稍后重试');
      if (content) await appendFile(file, content, { mode: 0o600 });
      for (const event of fresh) this.seen.add(identity.device_id + ':' + event.id);
      if (this.seen.size > 10000) this.seen = new Set([...this.seen].slice(-5000));
      await this.device(identity);
      return events.map((event) => event.id);
    });
    this.serial = job
      .catch(() => undefined)
      .finally(() => {
        this.pending--;
      });
    return job;
  }
  private async device(identity: Identity) {
    const minute = this.now().toISOString().slice(0, 16);
    const stamp = identity.app_version + ':' + minute;
    if (this.deviceSeen.get(identity.device_id) === stamp) return;
    const filename = path.join(this.directory, 'devices.json');
    let devices: Record<string, Identity & { last_seen: string }> = {};
    try {
      const text = await readFile(filename, 'utf8');
      if (text.length < 1024 * 1024)
        devices = z
          .record(identitySchema.extend({ last_seen: z.string().datetime() }))
          .parse(JSON.parse(text));
    } catch {
      /* First record. */
    }
    devices[identity.device_id] = { ...identity, last_seen: this.now().toISOString() };
    const entries = Object.entries(devices)
      .sort((a, b) => b[1].last_seen.localeCompare(a[1].last_seen))
      .slice(0, 1000);
    await writeFile(filename + '.tmp', JSON.stringify(Object.fromEntries(entries)), {
      mode: 0o600,
    });
    await rename(filename + '.tmp', filename);
    if (this.deviceSeen.size > 1000) this.deviceSeen.clear();
    this.deviceSeen.set(identity.device_id, stamp);
  }
}
export const diagnostics = new DiagnosticStore(
  process.env.CLIENT_DIAGNOSTICS_DIR || path.resolve('var/client-diagnostics'),
);
export class DiagnosticRateLimit {
  private buckets = new Map<string, { start: number; count: number }>();
  allow(key: string, now = Date.now()): boolean {
    for (const [id, bucket] of this.buckets)
      if (now - bucket.start >= 60_000) this.buckets.delete(id);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= 1000) return false;
      bucket = { start: now, count: 0 };
      this.buckets.set(key, bucket);
    }
    return ++bucket.count <= 60;
  }
}
const uploadLimit = new DiagnosticRateLimit();
let lastStorageWarning = 0;
export function diagnosticMiddleware(req: Request, res: Response, next: NextFunction) {
  const parsed = z.string().uuid().safeParse(req.get('X-Request-ID'));
  const requestId = parsed.success ? parsed.data : randomUUID();
  res.setHeader('X-Request-ID', requestId);
  const identity = requestIdentity(req);
  if (identity)
    res.once('finish', () => {
      if (!(req as Partial<AuthRequest>).user || req.path === '/api/client-diagnostics/events')
        return;
      const events: DiagnosticEvent[] =
        res.statusCode >= 400
          ? [
              {
                id: randomUUID(),
                at: new Date().toISOString(),
                app_version: identity.app_version,
                code: 'http_error',
                status: res.statusCode,
                request_id: requestId,
              },
            ]
          : [];
      void diagnostics.save(identity, events, requestId).catch(() => {
        if (Date.now() - lastStorageWarning > 60000) {
          lastStorageWarning = Date.now();
          console.warn('Client diagnostic storage unavailable');
        }
      });
    });
  next();
}
@Controller('client-diagnostics')
export class ClientDiagnosticsController {
  @Post('events') async events(@Req() req: AuthRequest, @Body() body: unknown) {
    if (!uploadLimit.allow(req.ip ?? 'unknown'))
      throw new HttpException('诊断上传过于频繁，请稍后重试', 429);
    const identity = requestIdentity(req);
    if (!identity) throw new BadRequestException('缺少有效的客户端设备信息');
    const input = z
      .object({ events: z.array(diagnosticEventSchema).min(1).max(30) })
      .strict()
      .parse(body);
    const requestId = z.string().uuid().catch(randomUUID()).parse(req.get('X-Request-ID'));
    return { accepted: await diagnostics.save(identity, input.events, requestId) };
  }
}
