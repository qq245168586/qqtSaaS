import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Table, Tabs } from 'antd';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { api, errorText } from './api';
import { dispatch, useAppState, type AppState } from './store';
import { monthRange } from './unified-tasks';

const money = z.union([z.string(), z.number()]).transform((value) => new Decimal(value).toFixed(2));
const group = z.object({
  name: z.string(),
  task_count: z.coerce.number(),
  missing_amount_count: z.coerce.number(),
  total_amount: money,
});
export const revenueSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      source: z.enum(['retail', 'supply']),
      title: z.string(),
      customer_name: z.string(),
      order_channel: z.string(),
      amount: money.nullable(),
      revenue_date: z.string(),
      date_basis: z.string(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  totals: group.omit({ name: true }).extend({ retail_amount: money, supply_amount: money }),
  by_customer: z.array(group),
  by_channel: z.array(group),
  by_month: z.array(group),
  customers: z.array(z.string()),
  channels: z.array(z.string()),
});
type RevenueData = z.infer<typeof revenueSchema>;
export function Revenue({
  canManage,
  onTask,
  onDelivery,
}: {
  canManage: boolean;
  onTask: (id: string) => void;
  onDelivery: (id: string) => void;
}) {
  const filter = useAppState().revenueFilters;
  const [data, setData] = useState<RevenueData>();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const today = new Date().toLocaleDateString('sv-SE');
  const range =
    filter.period === 'month'
      ? monthRange(today.slice(0, 7))
      : filter.period === 'year'
        ? { start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` }
        : filter.period === 'custom'
          ? { start: filter.start, end: filter.end }
          : null;
  const valid = !range || (!!range.start && !!range.end && range.start <= range.end);
  const query = new URLSearchParams({
    page: String(page),
    page_size: '20',
    source: filter.source,
    customers: JSON.stringify(filter.customers),
    channels: JSON.stringify(filter.channels),
    ...(range ? { start_date: range.start, end_date: range.end } : {}),
  }).toString();
  const change = (patch: Partial<AppState['revenueFilters']>) => {
    dispatch({ type: 'revenueFilters', filters: { ...filter, ...patch } });
    setPage(1);
  };
  useEffect(() => {
    const current = ++request.current;
    setError('');
    if (!valid) {
      setBusy(false);
      setData(undefined);
      return;
    }
    setBusy(true);
    void api('GET', `/tasks/revenue?${query}`, revenueSchema)
      .then((result) => {
        if (current === request.current) setData(result);
      })
      .catch((err) => {
        if (current === request.current) {
          setError(errorText(err));
          setData(undefined);
        }
      })
      .finally(() => {
        if (current === request.current) setBusy(false);
      });
    return () => {
      request.current++;
    };
  }, [query, valid, revision]);
  const shown = !busy && !error && valid ? data : undefined;
  const groups = [
    { key: 'customer', label: '按客户', data: shown?.by_customer },
    { key: 'channel', label: '按零售渠道', data: shown?.by_channel },
    { key: 'month', label: '按月份', data: shown?.by_month },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>收入汇总</h1>
          <p>按交付日期汇总订单金额，可组合筛选来源、客户和渠道</p>
        </div>
      </div>
      <Space wrap className="filter-controls" style={{ marginBottom: 20 }}>
        <Select
          aria-label="统计期间"
          value={filter.period}
          style={{ width: 140 }}
          onChange={(period) => change({ period })}
          options={[
            { value: 'month', label: '本月' },
            { value: 'year', label: '今年' },
            { value: 'all', label: '全部时间' },
            { value: 'custom', label: '自定义日期' },
          ]}
        />
        {filter.period === 'custom' && (
          <>
            <Input
              type="date"
              aria-label="开始日期"
              value={filter.start}
              onChange={(event) => change({ start: event.target.value })}
            />
            <span>至</span>
            <Input
              type="date"
              aria-label="结束日期"
              value={filter.end}
              onChange={(event) => change({ end: event.target.value })}
            />
          </>
        )}
        <Select
          aria-label="收入来源"
          value={filter.source}
          style={{ width: 140 }}
          onChange={(source) =>
            change({ source, ...(source === 'supply' ? { channels: [] } : {}) })
          }
          options={[
            { value: 'all', label: '全部来源' },
            { value: 'retail', label: '零售' },
            ...(canManage ? [{ value: 'supply', label: '供应链' }] : []),
          ]}
        />
        <Select
          mode="multiple"
          aria-label="筛选客户"
          allowClear
          showSearch
          placeholder="全部客户"
          style={{ minWidth: 240 }}
          value={filter.customers}
          onChange={(customers) => change({ customers })}
          options={(data?.customers ?? []).map((value) => ({
            value,
            label: value || '未填写客户',
          }))}
          optionFilterProp="label"
        />
        <Select
          mode="multiple"
          aria-label="筛选渠道"
          allowClear
          disabled={filter.source === 'supply'}
          placeholder="全部渠道"
          style={{ minWidth: 220 }}
          value={filter.channels}
          onChange={(channels) => change({ channels })}
          options={(data?.channels ?? []).map((value) => ({ value, label: value || '未填写渠道' }))}
          optionFilterProp="label"
        />
        <Button loading={busy} onClick={() => setRevision((value) => value + 1)}>
          刷新
        </Button>
        <Button
          onClick={() => change({ period: 'month', source: 'all', customers: [], channels: [] })}
        >
          重置筛选
        </Button>
      </Space>
      {!valid && (
        <Alert type="warning" message="请填写有效的开始和结束日期，开始日期不能晚于结束日期。" />
      )}
      {error && <Alert type="error" showIcon message={error} />}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 16,
          marginBottom: 20,
        }}
      >
        {[
          ['订单总额', shown?.totals.total_amount],
          ['零售金额', shown?.totals.retail_amount],
          ['供应链金额', shown?.totals.supply_amount],
        ].map(([label, value]) => (
          <Card key={label} loading={busy}>
            <span>{label}</span>
            <h2 data-testid={label}>¥ {value ?? '—'}</h2>
          </Card>
        ))}
        <Card loading={busy}>
          <span>待补金额</span>
          <h2>{shown ? `${shown.totals.missing_amount_count} 项` : '—'}</h2>
          <span>符合筛选共 {shown?.total ?? '—'} 项</span>
        </Card>
      </div>
      <p style={{ color: '#7a8781' }}>
        零售按任务金额统计；关联零售任务的送货单不重复计入。已取消任务、已删除记录和送货草稿不计入。金额为空不按零元处理；无交付日期的历史任务暂按录入日期归集。此处为订单金额，非实际收款。
      </p>
      <Tabs
        items={groups.map((item) => ({
          key: item.key,
          label: item.label,
          children: (
            <Table
              rowKey="name"
              size="small"
              loading={busy}
              dataSource={item.data ?? []}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              columns={[
                {
                  title: item.label,
                  dataIndex: 'name',
                  render: (value: string) =>
                    value || (item.key === 'customer' ? '未填写客户' : '未填写渠道'),
                },
                { title: '任务数', dataIndex: 'task_count' },
                { title: '金额（元）', dataIndex: 'total_amount' },
                { title: '待补金额', dataIndex: 'missing_amount_count' },
              ]}
            />
          ),
        }))}
      />
      <h2>收入明细</h2>
      <Table
        rowKey={(row) => `${row.source}:${row.id}`}
        loading={busy}
        dataSource={shown?.items ?? []}
        scroll={{ x: 900 }}
        pagination={{
          current: page,
          total: shown?.total ?? 0,
          pageSize: 20,
          onChange: setPage,
          showSizeChanger: false,
        }}
        columns={[
          {
            title: '日期',
            dataIndex: 'revenue_date',
            render: (value, row) => (
              <>
                {value}
                {row.date_basis === 'created' && <small>（录入日期）</small>}
              </>
            ),
          },
          {
            title: '来源',
            dataIndex: 'source',
            render: (value) => (value === 'retail' ? '零售' : '供应链'),
          },
          { title: '客户', dataIndex: 'customer_name', render: (value) => value || '未填写客户' },
          { title: '任务 / 单号', dataIndex: 'title' },
          {
            title: '渠道',
            dataIndex: 'order_channel',
            render: (value, row) => (row.source === 'retail' ? value || '未填写' : '—'),
          },
          { title: '金额（元）', dataIndex: 'amount', render: (value) => value ?? '待补金额' },
          {
            title: '操作',
            render: (_, row) => (
              <Button
                type="link"
                onClick={() => (row.source === 'retail' ? onTask(row.id) : onDelivery(row.id))}
              >
                {row.source === 'retail' ? '编辑任务' : '查看送货单'}
              </Button>
            ),
          },
        ]}
      />
    </>
  );
}
