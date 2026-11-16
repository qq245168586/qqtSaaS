import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import type { User } from './auth';
import { db, execute, rows } from './db';

export interface AiRuntimeConfig {
  api_base_url: string;
  api_key: string;
  model_name: string;
}

export const aiConfigInput = z
  .object({
    api_base_url: z.string().trim().url().max(255),
    api_key: z.string().max(500).optional(),
    model_name: z.string().trim().min(1).max(100),
    admin_password: z.string().max(1024).optional(),
  })
  .strict();

function endpoint(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        process.env.NODE_ENV !== 'production' &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      ))
  )
    throw new BadRequestException('AI API 地址必须使用 HTTPS，且不能包含账号或查询参数');
  return value.replace(/\/+$/u, '');
}

function encryptionKey(): Buffer {
  const value = process.env.AI_ENCRYPTION_KEY;
  if (!value || Buffer.byteLength(value) < 32)
    throw new ServiceUnavailableException('服务器尚未配置 AI 设置加密密钥');
  return createHash('sha256').update(value, 'utf8').digest();
}

export function encryptAiKey(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptAiKey(value: string): string {
  const [version, ivText, tagText, encryptedText, ...extra] = value.split(':');
  if (version !== 'v1' || !ivText || !tagText || !encryptedText || extra.length)
    throw new ServiceUnavailableException('AI API Key 密文格式无效');
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivText, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new ServiceUnavailableException('AI API Key 无法解密，请重新保存设置');
  }
}

async function saved(companyId: string, manager: EntityManager): Promise<Record<string, unknown>> {
  const [row] = await rows('SELECT * FROM ai_configs WHERE company_id=?', [companyId], manager);
  return row ?? {};
}

export async function aiConfigView(
  companyId: string,
  manager: EntityManager = db.manager,
): Promise<{
  api_base_url: string;
  model_name: string;
  api_key_configured: boolean;
  source: 'company' | 'server';
}> {
  const row = await saved(companyId, manager);
  return {
    api_base_url: String(row.api_base_url ?? process.env.AI_API_BASE_URL ?? ''),
    model_name: String(row.model_name ?? process.env.AI_MODEL_NAME ?? ''),
    api_key_configured: Boolean(row.api_key_encrypted || process.env.AI_API_KEY),
    source: row.id ? 'company' : 'server',
  };
}

export async function resolveAiConfig(
  companyId: string,
  manager: EntityManager = db.manager,
): Promise<AiRuntimeConfig> {
  const row = await saved(companyId, manager);
  const rawBaseUrl = String(row.api_base_url ?? process.env.AI_API_BASE_URL ?? '').trim();
  const model_name = String(row.model_name ?? process.env.AI_MODEL_NAME ?? '').trim();
  const api_key = row.api_key_encrypted
    ? decryptAiKey(String(row.api_key_encrypted))
    : String(process.env.AI_API_KEY ?? '').trim();
  if (!rawBaseUrl || !model_name || !api_key)
    throw new ServiceUnavailableException('尚未完整配置 AI 服务');
  const api_base_url = endpoint(rawBaseUrl);
  return { api_base_url, api_key, model_name };
}

export async function saveAiConfig(
  user: User,
  input: z.infer<typeof aiConfigInput>,
  manager: EntityManager = db.manager,
): Promise<void> {
  const current = await saved(user.company_id, manager);
  const nextKey = input.api_key?.trim();
  if (!nextKey && !current.api_key_encrypted && !process.env.AI_API_KEY)
    throw new BadRequestException('请输入 AI API Key');
  const encrypted = nextKey ? encryptAiKey(nextKey) : (current.api_key_encrypted ?? null);
  await execute(
    `INSERT INTO ai_configs(company_id,api_base_url,model_name,api_key_encrypted,updated_by)
     VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE api_base_url=VALUES(api_base_url),model_name=VALUES(model_name),api_key_encrypted=VALUES(api_key_encrypted),updated_by=VALUES(updated_by)`,
    [user.company_id, endpoint(input.api_base_url), input.model_name, encrypted, user.id],
    manager,
  );
}
