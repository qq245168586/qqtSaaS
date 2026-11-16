import { ForbiddenException, UnauthorizedException, HttpException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { User } from './auth';
export function publicAccessEnabled(): boolean {
  return process.env.PUBLIC_ACCESS === 'true';
}
export function publicIdentity(user: User, claim: unknown, enabled = publicAccessEnabled()): User {
  if (claim === undefined || claim === false) return user;
  if (claim !== true || !enabled || user.role === 'employee')
    throw new UnauthorizedException('公开访问已关闭或管理员身份不可用');
  return { ...user, public_access: true, must_change_password: false };
}
export function enforcePublicAccess(user: User, path: string): void {
  if (!user.public_access) return;
  const normalized = path.toLowerCase().replace(/\/+$/, '');
  if (
    normalized === '/api/users' ||
    normalized.startsWith('/api/users/') ||
    normalized === '/api/auth/change-password' ||
    normalized === '/api/backup' ||
    normalized.startsWith('/api/backup/')
  )
    throw new ForbiddenException('公开模式不能管理账户、修改密码或访问备份');
}
export function enforceWikiAccess(claim: unknown, path: string): void {
  if (claim === undefined || claim === false) return;
  if (claim !== true || !path.toLowerCase().replace(/\/+$/, '').startsWith('/api/wiki/'))
    throw new ForbiddenException('Confluence 公开会话只能访问知识库');
}
export function createPublicSession(
  user: User,
  secret: string,
  enabled = publicAccessEnabled(),
  scope?: 'wiki',
): { access_token: string; user: User } {
  const identity = publicIdentity(user, true, enabled);
  if (Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET至少32字节');
  const access_token = jwt.sign(
    {
      company_id: identity.company_id,
      role: identity.role,
      username: identity.username,
      public_access: true,
      ...(scope === 'wiki' ? { wiki_access: true } : {}),
    },
    secret,
    { subject: identity.id, expiresIn: '2h', issuer: 'tmytri-api', audience: 'tmytri-client' },
  );
  return { access_token, user: identity };
}

export function webPasswordRequired(): boolean {
  return Boolean(process.env.WEB_ACCESS_PASSWORD);
}
/** In-memory failure window for the single-process API. Desktop access remains intentionally open. */
export class WebPasswordGate {
  private readonly failures = new Map<string, { count: number; until: number }>();
  check(
    client: 'web' | 'desktop' | 'wiki',
    password: string | undefined,
    ip: string,
    expected = process.env.WEB_ACCESS_PASSWORD,
    time = Date.now(),
  ): void {
    if (client !== 'web' || !expected) return;
    for (const [key, value] of this.failures) if (value.until <= time) this.failures.delete(key);
    const prior = this.failures.get(ip);
    if (prior && prior.count >= 10)
      throw new HttpException('密码尝试过于频繁，请15分钟后再试', 429);
    const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();
    if (!timingSafeEqual(digest(password ?? ''), digest(expected))) {
      if (this.failures.size >= 10000 && !prior)
        throw new HttpException('密码验证繁忙，请稍后再试', 429);
      this.failures.set(ip, {
        count: (prior?.count ?? 0) + 1,
        until: prior?.until ?? time + 15 * 60 * 1000,
      });
      throw new UnauthorizedException('网页访问密码错误');
    }
    this.failures.delete(ip);
  }
}
