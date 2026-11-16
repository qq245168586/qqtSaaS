import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Post,
  Req,
  Res,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db, rows, insert, execute, Row, now } from './db';
import {
  publicAccessEnabled,
  webPasswordRequired,
  WebPasswordGate,
  publicIdentity,
  enforcePublicAccess,
  enforceWikiAccess,
  createPublicSession,
} from './public-access';
import { preparePublicContext } from './company-scope';
export interface User {
  id: string;
  company_id: string;
  company_code: string;
  username: string;
  real_name: string;
  role: 'boss' | 'admin' | 'employee';
  employee_id: string | null;
  must_change_password: boolean;
  public_access?: boolean;
  write_company_id?: string;
  write_company_code?: string;
}
export interface AuthRequest extends Request {
  user: User;
}
const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s || Buffer.byteLength(s) < 32) throw new Error('JWT_SECRET 至少需要 32 字节');
  return s;
};
function user(row: Row): User {
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    company_code: String(row.company_code),
    username: String(row.username),
    real_name: String(row.real_name),
    role: z.enum(['boss', 'admin', 'employee']).parse(row.role),
    employee_id: row.employee_id ? String(row.employee_id) : null,
    must_change_password: !!row.must_change_password,
  };
}
export const manager = (u: User): void => {
  if (u.role === 'employee') throw new ForbiddenException('此操作需要管理员权限');
};
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
async function loadUser(id: string): Promise<User> {
  const [r] = await rows(
    "SELECT u.*,c.code company_code FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=? AND u.deleted_at IS NULL AND u.status='active'",
    [id],
  );
  if (!r) throw new UnauthorizedException('账号不存在或已停用');
  return user(r);
}
@Injectable()
export class AuthGuard implements CanActivate {
  private restoring = false;
  private writes = 0;
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (
      [
        '/api/health',
        '/api/auth/login',
        '/api/auth/refresh',
        '/api/auth/enter',
        '/api/auth/access-mode',
        '/api/files/image',
      ].includes(req.path)
    )
      return true;
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new UnauthorizedException('请先登录');
    let wikiAccess: unknown;
    try {
      const parsed = jwt.verify(token, secret(), {
        algorithms: ['HS256'],
        issuer: 'tmytri-api',
        audience: 'tmytri-client',
      });
      if (typeof parsed === 'string' || typeof parsed.sub !== 'string')
        throw new Error('Invalid token');
      req.user = await loadUser(parsed.sub);
      if (req.user.company_id !== parsed.company_id) throw new Error('Invalid tenant');
      req.user = publicIdentity(req.user, parsed.public_access);
      wikiAccess = parsed.wiki_access;
    } catch {
      throw new UnauthorizedException('登录已过期');
    }
    enforcePublicAccess(req.user, req.path);
    enforceWikiAccess(wikiAccess, req.path);
    await preparePublicContext(req);
    if (
      req.user.must_change_password &&
      !['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'].includes(req.path)
    )
      throw new ForbiddenException('首次登录请修改密码');
    if (this.restoring) throw new BadRequestException('恢复维护中，请稍后重试');
    const isRestore = req.path === '/api/backup/restore';
    if (isRestore && this.writes > 0)
      throw new BadRequestException('有写入操作进行中，请稍后重试恢复');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (isRestore) this.restoring = true;
      else this.writes++;
      let finished = false;
      const release = () => {
        if (finished) return;
        finished = true;
        if (isRestore) this.restoring = false;
        else this.writes--;
      };
      const response = context.switchToHttp().getResponse<Response>();
      response.once('finish', release);
      response.once('close', release);
    }
    return true;
  }
}
const sessionSchema = z
  .object({ client: z.enum(['desktop', 'web']), refresh_token: z.string().max(512).optional() })
  .strict();
const failures = new Map<string, { count: number; until: number }>();
@Controller('auth')
export class AuthController {
  private readonly webPasswordGate = new WebPasswordGate();
  @Get('access-mode') accessMode(): { public_access: boolean; web_password_required: boolean } {
    return { public_access: publicAccessEnabled(), web_password_required: webPasswordRequired() };
  }
  @Post('enter') async enter(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ access_token: string; user: User }> {
    if (!publicAccessEnabled()) throw new ForbiddenException('公开访问未开启');
    const input = z
      .object({
        company_code: z.enum(['tri', 'tmy']).optional(),
        password: z.string().max(1024).optional(),
        client: z.enum(['web', 'desktop', 'wiki']),
      })
      .strict()
      .parse(body);
    this.webPasswordGate.check(
      input.client,
      input.password,
      req.ip ?? req.socket.remoteAddress ?? 'unknown',
    );
    const [account] = await rows(
      "SELECT u.*,c.code company_code FROM users u JOIN companies c ON c.id=u.company_id WHERE c.code=? AND u.deleted_at IS NULL AND u.status='active' AND u.role IN ('boss','admin') ORDER BY (u.username='admin') DESC,(u.role='boss') DESC,u.id ASC LIMIT 1",
      ['tmy'],
    );
    if (!account) throw new UnauthorizedException('该公司没有可用管理员身份');
    return createPublicSession(
      user(account),
      secret(),
      publicAccessEnabled(),
      input.client === 'wiki' ? 'wiki' : undefined,
    );
  }

