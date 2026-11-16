import { ScheduleEditor } from './ScheduleEditor';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Table, Tag } from 'antd';
import { api, errorText } from './api';
import { dispatch, useAppState } from './store';
import {
  displayMinutes,
  scheduleSnapshotSchema,
  type ScheduleRow,
  type ScheduleSnapshot,
} from './schedules-model';

type Employee = ScheduleSnapshot['employees'][number];
type Editor = { employee: Employee; date: string; row?: ScheduleRow };
export function Schedules() {
  const {
    scheduleMonth: month,
    scheduleDepartment: department,
    scheduleSnapshot: data,
  } = useAppState();
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [editing, setEditing] = useState<Editor | null>(null);
  const load = useCallback(async () => {
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return;
    setLoading(true);
    setError('');
    try {
      const result = await api('GET', `/employee-schedules?month=${month}`, scheduleSnapshotSchema);
      dispatch({ type: 'scheduleSnapshot', snapshot: result });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);
  const current = data?.month === month ? data : null;
  const employees = (current?.employees ?? []).filter(
    (e) => !department || e.department_id === department,
  );
  const rowFor = (employeeId: string, date: string) =>
    current?.items.find((r) => r.employee_id === employeeId && r.work_date === date);
  const open = (employee: Employee, date: string) => {
    const row = rowFor(employee.id, date);
    setEditing({ employee, date, row });
  };
  const departments = [
    ...new Map(
      (current?.employees ?? []).map((e) => [e.department_id, e.department_name ?? '未设置']),
    ).entries(),
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">STAFF SCHEDULING</span>
          <h1>排班管理</h1>
          <p>正常班 9 小时（含 1 小时休息）。过去、今天及未来的排班均可调整。</p>
        </div>
        <Space>
          <Input
            aria-label="排班月份"
            type="month"
            value={month}
            min="2000-01"
            max="2099-12"
            onChange={(e) => dispatch({ type: 'scheduleMonth', month: e.target.value })}
          />
          <Select
            aria-label="排班部门"
            allowClear
            placeholder="全部部门"
            value={department || undefined}
            style={{ minWidth: 150 }}
            options={departments.map(([value, label]) => ({ value, label }))}
            onChange={(value) => dispatch({ type: 'scheduleDepartment', department: value ?? '' })}
          />
          <Button loading={loading} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={<Button onClick={() => void load()}>重试</Button>}
        />
      )}
      <Card>
        <Table<Employee>
          className="schedule-calendar"
          rowKey="id"
          pagination={false}
          loading={loading}
          dataSource={employees}
          scroll={{ x: (current?.days ?? 31) * 150 + 170 }}
          columns={[
            {
              title: '员工',
              key: 'employee',
              fixed: 'left',
              width: 170,
              render: (_, e) => (
                <>
                  <strong>{e.name}</strong>
                  <div className="secondary">{e.department_name}</div>
                  {e.left_on && <Tag>{e.left_on} 离职</Tag>}
                </>
              ),
            },
            ...Array.from({ length: current?.days ?? 0 }, (_, i) => {
              const date = `${month}-${String(i + 1).padStart(2, '0')}`;
              return {
                title: (
                  <>
                    {i + 1} 日{date === current?.today && <Tag color="green">今天</Tag>}
                  </>
                ),
                key: date,
                width: 150,
                render: (_: unknown, e: Employee) => {
                  const r = rowFor(e.id, date),
                    row = r && !r.deleted_at ? r : undefined;
                  return (
                    <Button className="schedule-cell" onClick={() => open(e, date)}>
                      <div>
                        {row
                          ? row.shift_kind === 'work'
                            ? `${row.start_time}–${row.end_next_day ? '次日' : ''}${row.standard_end}`
                            : row.shift_kind === 'rest'
                              ? '例休'
                              : '调休'
                          : '未排班'}
                      </div>
                      {!!row?.overtime_minutes && (
                        <small className="schedule-positive">
                          加班 {displayMinutes(row.overtime_minutes).replace('+', '')}
                        </small>
                      )}
                      {!!row?.timeoff_minutes && (
                        <small className="schedule-negative">
                          调休 {displayMinutes(row.timeoff_minutes).replace('+', '')}
                        </small>
                      )}
                    </Button>
                  );
                },
              };
            }),
          ]}
        />
      </Card>
      <Card title="例休与未休天数" style={{ marginTop: 20 }}>
        <p className="secondary">
          每月应休 {current?.rest_monthly_quota_days ?? '—'}{' '}
          天，按「例休」计算整天，单独累计，不折算加班或调休小时。
          未休天数自动保留到下月；未来已排例休只作为计划，到当天才扣减。
        </p>
        {!current?.rest_balances ? (
          <Alert type="info" showIcon message="尚未加载例休余额，请刷新获取服务器最新数据。" />
        ) : (
          <Table
            rowKey="employee_id"
            pagination={false}
            scroll={{ x: 1000 }}
            dataSource={current.rest_balances.filter((b) =>
              employees.some((e) => e.id === b.employee_id),
            )}
            columns={[
              {
                title: '员工',
                width: 130,
                fixed: 'left',
                render: (_, b) => employees.find((e) => e.id === b.employee_id)?.name,
              },
              { title: '月初结余', dataIndex: 'opening_days', render: (n: number) => `${n}天` },
              { title: '本月应休', dataIndex: 'quota_days', render: (n: number) => `${n}天` },
              { title: '本月已休', dataIndex: 'taken_days', render: (n: number) => `${n}天` },
              {
                title: '本月未休',
                dataIndex: 'current_unused_days',
                render: (n: number) => `${n}天`,
              },
              {
                title: '结余未休',
                dataIndex: 'carry_remaining_days',
                render: (n: number) => `${n}天`,
              },
              {
                title: '未休合计',
                dataIndex: 'unused_days',
                render: (n: number, b) => (
                  <>
                    <strong>{n}天</strong>
                    {b.excess_rest_days > 0 && (
                      <div className="secondary">另有 {b.excess_rest_days} 天额外休息</div>
                    )}
                  </>
                ),
              },
              {
                title: '未来已排例休',
                dataIndex: 'planned_rest_days',
                render: (n: number) => `${n}天`,
              },
              {
                title: '按计划休完后',
                dataIndex: 'planned_unused_days',
                render: (n: number) => `${n}天`,
              },
            ]}
          />
        )}
      </Card>
      <Card title="加班与调休余额" style={{ marginTop: 20 }}>
        <p className="secondary">
          截至服务器 {current?.today ?? '—'}
          ，未来计划不提前计入。正数可调休，负数下月继续累计；未排班不会扣减。这里只统计小时，不计算或扣减工资。
        </p>
        <Table
          rowKey="employee_id"
          pagination={false}
          dataSource={(current?.balances ?? []).filter((b) =>
            employees.some((e) => e.id === b.employee_id),
          )}
          columns={[
            {
              title: '员工',
              render: (_, b) => employees.find((e) => e.id === b.employee_id)?.name,
            },
            { title: '月期初', dataIndex: 'opening_minutes', render: displayMinutes },
            { title: '本月已发生加班', dataIndex: 'overtime_minutes', render: displayMinutes },
            { title: '本月已发生调休', dataIndex: 'timeoff_minutes', render: displayMinutes },
            {
              title: month === current?.today.slice(0, 7) ? '截至今天余额' : '截至所选月余额',
              dataIndex: 'balance_minutes',
              render: (n: number) => (
                <strong className={n < 0 ? 'schedule-negative' : 'schedule-positive'}>
                  {displayMinutes(n)}
                </strong>
              ),
            },
            {
              title: '未来加班减调休（计划）',
              dataIndex: 'planned_net_minutes',
              render: displayMinutes,
            },
            {
              title: '按计划执行后余额',
              render: (_, b) => displayMinutes(b.balance_minutes + b.planned_net_minutes),
            },
          ]}
        />
      </Card>
      {editing && (
        <ScheduleEditor
          initial={{
            employee_id: editing.employee.id,
            employee_name: editing.employee.name,
            work_date: editing.date,
            shift_kind: editing.row?.shift_kind ?? 'work',
            start_time: editing.row?.start_time ?? '08:00',
            overtime_minutes: editing.row?.overtime_minutes ?? 0,
            timeoff_minutes: editing.row?.timeoff_minutes ?? 0,
            note: editing.row?.note ?? '',
          }}
          fixedIdentity
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </>
  );
}
