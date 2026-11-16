import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Space, Table, Tag } from 'antd';
import { api, errorText } from './api';
import { deliverySchema, pageSchema, taskSchema } from './contracts';
import { dispatch, useAppState } from './store';
import { collectPages, monthRange, unifiedTasks, type UnifiedTask } from './unified-tasks';

export function UnifiedTasks({
  canManage,
  onTask,
  onDelivery,
}: {
  canManage: boolean;
  onTask: (id: string) => void;
  onDelivery: (id: string) => void;
}) {
  const { unifiedRows, unifiedMonth } = useAppState();
  const [source, setSource] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const request = useRef(0);
  async function refresh() {
    const current = ++request.current;
    setBusy(true);
    setError('');
    try {
      const range = monthRange(unifiedMonth);
      const [tasks, notes] = await Promise.all([
        collectPages((page) =>
          api(
            'GET',
            `/tasks?month=${unifiedMonth}&page=${page}&page_size=200`,
            pageSchema(taskSchema),
          ),
        ),
        canManage
          ? collectPages((page) =>
              api(
                'GET',
                `/delivery-notes?start_date=${range.start}&end_date=${range.end}&page=${page}&page_size=200`,
                pageSchema(deliverySchema),
              ),
            )
          : Promise.resolve([]),
      ]);
      if (current === request.current)
        dispatch({ type: 'unifiedRows', rows: unifiedTasks(tasks, notes) });
    } catch (err) {
      if (current === request.current) setError(errorText(err));
    } finally {
      if (current === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      request.current++;
    };
  }, [unifiedMonth, canManage]);
  const rows = unifiedRows.filter(
    (row) =>
      (source === 'all' || row.source === source) &&
      `${row.title} ${row.detail} ${row.company} ${row.person} ${row.orderChannel ?? ''} ${row.customer ?? ''}`
        .toLowerCase()
        .includes(keyword.trim().toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <h1>任务列表</h1>
        <p>统一查看零售订单和供应链送货安排</p>
      </div>
      <Space wrap className="filter-controls" style={{ marginBottom: 20 }}>
        <Input
          aria-label="交付月份"
          type="month"
          value={unifiedMonth}
          onChange={(event) => {
            if (!event.target.value) return;
            dispatch({ type: 'unifiedMonth', month: event.target.value });
            setPage(1);
          }}
        />
        <Select
          aria-label="任务来源"
          value={source}
          onChange={(value) => {
            setSource(value);
            setPage(1);
          }}
          style={{ width: 160 }}
          options={[
            { value: 'all', label: '全部来源' },
            { value: 'retail', label: '零售' },
            ...(canManage ? [{ value: 'supply', label: '供应链' }] : []),
          ]}
        />
        <Input.Search
          aria-label="搜索汇总任务"
          placeholder="搜索任务、客户或单号"
          value={keyword}
          allowClear
          style={{ width: 280 }}
          onChange={(event) => {
            setKeyword(event.target.value);
            setPage(1);
          }}
        />
        <Button onClick={() => void refresh()} loading={busy}>
          刷新
        </Button>
        <span>
          共 {rows.length} 项 · 零售 {rows.filter((row) => row.source === 'retail').length} 项 ·
          供应链 {rows.filter((row) => row.source === 'supply').length} 项
        </span>
      </Space>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Table<UnifiedTask>
        rowKey="key"
        loading={busy}
        dataSource={error ? [] : rows}
        scroll={{ x: 1000 }}
        pagination={{ current: page, pageSize: 20, onChange: setPage, showSizeChanger: false }}
        columns={[
          {
            title: '来源',
            dataIndex: 'source',
            width: 100,
            render: (value: UnifiedTask['source']) => (
              <Tag color={value === 'retail' ? 'green' : 'blue'}>
                {value === 'retail' ? '零售' : '供应链'}
              </Tag>
            ),
          },
          {
            title: '任务',
            width: 340,
            render: (_, row) => (
              <>
                <strong>{row.title}</strong>
                {row.source === 'retail' && row.orderChannel && (
                  <Tag style={{ marginLeft: 8 }}>{row.orderChannel}</Tag>
                )}
                <div style={{ color: '#7a8781', marginTop: 6 }}>{row.detail}</div>
                {row.sourceTaskId && (
                  <Button
                    type="link"
                    style={{ padding: 0 }}
                    onClick={() => onTask(row.sourceTaskId!)}
                  >
                    关联零售任务{row.sourceTaskTitle ? `：${row.sourceTaskTitle}` : ''}
                  </Button>
                )}
              </>
            ),
          },
          {
            title: '客户',
            dataIndex: 'customer',
            width: 160,
            render: (value: string | null) => value || '—',
          },
          {
            title: '金额（元）',
            dataIndex: 'amount',
            width: 130,
            render: (value: string | number | null) =>
              value == null ? '待补金额' : Number(value).toFixed(2),
          },
          { title: '公司', dataIndex: 'company', width: 100 },
          {
            title: '交付时间',
            dataIndex: 'scheduledAt',
            width: 175,
            render: (value: string | null, row) => (
              <>
                <span>{value?.replace('T', ' ').slice(0, 16) || '待填写'}</span>
                {row.source === 'supply' && (
                  <div style={{ color: '#7a8781', fontSize: 12 }}>送货日期 · 默认 09:00</div>
                )}
              </>
            ),
          },
          { title: '执行人 / 送货人', dataIndex: 'person', width: 140 },
          {
            title: '录入时间',
            dataIndex: 'createdAt',
            width: 175,
            render: (value: string | null) => value?.replace('T', ' ').slice(0, 16) || '—',
          },
          {
            title: '操作',
            width: 130,
            fixed: 'right',
            render: (_, row) => (
              <Button
                type="link"
                onClick={() => (row.source === 'retail' ? onTask(row.id) : onDelivery(row.id))}
              >
                {row.source === 'retail' ? '查看任务' : '查看送货单'}
              </Button>
            ),
          },
        ]}
      />
    </>
  );
}
