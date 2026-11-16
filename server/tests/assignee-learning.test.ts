import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  businessCandidates,
  chooseAssignee,
  normalizedDepartmentName,
} from '../src/assignee-learning';

const employees = [
  {
    id: '2',
    name: '张景美',
    department_id: '4',
    department_name: '蛋糕部',
    status: 'active',
    deleted_at: null,
  },
  {
    id: '3',
    name: '王富红',
    department_id: '6',
    department_name: '制面部',
    status: 'active',
    deleted_at: null,
  },
];

test('趣趣特蛋糕业务可匹配天美意名下的同业务员工', () => {
  assert.equal(normalizedDepartmentName('蛋糕部门'), '蛋糕');
  const candidates = businessCandidates(employees, '蛋糕部');
  assert.deepEqual(
    candidates.map((employee) => employee.id),
    ['2'],
  );
  assert.deepEqual(chooseAssignee(candidates, []), {
    employee_id: '2',
    source: 'business',
    sample_count: 0,
    reason: '蛋糕部当前唯一在岗执行人：张景美',
  });
});

test('相同业务有多人时按关键词历史次数选择，平票留给人工', () => {
  const candidates = businessCandidates(
    [
      ...employees,
      {
        id: '5',
        name: '另一员工',
        department_id: '1',
        department_name: '蛋糕部',
        status: 'active',
        deleted_at: null,
      },
    ],
    '蛋糕部',
  );
  assert.equal(
    chooseAssignee(candidates, [
      { assignee_employee_id: '2', keyword: '焦糖布丁', votes: 3 },
      { assignee_employee_id: '5', keyword: '焦糖布丁', votes: 1 },
    ]).employee_id,
    '2',
  );
  assert.equal(
    chooseAssignee(candidates, [
      { assignee_employee_id: '2', keyword: '布丁', votes: 1 },
      { assignee_employee_id: '5', keyword: '布丁', votes: 1 },
    ]).employee_id,
    null,
  );
});
