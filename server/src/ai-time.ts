import { minute } from './validation';

const dateMarker =
  /(?:今天|今日|明天|明日|后天|大后天|周[一二三四五六日天]|星期[一二三四五六日天]|\d{4}\s*[年\-/]\s*\d{1,2}\s*[月\-/]\s*\d{1,2}\s*[日号]?|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|(?:^|\D)\d{1,2}\s*[日号](?:\D|$))/u;
const clockMarker = /(?:\d{1,2}\s*[:：]\s*\d{2}|\d{1,2}\s*[点时](?:\s*(?:半|\d{1,2}\s*分?))?)/u;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${year}-${pad(month)}-${pad(day)}`
    : null;
}

function relativeDate(current: string, days: number): string {
  const [year, month, day] = current.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateFromText(source: string, current: string): string | null {
  if (/大后天/u.test(source)) return relativeDate(current, 3);
  if (/后天/u.test(source)) return relativeDate(current, 2);
  if (/明天|明日/u.test(source)) return relativeDate(current, 1);
  if (/今天|今日/u.test(source)) return current.slice(0, 10);
  const full = /(\d{4})\s*[年\-/]\s*(\d{1,2})\s*[月\-/]\s*(\d{1,2})\s*[日号]?/u.exec(source);
  if (full) return validDate(Number(full[1]), Number(full[2]), Number(full[3]));
  const monthDay = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/u.exec(source);
  if (monthDay)
    return validDate(Number(current.slice(0, 4)), Number(monthDay[1]), Number(monthDay[2]));
  const day = /(?:^|\D)(\d{1,2})\s*[日号](?:\D|$)/u.exec(source);
  if (day)
    return validDate(Number(current.slice(0, 4)), Number(current.slice(5, 7)), Number(day[1]));
  return null;
}

function timeFromText(source: string): string | null {
  const colon = /(\d{1,2})\s*[:：]\s*(\d{2})/u.exec(source);
  if (colon) {
    const hour = Number(colon[1]);
    const minuteValue = Number(colon[2]);
    return hour <= 23 && minuteValue <= 59 ? `${pad(hour)}:${pad(minuteValue)}` : null;
  }
  const chinese =
    /(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*[点时](?:\s*(半|\d{1,2})\s*分?)?/u.exec(source);
  if (!chinese) return null;
  let hour = Number(chinese[2]);
  const period = chinese[1] ?? '';
  if (/下午|晚上/u.test(period) && hour < 12) hour += 12;
  if (/凌晨/u.test(period) && hour === 12) hour = 0;
  const minuteValue = chinese[3] === '半' ? 30 : Number(chinese[3] ?? 0);
  return hour <= 23 && minuteValue <= 59 ? `${pad(hour)}:${pad(minuteValue)}` : null;
}

/** Source text is authoritative: the model may not invent a missing delivery date. */
export function normalizeAiExpectedDelivery(
  source: string,
  suggested: string | null,
  current: string,
): string | null {
  if (!dateMarker.test(source)) return null;
  const parsedSuggestion = suggested && minute.safeParse(suggested).success ? suggested : null;
  const date = dateFromText(source, current) ?? parsedSuggestion?.slice(0, 10) ?? null;
  if (!date) return null;
  const hasClock = clockMarker.test(source);
  const explicitTime = hasClock ? timeFromText(source) : null;
  if (hasClock && !explicitTime && parsedSuggestion) return parsedSuggestion;
  return minute.parse(`${date} ${explicitTime ?? '09:00'}`);
}