  private async session(
    u: User,
    client: 'web' | 'desktop',
    res: Response,
    token: string,
  ): Promise<Row> {
    const access_token = jwt.sign(
      { company_id: u.company_id, role: u.role, username: u.username },
      secret(),
      { subject: u.id, expiresIn: '2h', issuer: 'tmytri-api', audience: 'tmytri-client' },
    );
    if (client === 'web')
      res.cookie('tmy_refresh', token, {
        httpOnly: true,
        secure: process.env.COOKIE_SECURE !== 'false',
        sameSite: 'strict',
        path: '/api/auth',
        maxAge: 30 * 86400000,
      });
    return { access_token, user: u, ...(client === 'desktop' ? { refresh_token: token } : {}) };
  }
  private async token(userId: string): Promise<string> {
    const token = randomBytes(48).toString('base64url');
    await insert('refresh_tokens', {
      user_id: userId,
      token_hash: digest(token),
      expires_at: new Date(Date.now() + 30 * 86400000 + 8 * 3600000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' '),
    });
    return token;
  }
  @Post('login') async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Row> {
    const b = z
      .object({
        company_code: z.enum(['tri', 'tmy']),
        username: z.string().trim().min(1).max(50),
        password: z.string().min(1).max(128),
        client: z.enum(['desktop', 'web']),
      })
      .strict()
      .parse(body);
    const key = `${req.ip}:${b.company_code}:${b.username}`;
    const f = failures.get(key);
    if (f && f.until > Date.now()) throw new UnauthorizedException('尝试过多，请 30 秒后重试');
    const [r] = await rows(
      "SELECT u.*,c.code company_code FROM users u JOIN companies c ON c.id=u.company_id WHERE c.code=? AND u.username=? AND u.deleted_at IS NULL AND u.status='active'",
      [b.company_code, b.username],
    );
    if (!r || !(await compare(b.password, String(r.password_hash)))) {
      const count = (f?.count ?? 0) + 1;
      if (failures.size > 10000) failures.clear();
      failures.set(key, {
        count: count >= 5 ? 0 : count,
        until: count >= 5 ? Date.now() + 30000 : 0,
      });
      throw new UnauthorizedException('账号或密码错误');
    }
    failures.delete(key);
    const u = user(r);
    await execute('UPDATE users SET last_login_at=? WHERE id=?', [now(), u.id]);
    return this.session(u, b.client, res, await this.token(u.id));
  }
  @Post('refresh') async refresh(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Row> {
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (bearer) {
      try {
        const claims = jwt.verify(bearer, secret(), {
          ignoreExpiration: true,
          algorithms: ['HS256'],
          issuer: 'tmytri-api',
          audience: 'tmytri-client',
        });
        if (typeof claims !== 'string' && claims.public_access === true)
          throw new UnauthorizedException('公开模式没有刷新凭证，请重新进入工作台');
      } catch (error: unknown) {
        if (error instanceof UnauthorizedException) throw error;
        throw new UnauthorizedException('刷新时登录凭证无效');
      }
    }
    const b = sessionSchema.parse(body);
    const cookies: unknown = req.cookies;
    const cookie = z.record(z.unknown()).safeParse(cookies);
    const token =
      b.client === 'web' ? (cookie.success ? cookie.data.tmy_refresh : undefined) : b.refresh_token;
    if (typeof token !== 'string') throw new UnauthorizedException('缺少刷新凭证');
    const result = await db.transaction(async (m) => {
      const [r] = await rows(
        'SELECT * FROM refresh_tokens WHERE token_hash=? FOR UPDATE',
        [digest(token)],
        m,
      );
      if (!r || r.revoked_at || String(r.expires_at) <= now())
        throw new UnauthorizedException('刷新凭证已失效');
      await execute('UPDATE refresh_tokens SET revoked_at=? WHERE id=?', [now(), r.id], m);
      const next = randomBytes(48).toString('base64url');
      await insert(
        'refresh_tokens',
        {
          user_id: r.user_id,
          token_hash: digest(next),
          expires_at: new Date(Date.now() + 30 * 86400000 + 8 * 3600000)
            .toISOString()
            .slice(0, 19)
            .replace('T', ' '),
        },
        m,
      );
      return { userId: String(r.user_id), next };
    });
    return this.session(await loadUser(result.userId), b.client, res, result.next);
  }
  @Get('me') me(@Req() req: AuthRequest): User {
    return req.user;
  }
  @Post('logout') async logout(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<null> {
    const b = sessionSchema.parse(body);
    const c = z.record(z.unknown()).safeParse(req.cookies);
    const token =
      b.client === 'web' ? (c.success ? c.data.tmy_refresh : undefined) : b.refresh_token;
    if (typeof token === 'string')
      await execute('UPDATE refresh_tokens SET revoked_at=? WHERE user_id=? AND token_hash=?', [
        now(),
        req.user.id,
        digest(token),
      ]);
    res.clearCookie('tmy_refresh', { path: '/api/auth' });
    return null;
  }
  @Post('change-password') async change(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<null> {
    const b = z
      .object({
        current_password: z.string().max(128),
        new_password: z
          .string()
          .min(8)
          .refine((p) => Buffer.byteLength(p) <= 72, '密码不得超过 72 字节'),
      })
      .strict()
      .parse(body);
    const [r] = await rows('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
    if (!r || !(await compare(b.current_password, String(r.password_hash))))
      throw new BadRequestException('原密码错误');
    await db.transaction(async (m) => {
      await execute(
        'UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?',
        [await hash(b.new_password, 12), req.user.id],
        m,
      );
      await execute(
        'UPDATE refresh_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',
        [now(), req.user.id],
        m,
      );
    });
    return null;
  }
}
