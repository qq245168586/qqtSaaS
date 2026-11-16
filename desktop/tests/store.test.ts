import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer, dispatch, getState, state$ } from '../src/store.ts';
import type { Session } from '../src/contracts.ts';
const session = (company: string, user = '1'): Session => ({
  access_token: 'test-token',
  user: {
    id: user,
    company_id: company,
    company_code: 'tri',
    username: 'test',
    real_name: '测试',
    role: 'boss',
    must_change_password: false,
  },
});
test('纯reducer：筛选重置页码，刷新会话保留任务，切换公司清空共享数据', () => {
  let state = reducer(initialState(), { type: 'session', session: session('1') });
  state = reducer(state, { type: 'page', page: 5 });
  state = reducer(state, { type: 'filters', filters: { status: 'doing' } });
  assert.equal(state.taskPage, 1);
  state = reducer(state, { type: 'total', total: 17 });
  state = reducer(state, {
    type: 'session',
    session: { ...session('1'), access_token: 'rotated' },
  });
  assert.equal(state.taskTotal, 17);
  state = reducer(state, { type: 'session', session: session('2') });
  assert.equal(state.taskTotal, 0);
  assert.equal(state.taskFilters.status, undefined);
  assert.equal(reducer(state, { type: 'session', session: null }).session, null);
});
test('RxJS scan立即发出增量状态，不等待complete；shareReplay提供最新快照', () => {
  dispatch({ type: 'error', error: '离线' });
  assert.equal(getState().taskError, '离线');
  let received = '';
  const subscription = state$.subscribe((state) => {
    received = state.taskError;
  });
  assert.equal(received, '离线');
  dispatch({ type: 'error', error: '' });
  assert.equal(received, '');
  subscription.unsubscribe();
});
