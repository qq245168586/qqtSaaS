import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resourceView } from '../src/catalog';

test('员工接口不暴露公司属性，只保留人员与业务部门关系', () => {
  assert.deepEqual(
    resourceView('employees', {
      id: '8',
      company_id: '2',
      company_code: 'tmy',
      company_name: '天美意',
      department_id: '4',
      name: '张景美',
      status: 'active',
    }),
    {
      id: '8',
      department_id: '4',
      name: '张景美',
      status: 'active',
    },
  );
});

test('部门接口不暴露公司属性', () => {
  assert.deepEqual(
    resourceView('departments', {
      id: '1',
      company_id: null,
      company_code: null,
      company_name: null,
      name: '蛋糕部',
      sort: 0,
    }),
    { id: '1', name: '蛋糕部', sort: 0 },
  );
});

test('业务分类接口全局共用且不暴露公司属性', () => {
  assert.deepEqual(
    resourceView('categories', {
      id: '2',
      company_id: null,
      company_code: null,
      company_name: null,
      name: '茶歇',
      sort: 0,
    }),
    { id: '2', name: '茶歇', sort: 0 },
  );
});
