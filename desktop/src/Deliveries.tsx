import { employeeAvailableOn } from './assignment';
import { LimitedField } from './TemplateLimitedInput';
import { TemplatePaper } from './TemplatePaper';
import { usePrintInputLimits, type HeadInputField } from './print-input-limits';
import { printModel } from './delivery-model';
import { CompanySelect } from './CompanySelect';
import { dispatch, useAppState } from './store';
import { defaultPrintTemplate } from './default-print-template';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Splitter,
  Table,
  message,
} from 'antd';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { allResources, api, download, downloadBatch, errorText, ipc } from './api';
import {
  deliverySchema,
  deliveryPersonnelSuggestionSchema,
  pageSchema,
  type Delivery,
  type DeliveryInput,
  type DeliveryPersonnelSuggestion,
  type Resource,
} from './contracts';
import { DeliveryPrintPreview } from './DeliveryPrintPreview';
import { DeliveryPrint } from './DeliveryPrint';
import { usePrintTemplates } from './PrintTemplateContext';
import { companies, type CompanyId } from './types';
import { matchesText } from './search';
import { resolveDeliveryProduct } from './delivery-product-selection';
const today = () => new Date().toLocaleDateString('sv-SE');
const personnelFields = [
  ['maker_name', '制单人', 'maker', 'maker'],
  ['warehouse_name', '仓管', 'warehouse', 'keeper'],
  ['sales_name', '业务', 'sales', 'salesperson'],
  ['deliverer_name', '送货人', 'deliverer', 'deliveryPerson'],
] as const;
type PersonnelField = (typeof personnelFields)[number][0];
const emptyPersonnelOptions = (): DeliveryPersonnelSuggestion['options'] => ({
  maker_name: [],
  warehouse_name: [],
  sales_name: [],
  deliverer_name: [],
});
const monthEnd = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('sv-SE');
};
function PrinterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <path d="M7 14h10v6H7z" />
      <path d="M17 12h.01" />
    </svg>
  );
}
function blank(): DeliveryInput {
  return {
    delivery_date: today(),
    customer_name_snapshot: '',
    is_draft: false,
    items: [{ product_name: '', unit: '个', quantity: 1, unit_price: 0 }],
    maker_name: '',
    warehouse_name: '',
    sales_name: '',
    deliverer_name: '',
  };
}

function lineAmount(quantity: string | number | undefined, unitPrice: string | number | undefined) {
  try {
    return new Decimal(quantity || 0).times(unitPrice || 0).toFixed(2);
  } catch {
    return '0.00';
  }
}

