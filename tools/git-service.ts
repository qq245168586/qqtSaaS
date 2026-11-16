import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const derive = promisify(scrypt);
export interface GitServiceConfig {
  root: string;
  username: string;
  salt: string;
  passwordHash: string;
  backend: string;
}
const routes = /^\/(phase2|server|desktop|web)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/;
export function validateRoute(raw: string, method: string): URL | null {
  const url = new URL(raw, 'http://localhost');
  const match = routes.exec(url.pathname);
  if (!match) return null;
  if (method === 'GET' && match[2] === 'info/refs' && ['git-upload-pack', 'git-receive-pack'].includes(url.searchParams.get('service') ?? '')) return url;
  if (method === 'POST' && ['git-upload-pack', 'git-receive-pack'].includes(match[2] ?? '') && !url.search) return url;
  return null;
}
async function authenticated(header: string | undefined, config: GitServiceConfig): Promise<boolean> {
  if (!header?.startsWith('Basic ') || header.length > 2048) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 1) return false;
  const hash = await derive(decoded.slice(colon + 1), config.salt, 64) as Buffer;
  const expected = Buffer.from(config.passwordHash, 'hex');
  return expected.length === hash.length && timingSafeEqual(expected, hash) && decoded.slice(0, colon) === config.username;
}
function fail(response: ServerResponse, code: number, message: string): void {
  if (!response.headersSent) response.writeHead(code, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'});
  response.end(message);
}
export function createGitServer(config: GitServiceConfig) {
  return createServer((request, response) => {
    void handle(request, response, config).catch(() => fail(response, 500, 'Git service failed'));
  });
}
async function handle(request: IncomingMessage, response: ServerResponse, config: GitServiceConfig): Promise<void> {
  if (!await authenticated(request.headers.authorization, config)) {
    response.setHeader('WWW-Authenticate', 'Basic realm="TMY private Git", charset="UTF-8"');
    fail(response, 401, 'Authentication required'); return;
  }
  const url = validateRoute(request.url ?? '', request.method ?? '');
  if (!url) {fail(response, 404, 'Unknown repository endpoint'); return;}
  const contentType = request.headers['content-type'] ?? '';
  if (request.method === 'POST' && contentType !== `application/x-${url.pathname.endsWith('git-receive-pack') ? 'git-receive-pack' : 'git-upload-pack'}-request`) {
    fail(response, 415, 'Unsupported Git request'); return;
  }
  const child = spawn(config.backend, [], {env: {
    PATH: '/usr/bin:/bin', GIT_PROJECT_ROOT: config.root, GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: url.pathname, REQUEST_METHOD: request.method ?? 'GET',
    QUERY_STRING: url.search.slice(1), CONTENT_TYPE: contentType,
    ...(request.headers['content-length'] ? {CONTENT_LENGTH: request.headers['content-length']} : {}),
    REMOTE_USER: config.username, REMOTE_ADDR: '127.0.0.1',
    ...(request.headers['git-protocol'] ? {HTTP_GIT_PROTOCOL: String(request.headers['git-protocol'])} : {})
  }, stdio: ['pipe', 'pipe', 'pipe']});
  const timer = setTimeout(() => {child.kill(); fail(response, 504, 'Git operation timed out');}, 120000);
  let headers = Buffer.alloc(0);
  let headerComplete = false;
  child.stdout.on('data', (chunk: Buffer) => {
    if (headerComplete) {response.write(chunk); return;}
    headers = Buffer.concat([headers, chunk]);
    const split = headers.indexOf('\r\n\r\n');
    if (split < 0) {if (headers.length > 16384) {child.kill(); fail(response, 502, 'Invalid backend headers');} return;}
    let status = 200;
    for (const line of headers.subarray(0, split).toString('utf8').split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon < 1) continue;
      const name = line.slice(0, colon), value = line.slice(colon + 1).trim();
      if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10);
      else response.setHeader(name, value);
    }
    response.writeHead(status);
    headerComplete = true;
    response.write(headers.subarray(split + 4));
    headers = Buffer.alloc(0);
  });
  child.stderr.resume(); // Never expose process environment, credentials or repository details.
  child.stdin.on('error', () => undefined);
  child.on('error', () => {clearTimeout(timer); fail(response, 502, 'Git backend unavailable');});
  child.on('close', code => {clearTimeout(timer); if (!headerComplete) fail(response, 502, 'Git backend failed'); else if (code !== 0) response.destroy(); else response.end();});
  request.on('aborted', () => child.kill());
  response.on('close', () => {if (!response.writableEnded) child.kill();});
  request.pipe(child.stdin);
}
function loadConfig(path: string): GitServiceConfig {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid config');
  const object = parsed as Record<string, unknown>;
  for (const key of ['root', 'username', 'salt', 'passwordHash', 'backend']) if (typeof object[key] !== 'string') throw new Error(`Missing ${key}`);
  if (!/^[a-f0-9]{128}$/.test(String(object.passwordHash))) throw new Error('Invalid password hash');
  return object as unknown as GitServiceConfig;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig(process.env.GIT_SERVICE_CONFIG ?? '/etc/tmy-phase2/git-auth.json');
  createGitServer(config).listen(7001, '127.0.0.1', () => process.stdout.write('Private Git backend listening on loopback:7001\n'));
}
