import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Input,
  Select,
  Space,
  Statistic,
  Table,
  message,
} from 'antd';
import { z } from 'zod';
import { allResources, api, errorText, ipc, isOffline } from './api';
import { pageSchema } from './contracts';
import { dispatch, useAppState } from './store';
import { companies } from './types';
import { matchesText } from './search';
import {
  buildDeliveryReport,
  defaultReportFilters,
  normalizeCustomer,
  readReportPages,
  reportModes,
  reportNoteSchema,
  validateReportDates,
  type ReportFilters,
  type ReportMode,
} from './delivery-report';

export function Summary() {
  const { deliveryReportFilters: filters, deliveryReportSnapshot: snapshot } = useAppState();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const update = (patch: Partial<ReportFilters>) =>
    dispatch({ type: 'deliveryReportFilters', filters: { ...filters, ...patch } });
  async function load() {
    const id = ++request.current;
    setLoading(true);
    setError('');
    try {
      validateReportDates(filters.start, filters.end);
      const query = new URLSearchParams({
        start_date: filters.start,
        end_date: filters.end,
        page_size: '100',
      });
      const [notes, customers, categories] = await Promise.all([
        readReportPages((page) =>
          api('GET', `/delivery-notes?${query}&page=${page}`, pageSchema(reportNoteSchema)),
        ),
        allResources('/customers'),
        allResources('/customer-categories'),
      ]);
      if (isOffline()) throw new Error('当前离线，无法核对完整送货单，请联网后重新汇总');
      if (id === request.current)
        dispatch({
          type: 'deliveryReportSnapshot',
          snapshot: { start: filters.start, end: filters.end, notes, customers, categories },
        });
    } catch (failure) {
      if (id === request.current) {
        setError(errorText(failure));
        dispatch({ type: 'deliveryReportSnapshot', snapshot: null });
      }
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [filters.start, filters.end]);
  const result = useMemo(() => {
    if (!snapshot) return { report: null, error: '' };
    try {
      return { report: buildDeliveryReport(snapshot, filters), error: '' };
    } catch (failure) {
      return { report: null, error: errorText(failure) };
    }
  }, [snapshot, filters]);
  const customerOptions = useMemo(() => {
    const names = [
      ...(snapshot?.customers.map((row) => row.name) ?? []),
      ...(snapshot?.notes.map((row) => row.customer_name_snapshot) ?? []),
    ];
    const unique = new Map<string, string>();
    for (const name of names) if (name.trim()) unique.set(normalizeCustomer(name), name.trim());
    return [...unique.values()]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((value) => ({ value, label: value }));
  }, [snapshot]);
  const report = result.report;
  const productOptions = useMemo(
    () =>
      [
        ...new Set(
          (snapshot?.notes ?? []).flatMap((note) => note.items.map((line) => line.product_name)),
        ),
      ]
        .sort((a, b) => a.localeCompare(b, 'zh-CN'))
        .map((value) => ({ value, label: value })),
    [snapshot],
  );
  async function exportExcel() {
    if (!snapshot || !report || !report.noteCount || loading || isOffline()) return;
    setSaving(true);
    let savedCount = 0;
    try {
      const { deliveryStatements } = await import('./delivery-statement');
      const statements = deliveryStatements(snapshot, filters);
      // Build both files before showing dialogs; a canceled company never counts as saved.
      const files = await Promise.all(
        statements.map(async ({ name, workbook }) => ({
          name,
          data: new Uint8Array(await workbook.xlsx.writeBuffer()),
        })),
      );
      for (const file of files) {
        if (await ipc(window.desktop.saveFile(file.name, file.data), z.boolean())) savedCount++;
      }
      if (savedCount === files.length && savedCount)
        void message.success(`已导出 ${savedCount} 个公司对账文件（各含汇总、明细）`);
      else if (savedCount) void message.info(`已导出 ${savedCount} 个文件，其余已取消`);
    } catch (failure) {
      void message.error(
        `${savedCount ? `已保存 ${savedCount} 个文件；` : ''}${errorText(failure)}`,
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DELIVERY REPORTS</span>
          <h1>送货汇总</h1>
          <p>按送货单生成客户对账明细，金额以保存的单据为准。</p>
        </div>
        <Button
          type="primary"
          disabled={loading || !report?.noteCount || Boolean(error || result.error)}
          loading={saving}
          onClick={() => void exportExcel()}
        >
          导出对账 Excel（汇总＋明细）
        </Button>
      </div>
      <Card className="statement-filter-card">
        <div className="statement-filter-header">
          <div>
            <h2>对账范围</h2>
            <span className="statement-caption">选择公司、客户和日期，商品条件即时生效</span>
          </div>
          <Space>
            <Button
              onClick={() =>
                update({
                  company: 'all',
                  customers: [],
                  category: '',
                  keyword: '',
                  products: [],
                  productRelation: 'include',
                  productLogic: 'any',
                })
              }
            >
              重置筛选
            </Button>
            <Button loading={loading} onClick={() => void load()}>
              重新汇总
            </Button>
          </Space>
        </div>
        <div className="statement-scope-grid">
          <div className="statement-field">
            <label>公司</label>
            <Select
              aria-label="对账公司"
              value={filters.company}
              onChange={(company: ReportFilters['company']) => update({ company })}
              options={[
                { value: 'all', label: '全部公司' },
                ...Object.values(companies).map((company) => ({
                  value: company.id,
                  label: company.shortName,
                })),
              ]}
            />
          </div>
          <div className="statement-field">
            <label>客户</label>
            <Select
              aria-label="对账客户"
              mode="tags"
              allowClear
              showSearch
              placeholder="全部客户，可输入名称或关键词"
              value={filters.customers}
              options={customerOptions}
              filterOption={(input, option) => matchesText(String(option?.label ?? ''), input)}
              onChange={(customers: string[]) => update({ customers })}
            />
          </div>
          <div className="statement-field">
            <label>送货日期</label>
            <div className="statement-date-range">
              <Input
                aria-label="对账开始日期"
                type="date"
                value={filters.start}
                onChange={(event) => update({ start: event.target.value })}
              />
              <span className="statement-caption">至</span>
              <Input
                aria-label="对账结束日期"
                type="date"
                value={filters.end}
                onChange={(event) => update({ end: event.target.value })}
              />
              <Button
                onClick={() => {
                  const current = defaultReportFilters();
                  update({ start: current.start, end: current.end });
                }}
              >
                本月
              </Button>
            </div>
          </div>
        </div>
        <div className="statement-product-section">
          <div className="statement-product-heading">
            <label>商品条件</label>
            <span className="statement-caption">支持拼音、首字母；输入后按回车添加关键词</span>
          </div>
          <div className="statement-product-control">
            <Select
              aria-label="商品条件关系"
              value={filters.productRelation}
              onChange={(productRelation: ReportFilters['productRelation']) =>
                update({ productRelation })
              }
              options={[
                { value: 'include', label: '包含' },
                { value: 'exclude', label: '排除' },
              ]}
            />
            <Select
              aria-label="商品关键词"
              mode="tags"
              allowClear
              value={filters.products}
              options={productOptions}
              placeholder="输入或选择商品关键词，例如：月饼"
              filterOption={(input, option) => matchesText(String(option?.label ?? ''), input)}
              onChange={(products: string[]) => update({ products })}
            />
            <Select
              aria-label="商品条件逻辑"
              value={filters.productLogic}
              onChange={(productLogic: ReportFilters['productLogic']) => update({ productLogic })}
              options={[
                { value: 'any', label: '或 · 任一关键词' },
                { value: 'all', label: '与 · 全部关键词' },
              ]}
            />
          </div>
          <div className="statement-product-hint">
            {filters.productRelation === 'include' ? '保留' : '排除'}商品名称
            {filters.productLogic === 'all' ? '同时命中全部关键词' : '命中任一关键词'}
            的明细；未填关键词时不限商品。
          </div>
        </div>
        <Collapse
          ghost
          className="statement-more-filters"
          items={[
            {
              key: 'more',
              label: '更多筛选与显示',
              children: (
                <div className="statement-advanced-grid">
                  <div className="statement-field">
                    <label>汇总视图</label>
                    <Select
                      aria-label="对账视图"
                      value={filters.mode}
                      onChange={(mode: ReportMode) => update({ mode })}
                      options={Object.entries(reportModes).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                    />
                  </div>
                  <div className="statement-field">
                    <label>客户分类</label>
                    <Select
                      aria-label="对账客户分类"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      value={filters.category || undefined}
                      placeholder="全部客户分类"
                      onChange={(category: string | undefined) =>
                        update({ category: category ?? '' })
                      }
                      options={[
                        { value: 'uncategorized', label: '未分类' },
                        ...(snapshot?.categories ?? []).map((row) => ({
                          value: row.id,
                          label: `${row.name}${row.company_code ? ' · ' + companies[row.company_code].shortName : ''}`,
                        })),
                      ]}
                    />
                  </div>
                  <div className="statement-field">
                    <label>整单检索</label>
                    <Input
                      aria-label="整单检索"
                      allowClear
                      value={filters.keyword}
                      placeholder="客户、单号或商品，保留整张单据"
                      onChange={(event) => update({ keyword: event.target.value })}
                    />
                  </div>
                </div>
              ),
            },
          ]}
        />
      </Card>
      {(error || result.error) && (
        <Alert style={{ marginTop: 16 }} type="error" showIcon message={error || result.error} />
      )}
      {report && (
        <>
          {filters.products.some((value) => value.trim()) && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 16 }}
              message={`已过滤 ${report.omittedItemCount} 项商品；${report.partialNoteCount} 张单据仅保留部分商品，按保留明细金额汇总。全部商品被过滤的单据不参与对账，原送货单不变。`}
            />
          )}
          <div className="summary-stats">
            <Card>
              <Statistic title="送货单数" value={report.noteCount} />
            </Card>
            <Card>
              <Statistic title="品项数" value={report.itemCount} />
            </Card>
            <Card>
              <Statistic title="数量（按单位）" value={report.quantity || '—'} />
            </Card>
            <Card>
              <Statistic title="对账金额" prefix="¥" value={report.total} precision={2} />
            </Card>
          </div>
          {report.total !== report.lineTotal && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`商品明细金额合计 ¥${report.lineTotal}，单据对账金额 ¥${report.total}，存在差额。对账总额保留原单据金额，请核对原送货单。`}
            />
          )}
          <Card>
            <Table
              loading={loading}
              rowKey="key"
              dataSource={report.rows}
              scroll={{ x: filters.mode === 'details' ? 1600 : 1050 }}
              pagination={{ defaultPageSize: 50, showSizeChanger: true }}
              columns={report.columns.map((column) => ({
                key: column.key,
                title: column.title,
                render: (_, row) => row.cells[column.key] ?? '',
                align: column.numeric ? ('right' as const) : ('left' as const),
              }))}
            />
          </Card>
          <Card title="公司对账合计" style={{ marginTop: 16 }}>
            <Table
              rowKey="company"
              pagination={false}
              dataSource={report.companies}
              columns={[
                { title: '公司', dataIndex: 'company' },
                { title: '送货单数', dataIndex: 'count' },
                { title: '对账金额', dataIndex: 'amount', render: (value: string) => `¥ ${value}` },
              ]}
            />
          </Card>
        </>
      )}
    </>
  );
}
