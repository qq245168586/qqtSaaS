import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingBusinessEmployees } from '../src/assignment';
import type { Resource } from '../src/contracts';

const departments = [
  { id: '1', name: '蛋糕部', company_code: 'tri' },
  { id: '4', name: '蛋糕部', company_code: 'tmy' },
  { id: '6', name: '制面部', company_code: 'tmy' },
] as Resource[];
const employees = [
  { id: '2', name: '张景美', department_id: '4', status: 'active' },
  { id: '3', name: '王富红', department_id: '6', status: 'active' },
] as Resource[];

test('员工没有公司属性，按业务部门名提供执行人', () => {
  assert.deepEqual(
    matchingBusinessEmployees(departments, employees, '1').map((item) => item.id),
    ['2'],
  );
});

test('不同公司同名部门仍使用同一员工池', () => {
  assert.deepEqual(
    matchingBusinessEmployees(departments, employees, '4').map((item) => item.id),
    ['2'],
  );
});
