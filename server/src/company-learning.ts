import { Body, Controller, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { EntityManager } from 'typeorm';
import { db, rows, execute } from './db';
import { AuthRequest, User, manager } from './auth';
export type CompanyCode = 'tri' | 'tmy';
const rules: ReadonlyArray<{ company: CompanyCode; words: readonly string[] }> = [
  {
    company: 'tri',
    words: [
      '定制蛋糕',
      '焦糖布丁',
      '布丁烧',
      '蛋糕',
      '布丁',
      '茶歇',
      '月饼',
      '糕点',
      '蛋黄酥',
      '饼干',
      '曲奇',
      '甜品',
      '甜点',
      '点心',
      '慕斯',
      '提拉米苏',
      '泡芙',
    ],
  },
  { company: 'tmy', words: ['意大利面', '意面', '方包', '吐司', '面条', '制面', '鲜面', '面包'] },
];
export interface CompanyMatch {
  source: 'learned' | 'default' | 'fallback';
  reason: string;
  confidence: number;
  keyword: string | null;
  sample_count: number;
  agreement: number;
}
export interface CompanySuggestion {
  company_code: CompanyCode;
  company_match: CompanyMatch;
}
export interface KeywordVotes {
  keyword: string;
  company_code: CompanyCode;
  votes: number;
}
export function learningKeywords(text: string, productNames: readonly string[] = []): string[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  const words = rules.flatMap((rule) => rule.words).filter((word) => normalized.includes(word));
  const names = productNames
    .map((name) => name.normalize('NFKC').trim().toLowerCase())
    .filter((name) => name.length >= 2 && name.length <= 40 && !/^\d+$/.test(name));
  return [...new Set([...words, ...names])].slice(0, 24);
}
export function chooseCompany(text: string, votes: readonly KeywordVotes[]): CompanySuggestion {
  const normalized = text.normalize('NFKC').toLowerCase();
  const grouped = new Map<string, { tri: number; tmy: number }>();
  for (const row of votes) {
    if (!normalized.includes(row.keyword) || row.votes <= 0) continue;
    const values = grouped.get(row.keyword) ?? { tri: 0, tmy: 0 };
    values[row.company_code] += row.votes;
    grouped.set(row.keyword, values);
  }
  const learned = [...grouped]
    .map(([keyword, count]) => {
      const total = count.tri + count.tmy;
      const company: CompanyCode = count.tri > count.tmy ? 'tri' : 'tmy';
      return { keyword, total, company, ratio: count[company] / total };
    })
    .filter((v) => v.total >= 3 && v.ratio >= 0.7)
    .sort(
      (a, b) =>
        b.keyword.length - a.keyword.length ||
        b.total - a.total ||
        b.ratio - a.ratio ||
        a.keyword.localeCompare(b.keyword),
    );
  if (learned[0]) {
    const v = learned[0];
    return {
      company_code: v.company,
      company_match: {
        source: 'learned',
        reason: `“${v.keyword}”近180天${v.total}条人工纠正记录中，${Math.round(v.ratio * 100)}%选择${v.company === 'tri' ? '趣趣特' : '天美意'}`,
        confidence: v.ratio,
        keyword: v.keyword,
        sample_count: v.total,
        agreement: v.ratio,
      },
    };
  }
  const defaults = rules
    .flatMap((rule) =>
      rule.words
        .filter((word) => normalized.includes(word))
        .map((keyword) => ({ keyword, company: rule.company })),
    )
    .sort((a, b) => b.keyword.length - a.keyword.length);
  const companies = new Set(defaults.map((item) => item.company));
  if (defaults[0] && companies.size === 1) {
    const v = defaults[0];
    return {
      company_code: v.company,
      company_match: {
        source: 'default',
        reason: `主营规则：“${v.keyword}”默认归${v.company === 'tri' ? '趣趣特' : '天美意'}，可手动修改`,
        confidence: 0.8,
        keyword: v.keyword,
        sample_count: 0,
        agreement: 0,
      },
    };
  }
  return {
    company_code: 'tmy',
    company_match: {
      source: 'fallback',
      reason:
        companies.size > 1
          ? '包含两家公司主营商品，请确认公司'
          : '未匹配稳定规则，暂选天美意，请确认公司',
      confidence: 0,
      keyword: null,
      sample_count: 0,
      agreement: 0,
    },
  };
}
export async function suggestCompany(
  text: string,
  m: EntityManager = db.manager,
): Promise<CompanySuggestion> {
  const result = await rows(
    'SELECT keyword,company_code,COUNT(*) votes FROM company_choice_samples WHERE updated_at>=DATE_SUB(NOW(),INTERVAL 180 DAY) AND INSTR(?,keyword)>0 GROUP BY keyword,company_code',
    [text.normalize('NFKC').toLowerCase()],
    m,
  );
  const votes = result.map((row) => ({
    keyword: String(row.keyword),
    company_code: z.enum(['tri', 'tmy']).parse(row.company_code),
    votes: Number(row.votes),
  }));
  return chooseCompany(text, votes);
}
/** One vote per document/keyword. Corrections replace that vote instead of accumulating edits. */
export async function rememberCompany(
  kind: 'task' | 'delivery',
  recordId: string,
  u: User,
  text: string,
  m: EntityManager,
  productNames: readonly string[] = [],
  previousCompany?: string,
): Promise<void> {
  if (!u.write_company_code || previousCompany === u.company_code) return;
  const code = z.enum(['tri', 'tmy']).parse(u.company_code);
  await execute(
    'DELETE FROM company_choice_samples WHERE entity_type=? AND entity_id=?',
    [kind, recordId],
    m,
  );
  const suggestion = await suggestCompany(text, m);
  if (suggestion.company_code === code) return;
  for (const keyword of learningKeywords(text, productNames))
    await execute(
      'INSERT INTO company_choice_samples(entity_type,entity_id,keyword,company_code) VALUES(?,?,?,?)',
      [kind, recordId, keyword, code],
      m,
    );
}
export async function forgetCompany(
  kind: 'task' | 'delivery',
  recordId: string,
  m: EntityManager,
): Promise<void> {
  await execute(
    'DELETE FROM company_choice_samples WHERE entity_type=? AND entity_id=?',
    [kind, recordId],
    m,
  );
}
export async function inferredOwner(u: User, text: string, m: EntityManager): Promise<User> {
  if (!u.public_access || u.write_company_code) return u;
  const suggestion = await suggestCompany(text, m);
  const [company] = await rows(
    'SELECT id,code FROM companies WHERE code=?',
    [suggestion.company_code],
    m,
  );
  if (!company) throw new Error('Company unavailable');
  return { ...u, company_id: String(company.id), company_code: String(company.code) };
}
@Controller('company-suggestions')
export class CompanySuggestionsController {
  @Post() async suggest(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ): Promise<CompanySuggestion> {
    manager(req.user);
    const input = z
      .object({ text: z.string().max(50000) })
      .strict()
      .parse(body);
    return suggestCompany(input.text);
  }
}
