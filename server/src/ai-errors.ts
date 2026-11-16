import { HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ZodIssue } from 'zod';

export const AiErrorCode = {
  Input: 'AI_INPUT_INVALID',
  Configuration: 'AI_CONFIG_INVALID',
  Timeout: 'AI_TIMEOUT',
  Network: 'AI_NETWORK',
  Authentication: 'AI_PROVIDER_AUTH',
  RateLimit: 'AI_RATE_LIMIT',
  Unavailable: 'AI_PROVIDER_UNAVAILABLE',
  Json: 'AI_OUTPUT_JSON',
  Fields: 'AI_OUTPUT_FIELDS',
  Scope: 'AI_SCOPE_MISMATCH',
  Client: 'AI_CLIENT_UNSUPPORTED',
} as const;
export type AiErrorCode = (typeof AiErrorCode)[keyof typeof AiErrorCode];
export type AiErrorStage = 'input' | 'configuration' | 'provider' | 'validation' | 'compatibility';

export class AiRequestError extends HttpException {
  readonly errorId = randomUUID();
  constructor(
    readonly errorCode: AiErrorCode,
    readonly stage: AiErrorStage,
    message: string,
    status = 502,
    issues: readonly ZodIssue[] = [],
  ) {
    super(message, status);
    // Do not log prompts, model replies, upstream bodies, credentials or field values.
    console.warn(
      JSON.stringify({
        event: 'ai_request_failed',
        error_id: this.errorId,
        error_code: errorCode,
        stage,
        issues: issues
          .slice(0, 8)
          .map((issue) => ({
            code: issue.code,
            path: issue.path.map((part) => String(part).slice(0, 50)),
          })),
      }),
    );
  }
  metadata() {
    return { error_code: this.errorCode, error_stage: this.stage, error_id: this.errorId };
  }
}

export function aiFieldHint(issues: readonly ZodIssue[]): string {
  const fields: Record<string, string> = {
    module: '业务模块',
    title: '标题',
    items: '条目',
    source_excerpt: '原文依据',
    starts_at: '开始时间',
    ends_at: '截止时间',
    progress: '进度',
    expected_delivery_at: '交付时间',
    work_date: '排班日期',
    employee_name: '员工',
    quantity: '数量',
    unit_price: '单价',
    delivery_date: '送货日期',
    note: '备注',
  };
  const path = issues[0]?.path ?? [];
  const index = path[0] === 'items' && typeof path[1] === 'number' ? `第${path[1] + 1}项的` : '';
  const field = [...path].reverse().find((part) => typeof part === 'string' && fields[part]);
  return `${index}${typeof field === 'string' ? fields[field] : '内容'}缺失或格式不正确，请重新识别，或打开对应模块手动填写。`;
}
