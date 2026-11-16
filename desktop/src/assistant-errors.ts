import axios from 'axios';
import { z } from 'zod';

export const assistantErrorKinds = {
  AI_INPUT_INVALID: ['输入内容有问题', '检查事项内容和所选模块后重试。'],
  AI_CONFIG_INVALID: ['AI 配置异常', '请在设置中检查模型地址、名称和密钥。'],
  AI_TIMEOUT: ['AI 响应超时', '稍后重试，或将多件事项分开输入。'],
  AI_NETWORK: ['服务连接失败', '检查网络后重试；持续失败时请联系管理员。'],
  AI_PROVIDER_AUTH: ['AI 服务认证失败', '请在设置中检查 AI 密钥和服务权限。'],
  AI_RATE_LIMIT: ['AI 服务限流或额度不足', '稍后重试，或检查 AI 服务额度。'],
  AI_PROVIDER_UNAVAILABLE: ['AI 服务暂不可用', '稍后重试；持续失败时请检查模型配置。'],
  AI_OUTPUT_JSON: ['AI 返回内容无法解析', '重新识别，或将多件事项分开输入。'],
  AI_OUTPUT_FIELDS: ['AI 识别结果不完整', '重新识别，或打开对应模块手动填写。'],
  AI_SCOPE_MISMATCH: ['识别模块或原文不一致', '选择正确模块并补充说明后重试。'],
  AI_CLIENT_UNSUPPORTED: ['客户端版本不兼容', '请更新 App 后重试，本地运行版请重新加载最新页面。'],
  AI_SESSION: ['当前会话不可用', '请刷新工作台后重试，并确认当前身份有操作权限。'],
  AI_RESPONSE_INVALID: ['接口返回格式不兼容', '请刷新或更新 App 后重试；持续失败时请联系管理员。'],
  AI_UNKNOWN: ['本次识别未完成', '请重试；持续失败时可提供错误码供排查。'],
} as const;
export type AssistantErrorCode = keyof typeof assistantErrorKinds;
export interface AssistantFailure {
  code: AssistantErrorCode;
  title: string;
  message: string;
  stage: string;
  reference: string;
}
export function isValidationDump(text: string) {
  return /invalid_union|invalid_type|Invalid discriminator|No matching discriminator|ZodError|Unrecognized key|Invalid string|must match pattern|Expected .*received|^\s*\[\s*\{/i.test(
    text,
  );
}
export function assistantFailure(error: unknown): AssistantFailure {
  let code: AssistantErrorCode = 'AI_UNKNOWN';
  let message = '',
    stage = '',
    reference = '';
  const rawMessage = error instanceof Error ? error.message : '';
  if (error instanceof z.ZodError) {
    code = error.issues.some((issue) => issue.path.at(-1) === 'module')
      ? 'AI_CLIENT_UNSUPPORTED'
      : 'AI_RESPONSE_INVALID';
    stage = '客户端结果校验';
  } else if (axios.isAxiosError(error)) {
    let body: unknown = error.response?.data;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    const parsed = z
      .object({
        error_code: z.string().optional(),
        error_stage: z.string().optional(),
        error_id: z.string().optional(),
        message: z.string().optional(),
      })
      .safeParse(body);
    if (
      parsed.success &&
      parsed.data.error_code &&
      Object.hasOwn(assistantErrorKinds, parsed.data.error_code)
    ) {
      code = parsed.data.error_code as AssistantErrorCode;
      const stages: Record<string, string> = {
        input: '输入校验',
        configuration: '模型配置',
        provider: '模型调用',
        validation: '识别结果校验',
        compatibility: '客户端兼容检查',
      };
      stage = stages[parsed.data.error_stage ?? ''] ?? '';
      if (/^[0-9a-f-]{36}$/i.test(parsed.data.error_id ?? ''))
        reference = parsed.data.error_id!.slice(0, 8);
      message = parsed.data.message ?? '';
    } else if (!error.response) {
      code = /timeout|ECONNABORTED|ETIMEDOUT/i.test(`${error.code} ${rawMessage}`)
        ? 'AI_TIMEOUT'
        : 'AI_NETWORK';
    } else if ([401, 403].includes(error.response.status)) code = 'AI_SESSION';
    else if (error.response.status === 429) code = 'AI_RATE_LIMIT';
    else if ([502, 503, 504].includes(error.response.status)) code = 'AI_PROVIDER_UNAVAILABLE';
    else if (error.response.status === 400) code = 'AI_INPUT_INVALID';
    if (!message && parsed.success) message = parsed.data.message ?? '';
  } else if (/Invalid discriminator|No matching discriminator/i.test(rawMessage)) {
    code = 'AI_CLIENT_UNSUPPORTED';
    stage = '客户端结果校验';
  } else if (isValidationDump(rawMessage)) code = 'AI_RESPONSE_INVALID';
  else if (/离线|网络|连接/u.test(rawMessage)) code = 'AI_NETWORK';
  if (!message && code === 'AI_UNKNOWN') message = rawMessage;
  // Unknown errors may contain raw JSON, HTML or internal stack traces.
  if (
    !/[\u4e00-\u9fff]/u.test(message) ||
    isValidationDump(message) ||
    /[{}<>]|\n\s*at /u.test(message) ||
    message.length > 500
  )
    message = '';
  const [title, action] = assistantErrorKinds[code];
  return { code, title, message: message || action, stage, reference };
}
