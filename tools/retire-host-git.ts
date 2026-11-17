/** Explicit, one-time retirement of the former Git HTTP host; business services stay running. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = '/srv/tmy-phase2';
const nginxPath = '/etc/nginx/conf.d/tmy-phase2.conf';
const unitPath = '/etc/systemd/system/tmy-git.service';
function run(program: string, args: string[]): string {
  return execFileSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('Run as root on the authorized ECS host');
const original = readFileSync(nginxPath, 'utf8');
const route = /location \/git\/ \{[^{}]*proxy_pass http:\/\/127\.0\.0\.1:7001\/;[^{}]*\}/g;
if ([...original.matchAll(route)].length !== 1) throw new Error('Expected exactly one legacy Git proxy; inspect host before proceeding');
const replacement = original
  .replace(/^limit_req_zone \$binary_remote_addr zone=tmy_git:10m rate=10r\/s;\n/m, '')
  .replace(route, 'location ^~ /git/ { return 410; }');
for (const service of ['tmy-api', 'nginx', 'mysqld']) {
  if (run('systemctl', ['is-active', service]) !== 'active') throw new Error(`${service} not active`);
}
for (const repo of ['phase2', 'server', 'desktop', 'web']) {
  const path = `${base}/git/${repo}.git`;
  run('git', ['-c', `safe.directory=${path}`, '--git-dir', path, 'fsck', '--full']);
}
if (!process.argv.includes('--apply')) {
  console.log('Preflight passed; --apply disables Git, returns HTTP 410, and archives history/config privately.');
  process.exit(0);
}
process.umask(0o077);
const archive = `/var/backups/tmy-phase2/git-retired-${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(archive, { recursive: true, mode: 0o700 });
writeFileSync(join(archive, 'nginx-before.conf'), original, { flag: 'wx', mode: 0o600 });
run('systemctl', ['disable', '--now', 'tmy-git']);
try {
  writeFileSync(nginxPath, replacement);
  run('nginx', ['-t']);
  run('systemctl', ['reload', 'nginx']);
} catch (error: unknown) {
  writeFileSync(nginxPath, original);
  run('nginx', ['-t']);
  run('systemctl', ['reload', 'nginx']);
  run('systemctl', ['enable', '--now', 'tmy-git']);
  throw error;
}
// Move, rather than erase, the old history and authentication file. None is publicly served.
for (const [source, name] of [
  [`${base}/git`, 'repositories'],
  [unitPath, 'tmy-git.service'],
  ['/etc/tmy-phase2/git-auth.json', 'git-auth.json'],
  [`${base}/infra/tools/git-service.js`, 'git-service.js'],
  [`${base}/infra/tools/git-credentials.js`, 'git-credentials.js'],
] as const) {
  if (existsSync(source)) renameSync(source, join(archive, name));
}
run('systemctl', ['daemon-reload']);
run('systemctl', ['mask', 'tmy-git.service']);
if (run('systemctl', ['show', 'tmy-git', '--property=ActiveState', '--value']) !== 'inactive') throw new Error('Git still active');
if (run('ss', ['-ltn']).split('\n').some(line => /:7001\s/.test(line))) throw new Error('Git port still listening');
for (const service of ['tmy-api', 'nginx', 'mysqld']) run('systemctl', ['is-active', service]);
console.log(JSON.stringify({ retired: true, archive, repository: 'git@github.com:qq245168586/qqtSaaS.git' }));
