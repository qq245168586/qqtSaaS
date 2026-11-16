import { BadRequestException, Body, Controller, Post, Req } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { z } from 'zod';
import { AuthRequest, User, manager } from './auth';
import { db, Row, rows } from './db';
import { learningKeywords } from './company-learning';
import { id } from './validation';

import { businessDate, businessToday, employeeAvailable } from './employee-policy';
export interface AssigneeCandidate extends Row {
  id: string;
  name: string;
  department_id: string;
  department_name: string;
}

export interface AssigneeVote {
  assignee_employee_id: string;
  votes: number;
  keyword: string;
}

export interface AssigneeSuggestion {
  employee_id: string | null;
  reason: string;
  source: 'history' | 'business' | 'manual';
  sample_count: number;
}

export function normalizedDepartmentName(value: unknown): string {
  return typeof value === 'string'
    ? value
        .normalize('NFKC')
        .replace(/\s+/gu, '')
        .replace(/(?:部门|部|组)$/u, '')
    : '';
}

export function businessCandidates(
  employees: readonly Record<string, unknown>[],
  departmentName: string,
  documentDate = businessToday(),
): AssigneeCandidate[] {
  const wanted = normalizedDepartmentName(departmentName);
  return employees
    .filter(
      (employee) =>
        employeeAvailable(employee, documentDate) &&
        employee.deleted_at == null &&
        normalizedDepartmentName(employee.department_name) === wanted,
    )
    .map((employee) => ({
      ...employee,
      id: String(employee.id),
      name: String(employee.name),
      department_id: String(employee.department_id),
      department_name: String(employee.department_name),
    }));
}

export function chooseAssignee(
  candidates: readonly AssigneeCandidate[],
  votes: readonly AssigneeVote[],
): AssigneeSuggestion {
  const allowed = new Set(candidates.map((candidate) => candidate.id));
  const totals = new Map<string, { score: number; samples: number; keyword: string }>();
  for (const vote of votes) {
    if (!allowed.has(vote.assignee_employee_id) || vote.votes <= 0) continue;
    const old = totals.get(vote.assignee_employee_id) ?? { score: 0, samples: 0, keyword: '' };
    const score = vote.votes * Math.max(1, [...vote.keyword].length);
    totals.set(vote.assignee_employee_id, {
      score: old.score + score,
      samples: old.samples + vote.votes,
      keyword: vote.keyword.length > old.keyword.length ? vote.keyword : old.keyword,
    });
  }
  const ranked = [...totals].sort(
    (a, b) => b[1].score - a[1].score || b[1].samples - a[1].samples || a[0].localeCompare(b[0]),
  );
  if (ranked[0] && (!ranked[1] || ranked[0][1].score > ranked[1][1].score)) {
    const [employeeId, result] = ranked[0];
    const employee = candidates.find((candidate) => candidate.id === employeeId);
    return {
      employee_id: employeeId,
      source: 'history',
      sample_count: result.samples,
      reason: `历史任务中“${result.keyword}”优先由${employee?.name ?? '该员工'}执行（${result.samples}次）`,
    };
  }
  if (candidates.length === 1)
    return {
      employee_id: candidates[0].id,
      source: 'business',
      sample_count: 0,
      reason: `${candidates[0].department_name}当前唯一在岗执行人：${candidates[0].name}`,
    };
  return {
    employee_id: null,
    source: 'manual',
    sample_count: 0,
    reason: candidates.length ? '该业务部门有多名执行人，请人工选择' : '该业务部门暂无在岗执行人',
  };
}

function like(value: string): string {
  return `%${value.replace(/[!%_]/gu, (character) => `!${character}`)}%`;
}

export async function suggestAssignee(
  u: User,
  departmentId: string,
  text: string,
  m: EntityManager = db.manager,
  documentDate = businessToday(),
): Promise<AssigneeSuggestion> {
  id.parse(departmentId);
  const [department] = await rows(
    'SELECT d.id,d.name FROM departments d WHERE d.id=? AND d.deleted_at IS NULL',
    [departmentId],
    m,
  );
  if (!department) throw new BadRequestException('部门不存在');
  const employees = await rows(
    `SELECT e.id,e.name,e.department_id,e.status,e.left_on,e.deleted_at,d.name department_name
       FROM employees e JOIN departments d ON d.id=e.department_id
      WHERE e.deleted_at IS NULL AND d.deleted_at IS NULL`,
    [],
    m,
  );
  const candidates = businessCandidates(employees, String(department.name), documentDate);
  if (!candidates.length) return chooseAssignee(candidates, []);
  const candidateIds = candidates.map((candidate) => candidate.id);
  const votes: AssigneeVote[] = [];
  for (const keyword of learningKeywords(text)) {
    const pattern = like(keyword);
    const result = await rows(
      `SELECT t.assignee_employee_id,COUNT(*) votes
         FROM tasks t
        WHERE t.deleted_at IS NULL AND t.assignee_employee_id IN (${candidateIds.map(() => '?').join(',')})
          AND (t.title LIKE ? ESCAPE '!' OR t.detail LIKE ? ESCAPE '!' OR t.source_text LIKE ? ESCAPE '!')
        GROUP BY t.assignee_employee_id`,
      [...candidateIds, pattern, pattern, pattern],
      m,
    );
    for (const resultVote of result)
      votes.push({
        assignee_employee_id: String(resultVote.assignee_employee_id),
        votes: Number(resultVote.votes),
        keyword,
      });
  }
  return chooseAssignee(candidates, votes);
}

@Controller('assignee-suggestions')
export class AssigneeSuggestionsController {
  @Post() async suggest(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ): Promise<AssigneeSuggestion> {
    manager(req.user);
    const input = z
      .object({
        department_id: id,
        text: z.string().max(50000).default(''),
        document_date: businessDate.optional(),
      })
      .strict()
      .parse(body);
    return suggestAssignee(
      req.user,
      input.department_id,
      input.text,
      db.manager,
      input.document_date,
    );
  }
}