export function DeliveryForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: Delivery | DeliveryInput;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<DeliveryInput>();
  const { session } = useAppState();
  const publicAccess = session?.user.public_access;
  const [catalog, setCatalog] = useState<Record<string, Resource[]>>({});
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({});
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [personnelOptions, setPersonnelOptions] = useState(emptyPersonnelOptions);
  const personnelTouched = useRef(new Set<PersonnelField>());
  const automaticPersonnel = useRef<Partial<Record<PersonnelField, string>>>({});
  const [busy, setBusy] = useState(false);
  const saveLock = useRef(false);
  const lines = Form.useWatch('items', form) ?? initial.items;
  const values = (Form.useWatch([], form) ?? initial) as DeliveryInput;
  const templateStore = usePrintTemplates();
  const company =
    values.company_code ?? initial.company_code ?? session?.user.company_code ?? 'tmy';
  const catalogFor = (key: string) =>
    (catalog[key] ?? []).filter(
      (item) => !publicAccess || !item.company_code || item.company_code === company,
    );
  const formTemplate = defaultPrintTemplate(templateStore.templates);
  const measureNote = printModel(
    {
      ...initial,
      ...values,
      id: 'draft-measure',
      note_number:
        'note_number' in initial ? initial.note_number : `${company.toUpperCase()}26092212000001`,
      items: lines.map((line) => ({
        ...line,
        product_name: line.product_name ?? '',
        unit: line.unit ?? '个',
        quantity: line.quantity ?? 0,
        unit_price: line.unit_price ?? 0,
      })),
    },
    company,
  );
  const limits = usePrintInputLimits(formTemplate, measureNote);
  const head = (field: HeadInputField, raw: string, previous: string) => {
    if (
      ['maker', 'keeper', 'salesperson', 'deliveryPerson'].includes(field) &&
      catalogFor('personnel').some((person) => person.name === raw) &&
      !limits.fits(field, raw)
    ) {
      limits.reject('模板放不下完整人员姓名，本次选择未接受，请调整模板。');
      return previous;
    }
    return limits.limit(field, raw, previous);
  };
  const chooseCustomer = (raw: string, previous: string) => {
    const customer = catalogFor('customers').find((item) => item.name === raw);
    if (
      customer &&
      (!limits.fits('customerName', customer.name) ||
        !limits.fits('customerAddress', customer.address ?? '') ||
        !limits.fits('customerPhone', customer.phone ?? ''))
    ) {
      limits.reject('模板放不下完整客户名称、地址或电话，本次选择未接受，请调整模板。');
      return previous;
    }
    const accepted = customer ? raw : limits.limit('customerName', raw, previous);
    if (accepted !== previous || customer)
      form.setFieldsValue({
        customer_id: customer?.id ?? null,
        customer_address_snapshot: customer?.address ?? '',
        customer_phone_snapshot: customer?.phone ?? '',
      });
    return accepted;
  };
  const chooseProduct = (row: number, raw: string, previous: string, productId?: string) => {
    const selection = resolveDeliveryProduct(catalogFor('products'), raw, productId);
    const { product, patch } = selection;
    if (product) {
      form.setFieldValue(['items', row, 'spec'], patch.specification);
      form.setFieldValue(['items', row, 'unit'], patch.unit);
      form.setFieldValue(['items', row, 'unit_price'], patch.unitPrice);
      const fieldLabels = {
        productName: '产品名称',
        specification: '规格',
        unit: '单位',
        unitPrice: '单价',
      } as const;
      const overflow = (Object.keys(patch) as (keyof typeof patch)[]).filter(
        (field) => !limits.fits(field, patch[field], row, patch),
      );
      if (overflow.length)
        limits.reject(
          `模板空间不足：${overflow.map((field) => fieldLabels[field]).join('、')}。商品资料已完整带入，请调整模板后再保存。`,
        );
      return selection.value;
    }
    return limits.limit('productName', raw, previous, row, patch);
  };

  useEffect(() => {
    let active = true;
    setCatalogErrors({});
    const labels: Record<string, string> = {
      customers: '客户',
      products: '产品',
      personnel: '人员',
      employees: '员工',
    };
    void Promise.allSettled(
      ['customers', 'products', 'personnel', 'employees'].map(async (key) => {
        try {
          const items = await allResources(`/${key}`);
          if (active) setCatalog((previous) => ({ ...previous, [key]: items }));
        } catch (error) {
          if (active)
            setCatalogErrors((previous) => ({
              ...previous,
              [key]: `${labels[key]}资料加载失败：${errorText(error)}`,
            }));
        }
      }),
    );
    return () => {
      active = false;
    };
  }, [catalogRevision]);
  const customerContext = values.customer_name_snapshot?.trim() ?? '';
  const productContext = lines
    .map((line) => line.product_name?.trim() ?? '')
    .filter(Boolean)
    .join('\n');
  useEffect(() => {
    if (!limits.ready) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void api('POST', '/delivery-notes/personnel-suggestions', deliveryPersonnelSuggestionSchema, {
        ...(publicAccess ? { company_code: company } : {}),
        customer_name: customerContext,
        delivery_date: values.delivery_date,
        products: productContext ? productContext.split('\n') : [],
      })
        .then((suggestion) => {
          if (!active) return;
          setPersonnelOptions(suggestion.options);
          const current = form.getFieldsValue(personnelFields.map(([field]) => field));
          const patch: Partial<DeliveryInput> = {};
          for (const [field, , , printField] of personnelFields) {
            if (personnelTouched.current.has(field)) continue;
            const existing = String(current[field] ?? '');
            const previousAutomatic = automaticPersonnel.current[field];
            if (existing && existing !== previousAutomatic) continue;
            const next = suggestion.defaults[field] ?? '';
            const accepted = next ? head(printField as HeadInputField, next, existing) : '';
            patch[field] = accepted;
            if (accepted) automaticPersonnel.current[field] = accepted;
            else delete automaticPersonnel.current[field];
          }
          form.setFieldsValue(patch);
        })
        .catch((error) => {
          if (active) void message.warning(`人员习惯加载失败：${errorText(error)}`);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [company, customerContext, productContext, values.delivery_date, limits.ready]);
  async function save() {
    if (saveLock.current) return;
    saveLock.current = true;
    try {
      await saveValidated();
    } finally {
      saveLock.current = false;
    }
  }
  async function saveValidated() {
    const input = await form.validateFields().catch(() => {
      void message.error('请填写客户、送货日期及所有明细必填项');
      return null;
    });
    if (!input) return;
    if (templateStore.loading || templateStore.error || !limits.ready) {
      void message.error(templateStore.error || '模板尚未加载完成');
      return;
    }
    const overflow = limits.errors();
    if (overflow.length) {
      void message.error(`模板空间不足：${overflow.join('、')}`);
      return;
    }
    if (input.items.length > 5) {
      void message.error('单张送货单最多5行产品，请校对并调整明细后再保存');
      return;
    }
    setBusy(true);
    try {
      const data = {
        company_code: input.company_code,
        delivery_date: input.delivery_date,
        customer_id: input.customer_id ?? null,
        customer_name_snapshot: input.customer_name_snapshot,
        customer_address_snapshot: input.customer_address_snapshot ?? '',
        customer_phone_snapshot: input.customer_phone_snapshot ?? '',
        maker_name: input.maker_name ?? '',
        warehouse_name: input.warehouse_name ?? '',
        sales_name: input.sales_name ?? '',
        deliverer_name: input.deliverer_name ?? '',
        is_draft: false,
        items: input.items.map((item) => ({
          product_name: item.product_name,
          spec: item.spec ?? '',
          unit: item.unit,
          quantity: String(item.quantity),
          unit_price: new Decimal(item.unit_price).toFixed(2),
          remark: item.remark ?? '',
        })),
      };
      await api(
        'id' in initial ? 'PUT' : 'POST',
        'id' in initial ? `/delivery-notes/${initial.id}` : '/delivery-notes',
        deliverySchema,
        data,
      );
      onSaved();
    } catch (e) {
      void message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  let total = '0.00';
  try {
    total = lines
      .reduce(
        (sum, line) =>
          sum.plus(
            new Decimal(line.quantity || 0)
              .times(line.unit_price || 0)
              .toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
          ),
        new Decimal(0),
      )
      .toFixed(2);
  } catch {
    /* Incomplete numeric input is validated on save. */
  }
  return (
    <div
      className="modal-backdrop delivery-note-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="送货单开单"
      style={{ '--accent': companies[company].accent } as CSSProperties}
    >
      <section className="editor-modal delivery-editor">
        <header>
          <div>
            <p className="eyebrow">{'id' in initial ? '编辑送货单' : '新建送货单'}</p>
            <h3>{companies[company].name} · 送货单录入</h3>
            <small>客户与产品来源：云端基础资料</small>
          </div>
          <button
            type="button"
            className="close"
            aria-label="关闭送货单"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {templateStore.error && <Alert type="error" message={templateStore.error} />}
        {Object.keys(catalogErrors).length > 0 && (
          <div className="delivery-limit-status" role="alert">
            {Object.entries(catalogErrors).map(([key, error]) => (
              <div key={key}>{error}</div>
            ))}
            <button type="button" onClick={() => setCatalogRevision((value) => value + 1)}>
              重新加载基础资料
            </button>
          </div>
        )}

        {limits.message && <Alert type="warning" message={limits.message} />}
        <p className="delivery-limit-help">
          {formTemplate
            ? `按默认模板「${formTemplate.name}」的实际空间限制输入；完整基础资料不会截断。`
            : '当前使用内置版式。'}
        </p>
        {formTemplate && (
          <div
            ref={limits.root}
            aria-hidden="true"
            style={{
              position: 'fixed',
              left: '-20000px',
              top: 0,
              pointerEvents: 'none',
              width: `${formTemplate.paper.width}mm`,
            }}
          >
            <TemplatePaper template={formTemplate} note={measureNote} />
          </div>
        )}
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            ...initial,
            company_code: initial.company_code ?? session?.user.company_code ?? 'tmy',
          }}
        >
          <fieldset
            disabled={
              busy || templateStore.loading || Boolean(templateStore.error) || !limits.ready
            }
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <Form.Item name="customer_id" hidden>
              <Input />
            </Form.Item>
            <div className="editor-head">
              <label>
                送货单号
                <input
                  readOnly
                  value={
                    'note_number' in initial && initial.note_number
                      ? initial.note_number
                      : '保存后自动生成'
                  }
                  title="系统自动生成"
                />
              </label>
              <label>
                送货日期
                <Form.Item noStyle name="delivery_date" rules={[{ required: true }]}>
                  <Input type="date" />
                </Form.Item>
              </label>
              <label>
                客户名称
                <Form.Item
                  noStyle
                  name="customer_name_snapshot"
                  rules={[{ required: true, max: 100 }]}
                >
                  <LimitedField
                    accept={chooseCustomer}
                    suggestions={catalogFor('customers').map((x) => ({
                      value: x.name,
                      searchText: `${x.phone ?? ''} ${x.address ?? ''}`,
                    }))}
                  />
                </Form.Item>
              </label>
              <label>
                客户电话
                <Form.Item noStyle name="customer_phone_snapshot">
                  <LimitedField accept={(raw, previous) => head('customerPhone', raw, previous)} />
                </Form.Item>
              </label>
              {publicAccess && (
                <label className="delivery-company-cell">
                  单据公司
                  <Form.Item noStyle name="company_code" rules={[{ required: true }]}>
                    <CompanySelect disabled={busy} />
                  </Form.Item>
                </label>
              )}
              <label className="wide">
                收货地址
                <Form.Item noStyle name="customer_address_snapshot">
                  <LimitedField
                    accept={(raw, previous) => head('customerAddress', raw, previous)}
                  />
                </Form.Item>
              </label>
            </div>
            <div className="editor-personnel">
              {personnelFields.map(([name, label, role, field]) => {
                const learned = personnelOptions[name].map((person) => ({
                  value: person.name,
                  label: `${person.name} · 历史使用 ${person.usage_count} 次`,
                }));
                const known = catalogFor('personnel')
                  .filter((person) => person.role_type === role || person.role_type === 'general')
                  .filter((person) => {
                    const matches = (catalog.employees ?? []).filter((e) => e.name === person.name);
                    return (
                      !matches.length ||
                      matches.some((e) => employeeAvailableOn(e, values.delivery_date))
                    );
                  })
                  .map((person) => ({ value: person.name }));
                const suggestions = [...learned, ...known].filter(
                  (person, index, all) =>
                    all.findIndex((candidate) => candidate.value === person.value) === index,
                );
                return (
                  <label key={name}>
                    {label}
                    <Form.Item noStyle name={name}>
                      <LimitedField
                        suggestions={suggestions}
                        accept={(raw, previous) => {
                          personnelTouched.current.add(name);
                          return head(field as HeadInputField, raw, previous);
                        }}
                      />
                    </Form.Item>
                  </label>
                );
              })}
              <div className="signature-placeholder">
                <span>客户签章</span>
                <strong>打印后由客户签章</strong>
              </div>
            </div>
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <div className="editor-lines">
                  <table>
                    <thead>
                      <tr>
                        <th>序号</th>
                        <th>产品名称</th>
                        <th>规格</th>
                        <th>单位</th>
                        <th>数量</th>
                        <th>单价</th>
                        <th>金额</th>
                        <th>备注</th>
                        <th aria-label="操作" />
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field, index) => (
                        <tr key={field.key}>
                          <td className="delivery-row-index">{index + 1}</td>
                          <td>
                            <Form.Item
                              noStyle
                              name={[field.name, 'product_name']}
                              rules={[{ required: true, message: '请输入产品名称' }]}
                            >
                              <LimitedField
                                placeholder="产品名称"
                                suggestions={catalogFor('products').map((x) => ({
                                  key: x.id,
                                  value: x.name,
                                  label: x.spec ? `${x.name} · ${x.spec}` : x.name,
                                }))}
                                accept={(raw, previous) => chooseProduct(field.name, raw, previous)}
                                acceptSuggestion={(suggestion, previous) =>
                                  chooseProduct(
                                    field.name,
                                    suggestion.value,
                                    previous,
                                    suggestion.key,
                                  )
                                }
                              />
                            </Form.Item>
                          </td>
                          <td>
                            <Form.Item noStyle name={[field.name, 'spec']}>
                              <LimitedField
                                placeholder="规格"
                                accept={(raw, previous) =>
                                  limits.limit('specification', raw, previous, field.name)
                                }
                              />
                            </Form.Item>
                          </td>
                          <td>
                            <Form.Item
                              noStyle
                              name={[field.name, 'unit']}
                              rules={[{ required: true, message: '请输入单位' }]}
                            >
                              <LimitedField
                                placeholder="单位"
                                accept={(raw, previous) =>
                                  limits.limit('unit', raw, previous, field.name)
                                }
                              />
                            </Form.Item>
                          </td>
                          <td>
                            <Form.Item
                              noStyle
                              name={[field.name, 'quantity']}
                              rules={[{ required: true, message: '请输入数量' }]}
                            >
                              <LimitedField
                                type="number"
                                min="0.001"
                                step="0.001"
                                placeholder="数量"
                                accept={(raw, previous) =>
                                  limits.limit('quantity', raw, previous, field.name)
                                }
                              />
                            </Form.Item>
                          </td>
                          <td>
                            <Form.Item
                              noStyle
                              name={[field.name, 'unit_price']}
                              rules={[{ required: true, message: '请输入单价' }]}
                            >
                              <LimitedField
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="单价"
                                accept={(raw, previous) =>
                                  limits.limit('unitPrice', raw, previous, field.name)
                                }
                              />
                            </Form.Item>
                          </td>
                          <td className="delivery-row-amount">
                            ¥{' '}
                            {lineAmount(lines[field.name]?.quantity, lines[field.name]?.unit_price)}
                          </td>
                          <td>
                            <Form.Item noStyle name={[field.name, 'remark']}>
                              <LimitedField
                                placeholder="如：赠送"
                                accept={(raw, previous) =>
                                  limits.limit('remark', raw, previous, field.name)
                                }
                              />
                            </Form.Item>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="remove-line"
                              disabled={fields.length === 1}
                              aria-label={`删除第 ${index + 1} 行`}
                              onClick={() => remove(field.name)}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    type="button"
                    className="add-line"
                    disabled={fields.length >= 5}
                    onClick={() =>
                      add({ product_name: '', unit: '个', quantity: 1, unit_price: 0 })
                    }
                  >
                    {fields.length >= 5 ? '每张送货单最多 5 行产品' : '+ 增加一行产品'}
                  </button>
                </div>
              )}
            </Form.List>
          </fieldset>
          <footer>
            <div className="draft-total delivery-total">
              总额（小写）：<strong>¥ {total}</strong>
            </div>
            <div className="delivery-footer-actions">
              <button type="button" className="secondary" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="primary"
                disabled={
                  busy || templateStore.loading || Boolean(templateStore.error) || !limits.ready
                }
                onClick={() => void save()}
              >
                {busy ? '正在保存…' : '保存送货单'}
              </button>
            </div>
          </footer>
        </Form>
      </section>
    </div>
  );
}

