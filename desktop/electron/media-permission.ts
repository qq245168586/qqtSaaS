import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function trustedMediaUrl(
  url: string,
  expectedFile: string,
  development: boolean,
  windows = process.platform === 'win32',
): boolean {
  if (development && url === 'http://127.0.0.1:5176') return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    const paths = windows ? path.win32 : path.posix;
    return paths.resolve(fileURLToPath(parsed, { windows })) === paths.resolve(expectedFile);
  } catch {
    return false;
  }
}
