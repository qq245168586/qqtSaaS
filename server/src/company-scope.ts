import { z } from 'zod';
import { rows, Row } from './db';
import type { AuthRequest, User } from './auth';
export function companyFilter(u: User, column = 'company_id'): { sql: string; params: unknown[] } {
  return u.public_access
    ? { sql: '1=1', params: [] }
    : { sql: `${column}=?`, params: [u.company_id] };
}
export function companyColumns(alias: string): string {
  return `(SELECT code FROM companies WHERE id=${alias}.company_id) company_code,(SELECT name FROM companies WHERE id=${alias}.company_id) company_name`;
}
export function writeUser(u: User, record?: Row): User {
  return {
    ...u,
    company_id: u.write_company_id ?? (record ? String(record.company_id) : u.company_id),
    company_code: u.write_company_code ?? (record ? String(record.company_code) : u.company_code),
  };
}
export async function preparePublicContext(req: AuthRequest): Promise<void> {
  if (!req.user.public_access || req.path.toLowerCase().startsWith('/api/print-templates')) return;
  let requested: string | undefined;
  const body: unknown = req.body;
  if (body && typeof body === 'object' && !Array.isArray(body) && 'company_code' in body) {
    const record = body as Row;
    requested = z.enum(['tri', 'tmy']).parse(record.company_code);
    delete record.company_code;
  }
  const primary: Record<string, string> = {
    tasks: 'tasks',
    'delivery-notes': 'delivery_notes',
    departments: 'departments',
    employees: 'employees',
    categories: 'categories',
    'customer-categories': 'customer_categories',
    customers: 'customers',
    products: 'products',
    personnel: 'personnel',
  };
  const resource = req.path.toLowerCase().split('/')[2] ?? '';
  let table = primary[resource];
  let recordId = req.params.id;
  if (req.params.taskId) {
    table = 'tasks';
    recordId = req.params.taskId;
  }
  if (req.params.imageId) {
    table = 'task_images';
    recordId = req.params.imageId;
  }
  if (recordId && table) {
    const [record] = await rows(
      `SELECT c.id,c.code FROM ${table} r JOIN companies c ON c.id=r.company_id WHERE r.id=?`,
      [recordId],
    );
    if (record) {
      req.user.company_id = String(record.id);
      req.user.company_code = String(record.code);
    }
  }
  if (requested) {
    const [company] = await rows('SELECT id,code FROM companies WHERE code=?', [requested]);
    if (!company) throw new Error('Company missing');
    req.user.write_company_id = String(company.id);
    req.user.write_company_code = String(company.code);
    if (!recordId) {
      req.user.company_id = String(company.id);
      req.user.company_code = String(company.code);
    }
  }
}