export function Deliveries({
  onTask,
  companyId,
  requestedId,
  clearRequest,
}: {
  onTask: (id: string) => void;
  companyId: CompanyId;
  requestedId: string | null;
  clearRequest: () => void;
}) {
  const { deliveryListWidth } = useAppState();
  const [items, setItems] = useState<Delivery[]>([]);
  const [editing, setEditing] = useState<Delivery | DeliveryInput | null>(null);
  const [preview, setPreview] = useState<Delivery[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [revision, setRevision] = useState(0);
  const [total, setTotal] = useState(0);
  const [start, setStart] = useState(today().slice(0, 7) + '-01');
  const [end, setEnd] = useState(monthEnd());
  const [keyword, setKeyword] = useState('');
  const templateStore = usePrintTemplates();
  const visibleItems = items.filter((note) =>
    matchesText(
      `${note.note_number ?? ''} ${note.customer_name_snapshot} ${note.company_name ?? ''}`,
      keyword,
    ),
  );
  const selected = visibleItems.find((note) => note.id === selectedId) ?? null;
  const pageTemplate = defaultPrintTemplate(templateStore.templates);
  useEffect(() => {
    let active = true;
    const loadAll = async () => {
      const loaded: Delivery[] = [];
      let current = 1;
      let expected = 0;
      do {
        const query = new URLSearchParams({
          page: String(current),
          page_size: '200',
          start_date: start,
          end_date: end,
        }).toString();
        const data = await api('GET', `/delivery-notes?${query}`, pageSchema(deliverySchema));
        loaded.push(...data.items);
        expected = data.total;
        current += 1;
      } while (loaded.length < expected);
      if (!active) return;
      setItems(loaded);
      setTotal(expected);
    };
    void loadAll().catch((e) => message.error(errorText(e)));
    return () => {
      active = false;
    };
  }, [start, end, revision]);
  useEffect(() => {
    const visible = new Set(visibleItems.map((note) => note.id));
    setSelectedIds((current) => current.filter((id) => visible.has(id)));
    setSelectedId((current) => (visible.has(current) ? current : (visibleItems[0]?.id ?? '')));
  }, [items, keyword]);
  useEffect(() => {
    if (requestedId)
      void api('GET', `/delivery-notes/${requestedId}`, deliverySchema)
        .then(setEditing)
        .catch((e) => message.error(errorText(e)))
        .finally(clearRequest);
  }, [requestedId, clearRequest]);
  async function openPreview(note: Delivery) {
    try {
      if (templateStore.loading || templateStore.error)
        throw new Error(templateStore.error || '打印模板尚未加载完成');
      setPreview([await api('GET', `/delivery-notes/${note.id}`, deliverySchema)]);
    } catch (e) {
      void message.error(errorText(e));
    }
  }
  async function batchPreview() {
    try {
      if (templateStore.loading || templateStore.error)
        throw new Error(templateStore.error || '打印模板尚未加载完成');
      const notes = await Promise.all(
        selectedIds.map((id) => api('GET', `/delivery-notes/${id}`, deliverySchema)),
      );
      if (notes.some((note) => Boolean(note.is_draft)))
        throw new Error('草稿需要补全保存后才能打印');
      setPreview(notes);
    } catch (e) {
      void message.error(errorText(e));
    }
  }
  const togglePrintSelection = (note: Delivery) => {
    if (note.is_draft) return;
    setSelectedIds((current) => {
      if (current.includes(note.id)) return current.filter((id) => id !== note.id);
      if (current.length >= 2) {
        void message.warning('一次最多选择 2 张送货单一起打印');
        return current;
      }
      return [...current, note.id];
    });
  };
  return (
    <>
      <div className="page notes-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">送货单</p>
            <h2>送货单管理</h2>
            <p>默认按生成时间倒序；同一客户、同一天可连续生成多张送货单。</p>
          </div>
          <button className="primary" onClick={() => setEditing(blank())}>
            + 新建送货单
          </button>
        </div>
        <section className="note-date-filter card">
          <div>
            <label>
              <span>开始日期</span>
              <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
            </label>
            <span className="range-separator">至</span>
            <label>
              <span>结束日期</span>
              <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
            </label>
            <button
              className="secondary"
              onClick={() => {
                setStart(today().slice(0, 7) + '-01');
                setEnd(monthEnd());
              }}
            >
              本月
            </button>
            <button className="secondary" onClick={() => setRevision((value) => value + 1)}>
              刷新
            </button>
          </div>
          <small>
            默认显示本月 · 当前显示 {visibleItems.length} / {total} 单
          </small>
        </section>
        <Splitter
          className="note-splitter"
          onResize={(sizes) => {
            const width = sizes.reduce((sum, size) => sum + size, 0);
            if (width > 0)
              dispatch({ type: 'deliveryListWidth', percent: (sizes[0] / width) * 100 });
          }}
          onResizeEnd={(sizes) => {
            const width = sizes.reduce((sum, size) => sum + size, 0);
            if (width > 0)
              dispatch({
                type: 'deliveryListWidth',
                percent: (sizes[0] / width) * 100,
                remember: true,
              });
          }}
        >
          <Splitter.Panel size={`${deliveryListWidth}%`} min="30%" max="70%">
            <section className="note-list card">
              <div className="list-tools">
                <div>
                  <b>送货单列表</b>
                  <small>
                    共 {total} 单 · 已选 {selectedIds.length}/2
                  </small>
                </div>
                <button
                  className="batch-print-button"
                  disabled={!selectedIds.length}
                  onClick={() => void batchPreview()}
                >
                  <PrinterIcon /> 一起打印{selectedIds.length ? `（${selectedIds.length}）` : ''}
                </button>
                <button
                  className="secondary"
                  disabled={!selectedIds.length}
                  onClick={() => void batchPreview()}
                >
                  预览所选
                </button>
                <button
                  className="secondary"
                  disabled={!selectedIds.length}
                  onClick={() =>
                    void downloadBatch(selectedIds).catch((error) =>
                      message.error(errorText(error)),
                    )
                  }
                >
                  批量 Excel
                </button>
              </div>
              <label className="list-search">
                ⌕
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="筛选单号、客户、全拼或首字母"
                />
              </label>
              <div className="note-scroll">
                {visibleItems.length ? (
                  visibleItems.map((note) => {
                    const printed = note.printed_at
                      ? new Date(note.printed_at.replace(' ', 'T')).toLocaleString('zh-CN')
                      : '';
                    return (
                      <div
                        key={note.id}
                        className={`note-row${note.id === selectedId ? ' selected' : ''}${selectedIds.includes(note.id) ? ' print-picked' : ''}`}
                      >
                        <label className="note-print-select" title="选择后可一起打印，最多 2 张">
                          <input
                            type="checkbox"
                            disabled={Boolean(note.is_draft)}
                            checked={selectedIds.includes(note.id)}
                            onChange={() => togglePrintSelection(note)}
                            aria-label={`选择送货单 ${note.note_number ?? '草稿'}`}
                          />
                          <span />
                        </label>
                        <button className="note-row-open" onClick={() => setSelectedId(note.id)}>
                          <span className="note-dot" />
                          <div className="note-row-copy">
                            <b>{note.note_number ?? '草稿'}</b>
                            <small>
                              {note.customer_name_snapshot} ·{' '}
                              {note.company_name ??
                                (note.company_code === 'tri' ? '趣趣特' : '天美意')}
                            </small>
                          </div>
                          <span
                            className={printed ? 'print-status printed' : 'print-status'}
                            title={printed ? `已打印：${printed}` : '未打印'}
                            aria-label={printed ? '已打印' : '未打印'}
                          >
                            <PrinterIcon />
                          </span>
                          <strong>¥{new Decimal(note.total_amount ?? 0).toFixed(2)}</strong>
                          <small className="note-row-dates">
                            <span>送货日期：{note.delivery_date.slice(0, 10)}</span>
                            {note.created_at && (
                              <span>
                                录入时间：{note.created_at.replace('T', ' ').slice(0, 16)}
                              </span>
                            )}
                          </small>
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <p className="empty-list">没有匹配的送货单</p>
                )}
              </div>
            </section>
          </Splitter.Panel>
          <Splitter.Panel min="30%">
            <section className="print-panel card">
              {selected ? (
                <>
                  <div className="preview-header">
                    <div>
                      <b>送货单内容预览</b>
                      <small>
                        {pageTemplate
                          ? `${pageTemplate.name} · 实纸参考 ${pageTemplate.paper.width} × ${pageTemplate.paper.height} mm`
                          : '内置 Excel 参考版式'}
                      </small>
                      {selected.source_task_id && (
                        <button
                          className="link-button"
                          onClick={() => onTask(selected.source_task_id!)}
                        >
                          来源任务
                          {selected.source_task?.title ? `：${selected.source_task.title}` : ''}
                        </button>
                      )}
                    </div>
                    <div>
                      <button
                        className="secondary"
                        onClick={() =>
                          void api('GET', `/delivery-notes/${selected.id}`, deliverySchema)
                            .then(setEditing)
                            .catch((error) => message.error(errorText(error)))
                        }
                      >
                        编辑
                      </button>
                      <button
                        className="secondary danger"
                        onClick={() =>
                          Modal.confirm({
                            title: `删除送货单 ${selected.note_number ?? '草稿'}？`,
                            onOk: async () => {
                              try {
                                await api('DELETE', `/delivery-notes/${selected.id}`, z.unknown());
                                void message.success('送货单已删除');
                                setRevision((value) => value + 1);
                              } catch (error) {
                                void message.error(errorText(error));
                                throw error;
                              }
                            },
                          })
                        }
                      >
                        删除
                      </button>
                      <button
                        className="secondary"
                        onClick={() =>
                          void download(
                            `/delivery-notes/export?id=${selected.id}`,
                            `${selected.note_number ?? '送货单'}.xlsx`,
                          ).catch((error) => message.error(errorText(error)))
                        }
                      >
                        Excel
                      </button>
                      <button
                        className="secondary"
                        disabled={Boolean(selected.is_draft)}
                        onClick={() => void openPreview(selected)}
                      >
                        预览
                      </button>
                      <button
                        className="primary"
                        disabled={Boolean(selected.is_draft)}
                        onClick={() => void openPreview(selected)}
                      >
                        打印
                      </button>
                    </div>
                  </div>
                  <div className="paper-stage">
                    <DeliveryPrint note={printModel(selected, companyId)} template={pageTemplate} />
                  </div>
                </>
              ) : (
                <div className="empty-preview">请选择左侧送货单，或新建一张送货单。</div>
              )}
            </section>
          </Splitter.Panel>
        </Splitter>
      </div>
      {editing && (
        <DeliveryForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRevision((x) => x + 1);
          }}
        />
      )}
      {preview.length > 0 && (
        <DeliveryPrintPreview
          notes={preview.map((note) => printModel(note, companyId))}
          onClose={() => setPreview([])}
          onPrinted={async () => {
            const results = await Promise.allSettled(
              preview.map((note) =>
                api('PATCH', `/delivery-notes/${note.id}/printed`, z.unknown(), {}),
              ),
            );
            setRevision((value) => value + 1);
            const failed = results
              .map((result, index) => (result.status === 'rejected' ? preview[index] : null))
              .filter((note): note is Delivery => Boolean(note));
            if (failed.length)
              throw new Error(
                `以下送货单未能记录打印时间：${failed.map((note) => note.note_number ?? '草稿').join('、')}`,
              );
          }}
          onExport={async () => {
            if (preview.length === 1)
              await download(
                `/delivery-notes/export?id=${preview[0].id}`,
                `${preview[0].note_number ?? '送货单'}.xlsx`,
              );
            else await downloadBatch(preview.map((note) => note.id));
          }}
        />
      )}
    </>
  );
}
export { Summary } from './DeliverySummary';
