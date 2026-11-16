import { match } from 'pinyin-pro';

// All search surfaces share Chinese, Latin/digit, full-pinyin and initials matching.
// Keep word boundaries: multiple terms are ANDed, and never change stored names.
export function matchesText(text: string, search: string): boolean {
  const target = text.normalize('NFKC').toLowerCase();
  const tokens = search.normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every(
    (token) =>
      target.includes(token) || match(target, token, { precision: 'start', v: true }) !== null,
  );
}
