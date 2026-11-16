import { z } from 'zod';

/** Logical classification paths, never filesystem paths. */
export const wikiDirectoryPath = z
  .string()
  .trim()
  .max(500)
  .transform((value, ctx) => {
    const parts = value
      .split('/')
      .filter(Boolean)
      .map((part) => part.trim());
    if (
      parts.length > 8 ||
      parts.some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          part.length > 80 ||
          /[\\\u0000-\u001f\u007f]/u.test(part),
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        message: '目录最多8级，每级1–80字，不能含反斜杠、控制字符或 .、..',
      });
      return z.NEVER;
    }
    const path = '/' + parts.join('/');
    if (path.length > 500) {
      ctx.addIssue({ code: 'custom', message: '目录路径不能超过500字' });
      return z.NEVER;
    }
    return path;
  });
export function directoryAncestors(path: string): string[] {
  const parts = wikiDirectoryPath.parse(path).split('/').filter(Boolean);
  return parts.map((_, index) => '/' + parts.slice(0, index + 1).join('/'));
}
