import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

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
type Details = Omit<DiagnosticEvent, 'id' | 'at' | 'app_version' | 'code'>;
export interface ClientIdentity {
  device_id: string;
  app_version: string;
  platform: string;
  arch: string;
}

export function safeError(error: unknown): Pick<Details, 'error_type' | 'frames'> {
  // Do not collect error.message: it may contain SQL, names, addresses or tokens.
  const known = [
    'Error',
    'TypeError',
    'RangeError',
    'SyntaxError',
    'ReferenceError',
    'URIError',
    'EvalError',
    'ZodError',
    'AbortError',
    'TimeoutError',
    'AxiosError',
  ];
  const name = error instanceof Error && known.includes(error.name) ? error.name : 'Error';
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  const frames = stack
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const match = line.match(/(?:[/\\])([a-zA-Z0-9_.-]+\.[cm]?js:\d+:\d+)\)?$/);
      return match ? [match[1].slice(0, 120)] : [];
    })
    .slice(0, 8);
  return { error_type: name, frames };
}
export function safeRoute(url: string): string {
  const pathname = new URL(url, 'http://local').pathname;
  return pathname
    .split('/')
    .map((part) => (/^[a-zA-Z][a-zA-Z_-]*$/.test(part) ? part : part ? ':id' : ''))
    .join('/')
    .slice(0, 160);
}
export function clientHeaders(
  identity: ClientIdentity,
  requestId = randomUUID(),
): Record<string, string> {
  return {
    'User-Agent': `TMY-TRI-Manager/${identity.app_version} (${identity.platform}; ${identity.arch}) Device/${identity.device_id}`,
    'X-App-Version': identity.app_version,
    'X-Device-ID': identity.device_id,
    'X-Client-Platform': identity.platform,
    'X-Client-Arch': identity.arch,
    'X-Request-ID': requestId,
  };
}
export class ClientDiagnostics {
  readonly identity: ClientIdentity;
  private events: DiagnosticEvent[] = [];
  private readonly file: string;
  private flushing = false;
  private last = new Map<string, number>();
  constructor(directory: string, appVersion: string, platform: string, arch: string) {
    try {
      mkdirSync(directory, { recursive: true });
    } catch {
      /* Never block startup for diagnostics. */
    }
    const idFile = path.join(directory, 'client-device-id');
    let deviceId: string;
    try {
      deviceId = z.string().uuid().parse(readFileSync(idFile, 'utf8').trim());
    } catch {
      deviceId = randomUUID();
      try {
        writeFileSync(idFile, deviceId, { mode: 0o600 });
      } catch {
        /* Ephemeral identity if local disk is not writable. */
      }
    }
    this.identity = { device_id: deviceId, app_version: version.parse(appVersion), platform, arch };
    this.file = path.join(directory, 'client-diagnostics.json');
    try {
      const text = readFileSync(this.file, 'utf8');
      if (text.length < 1024 * 1024)
        this.events = z.array(diagnosticEventSchema).max(200).parse(JSON.parse(text));
    } catch {
      /* A corrupt queue never blocks app startup. */
    }
  }
  private persist() {
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify(this.events), { mode: 0o600 });
      renameSync(this.file + '.tmp', this.file);
    } catch {
      /* Diagnostics must not interrupt business work. */
    }
  }
  record(code: DiagnosticEvent['code'], details: Details = {}): void {
    const parsed = diagnosticEventSchema.safeParse({
      id: randomUUID(),
      at: new Date().toISOString(),
      app_version: this.identity.app_version,
      code,
      ...details,
    });
    if (!parsed.success) return;
    const key = JSON.stringify([
      code,
      details.phase,
      details.route,
      details.status,
      details.error_type,
    ]);
    const now = Date.now();
    if (now - (this.last.get(key) ?? 0) < 10_000) return;
    if (this.last.size > 200) this.last.clear();
    this.last.set(key, now);
    this.events = [...this.events, parsed.data].slice(-200);
    this.persist();
  }
  async flush(send: (events: DiagnosticEvent[]) => Promise<string[]>): Promise<void> {
    if (this.flushing || !this.events.length) return;
    this.flushing = true;
    try {
      const batch = this.events.slice(0, 30);
      const accepted = new Set(await send(batch));
      const sent = new Set(batch.map((event) => event.id));
      this.events = this.events.filter((event) => !sent.has(event.id) || !accepted.has(event.id));
      this.persist();
    } catch {
      /* Keep the bounded queue for a later retry; never log upload failures recursively. */
    } finally {
      this.flushing = false;
    }
  }
}
