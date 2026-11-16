import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Upload,
  message,
} from 'antd';
import { z } from 'zod';
import { api, errorText, http } from './api';

const scopeSchema = z.enum(['shared', 'tri', 'tmy']);
const priceSchema = z
  .object({
    id: z.string(),
    purchase_quantity: z.string(),
    purchase_price_yuan: z.string(),
    unit_cost_yuan_per_base: z.string(),
    effective_date: z.string(),
    source: z.string(),
  })
  .nullable();
const materialSchema = z.object({
  id: z.string(),
  scope: scopeSchema,
  standard_name: z.string(),
  aliases: z.array(z.string()),
  category: z.string(),
  brand: z.string(),
  spec: z.string(),
  purchase_unit: z.string(),
  base_unit: z.string(),
  active: z.boolean(),
  updated_at: z.string(),
  current_price: priceSchema.optional().default(null),
});
type CostMaterial = z.infer<typeof materialSchema>;
const materialPageSchema = z.object({
  items: z.array(materialSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});

const importMaterialSchema = z.object({
  scope: scopeSchema,
  standard_name: z.string(),
  aliases: z.array(z.string()),
  category: z.string(),
  brand: z.string(),
  spec: z.string(),
  purchase_unit: z.string(),
  base_unit: z.string(),
  purchase_quantity: z.string(),
  purchase_price_yuan: z.string(),
  effective_date: z.string(),
});
type ImportMaterial = z.infer<typeof importMaterialSchema>;
const importDraftSchema = z.object({
  materials: z.array(importMaterialSchema),
  source_text: z.string(),
});

const sopListItemSchema = z.object({
  id: z.string(),
  scope: scopeSchema,
  product_name: z.string(),
  product_spec: z.string(),
  yield_quantity: z.string(),
  yield_unit: z.string(),
  version: z.string(),
  calculation_date: z.string(),
  material_count: z.number(),
  batch_cost_yuan: z.string(),
  unit_cost_yuan: z.string(),
  updated_at: z.string(),
});
const sopPageSchema = z.object({
  items: z.array(sopListItemSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});

const sopDraftSchema = z.object({
  scope: scopeSchema,
  product_name: z.string(),
  product_spec: z.string(),
  yield_quantity: z.string(),
  yield_unit: z.string(),
  source_text: z.string(),
  unmatched_count: z.number(),
  materials: z.array(
    z.object({
      raw_line: z.string(),
      name: z.string(),
      quantity: z.string(),
      unit: z.string(),
      note: z.string(),
      candidates: z.array(materialSchema),
      selected: materialSchema.nullable(),
    }),
  ),
});
type SopDraft = z.infer<typeof sopDraftSchema>;

const savedSopSchema = z.object({
  id: z.string(),
  product_name: z.string(),
  batch_cost_yuan: z.string(),
  unit_cost_yuan: z.string(),
  items: z.array(z.unknown()),
});

const scopeOptions = [
  { value: 'shared', label: '两家公司通用' },
  { value: 'tri', label: '趣趣特' },
  { value: 'tmy', label: '天美意' },
];
const unitOptions = ['克', '千克', '斤', '毫克', '毫升', '升', '个', '盒', '袋', '包', '瓶'].map(
  (value) => ({ value, label: value }),
);

function today(): string {
  const date = new Date(Date.now() + 8 * 3600000);
  return date.toISOString().slice(0, 10);
}

function scopeLabel(scope: z.infer<typeof scopeSchema>): string {
  return scope === 'shared' ? '通用' : scope === 'tri' ? '趣趣特' : '天美意';
}

interface MaterialFormValue {
  scope: z.infer<typeof scopeSchema>;
  standard_name: string;
  aliases_text?: string;
  category?: string;
  brand?: string;
  spec?: string;
  purchase_unit: string;
  base_unit: string;
  purchase_quantity: string;
  purchase_price_yuan: string;
  effective_date: string;
}

function MaterialForm({ onSaved, material }: { onSaved: () => void; material?: CostMaterial }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<MaterialFormValue>();
  async function save(values: MaterialFormValue) {
    setBusy(true);
    try {
      await api(
        material ? 'PATCH' : 'POST',
        material ? `/cost/materials/${material.id}` : '/cost/materials',
        materialSchema,
        {
          scope: values.scope,
          standard_name: values.standard_name,
          aliases: (values.aliases_text ?? '')
            .split(/[，,、\n]/u)
            .map((item) => item.trim())
            .filter(Boolean),
          category: values.category ?? '',
          brand: values.brand ?? '',
          spec: values.spec ?? '',
          purchase_unit: values.purchase_unit,
          base_unit: values.base_unit,
          purchase_quantity: values.purchase_quantity,
          purchase_price_yuan: values.purchase_price_yuan,
          effective_date: values.effective_date,
          source: '手工录入',
          active: true,
        },
      );
      void message.success('原材料成本已保存');
      setOpen(false);
      form.resetFields();
      onSaved();
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        type={material ? 'link' : 'primary'}
        onClick={() => {
          form.setFieldsValue(
            material
              ? {
                  scope: material.scope,
                  standard_name: material.standard_name,
                  aliases_text: material.aliases.join('、'),
                  category: material.category,
                  brand: material.brand,
                  spec: material.spec,
                  purchase_unit: material.purchase_unit,
                  base_unit: material.base_unit,
                  purchase_quantity: material.current_price?.purchase_quantity ?? '',
                  purchase_price_yuan: material.current_price?.purchase_price_yuan ?? '',
                  effective_date: today(),
                }
              : {
                  scope: 'shared',
                  purchase_unit: '克',
                  base_unit: '克',
                  effective_date: today(),
                },
          );
          setOpen(true);
        }}
      >
        {material ? '更新' : '新增原材料'}
      </Button>
      <Modal
        title={material ? `更新${material.standard_name}` : '新增原材料成本'}
        open={open}
        width={780}
        confirmLoading={busy}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        okText="确认保存"
      >
        <Alert
          showIcon
          type="info"
          message="采购价和净含量用于计算基础单位成本；系统内部保留8位小数。"
          style={{ marginBottom: 16 }}
        />
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            scope: 'shared',
            purchase_unit: '克',
            base_unit: '克',
            effective_date: today(),
          }}
          onFinish={(values) => void save(values)}
        >
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label="适用范围" name="scope" rules={[{ required: true }]}>
                <Select options={scopeOptions} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="标准名称" name="standard_name" rules={[{ required: true }]}>
                <Input placeholder="例如：安佳淡奶油" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="品牌" name="brand">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label="规格" name="spec">
                <Input placeholder="例如：1L/盒" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="分类" name="category">
                <Input placeholder="例如：乳制品" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="别名" name="aliases_text">
                <Input placeholder="动物奶油、稀奶油" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item label="采购净含量" name="purchase_quantity" rules={[{ required: true }]}>
                <Input inputMode="decimal" placeholder="1000" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="净含量单位" name="purchase_unit" rules={[{ required: true }]}>
                <Select showSearch options={unitOptions} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="基础单位" name="base_unit" rules={[{ required: true }]}>
                <Select showSearch options={unitOptions} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                label="采购价（元）"
                name="purchase_price_yuan"
                rules={[{ required: true }]}
              >
                <Input inputMode="decimal" placeholder="42.80" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="价格生效日期" name="effective_date" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function MaterialsPanel({ revision, refresh }: { revision: number; refresh: () => void }) {
  const [records, setRecords] = useState<CostMaterial[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const query = new URLSearchParams({ page: '1', page_size: '200' });
    if (keyword.trim()) query.set('keyword', keyword.trim());
    void api('GET', `/cost/materials?${query}`, materialPageSchema)
      .then((result) => {
        if (active) setRecords(result.items);
      })
      .catch((error) => message.error(errorText(error)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [keyword, revision]);
  return (
    <Card
      title="原材料成本库"
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="名称、别名、品牌或规格"
            onSearch={setKeyword}
            style={{ width: 260 }}
          />
          <MaterialForm
            onSaved={() => {
              refresh();
            }}
          />
        </Space>
      }
    >
      <Table
        rowKey="id"
        loading={loading}
        dataSource={records}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 1100 }}
        columns={[
          {
            title: '范围',
            dataIndex: 'scope',
            width: 95,
            render: (value: CostMaterial['scope']) => <Tag>{scopeLabel(value)}</Tag>,
          },
          { title: '原材料', dataIndex: 'standard_name', width: 180, fixed: 'left' },
          { title: '品牌', dataIndex: 'brand', width: 120 },
          { title: '规格', dataIndex: 'spec', width: 140 },
          {
            title: '别名',
            dataIndex: 'aliases',
            width: 180,
            render: (value: string[]) => value.join('、') || '—',
          },
          {
            title: '采购价格',
            width: 160,
            render: (_: unknown, record: CostMaterial) =>
              record.current_price
                ? `¥${record.current_price.purchase_price_yuan} / ${record.current_price.purchase_quantity}${record.purchase_unit}`
                : '缺少价格',
          },
          {
            title: '基础单位成本',
            width: 190,
            render: (_: unknown, record: CostMaterial) =>
              record.current_price
                ? `¥${record.current_price.unit_cost_yuan_per_base}/${record.base_unit}`
                : '—',
          },
          {
            title: '生效日期',
            width: 120,
            render: (_: unknown, record: CostMaterial) =>
              record.current_price?.effective_date ?? '—',
          },
          {
            title: '操作',
            width: 90,
            fixed: 'right',
            render: (_: unknown, record: CostMaterial) => (
              <MaterialForm material={record} onSaved={refresh} />
            ),
          },
        ]}
      />
    </Card>
  );
}

function ImportPanel({ onImported }: { onImported: () => void }) {
  const [scope, setScope] = useState<z.infer<typeof scopeSchema>>('shared');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [drafts, setDrafts] = useState<ImportMaterial[]>([]);
  const [busy, setBusy] = useState(false);
  async function parse() {
    if (!file && !text.trim()) {
      void message.warning('请粘贴成本资料或选择文件');
      return;
    }
    setBusy(true);
    try {
      const result = file
        ? await (async () => {
            const form = new FormData();
            form.append('scope', scope);
            form.append('file', file);
            const response = await http.post<unknown>('/cost/materials/import/file', form);
            const envelope = z
              .object({ code: z.number(), message: z.string(), data: z.unknown() })
              .parse(response.data);
            if (envelope.code !== 0) throw new Error(envelope.message);
            return importDraftSchema.parse(envelope.data);
          })()
        : await api('POST', '/cost/materials/import/parse', importDraftSchema, {
            text,
            scope,
          });
      setDrafts(result.materials);
      void message.success(`已解析 ${result.materials.length} 条，请确认后再写入成本库`);
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    try {
      await api(
        'POST',
        '/cost/materials/import/confirm',
        z.object({ items: z.array(materialSchema), total: z.number() }),
        { materials: drafts },
      );
      void message.success('成本资料已导入');
      setDrafts([]);
      setText('');
      setFile(null);
      onImported();
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  const update = (index: number, patch: Partial<ImportMaterial>) =>
    setDrafts((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="AI 导入原材料成本">
        <Alert
          type="info"
          showIcon
          message="AI只生成草稿；下表确认后才写入数据库。XLSX、CSV、TXT均可导入。"
          style={{ marginBottom: 16 }}
        />
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select value={scope} onChange={setScope} options={scopeOptions} style={{ width: 220 }} />
          <Input.TextArea
            rows={8}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              '可粘贴任意格式，例如：\n安佳淡奶油 1L/盒 42.8元 2026-10-01\n蓝莓 125g/盒 18.5元 2026-10-01'
            }
          />
          <Space>
            <Upload
              maxCount={1}
              accept=".xlsx,.csv,.txt"
              beforeUpload={(nextFile) => {
                setFile(nextFile);
                return false;
              }}
              onRemove={() => {
                setFile(null);
              }}
              fileList={file ? [{ uid: 'cost-file', name: file.name, status: 'done' }] : []}
            >
              <Button>选择成本文件</Button>
            </Upload>
            <Button type="primary" loading={busy} onClick={() => void parse()}>
              解析并预览
            </Button>
          </Space>
        </Space>
      </Card>
      {drafts.length > 0 && (
        <Card
          title={`导入确认 · ${drafts.length}条`}
          extra={
            <Button type="primary" loading={busy} onClick={() => void confirm()}>
              确认全部导入
            </Button>
          }
        >
          <Table
            rowKey={(_, index) => String(index)}
            dataSource={drafts}
            pagination={false}
            scroll={{ x: 1200 }}
            columns={[
              {
                title: '原材料',
                width: 180,
                render: (_: unknown, record: ImportMaterial, index: number) => (
                  <Input
                    value={record.standard_name}
                    onChange={(event) => update(index, { standard_name: event.target.value })}
                  />
                ),
              },
              {
                title: '品牌',
                width: 120,
                render: (_: unknown, record: ImportMaterial, index: number) => (
                  <Input
                    value={record.brand}
                    onChange={(event) => update(index, { brand: event.target.value })}
                  />
                ),
              },
              {
                title: '规格',
                width: 140,
                render: (_: unknown, record: ImportMaterial, index: number) => (
                  <Input
                    value={record.spec}
                    onChange={(event) => update(index, { spec: event.target.value })}
                  />
                ),
              },
              {
                title: '净含量',
                width: 110,
                render: (_: unknown, record: ImportMaterial, index: number) => (
                  <Input
                    value={record.purchase_quantity}
                    onChange={(event) => update(index, { purchase_quantity: event.target.value })}
                  />
                ),
              },
              {
                title: '净含量单位',
                width: 120,
                render: (_: unknown, record: ImportMaterial, index: number) => (
                  <Input
                    value={record.purchase_unit}
                    onChange={(event) => update(index, { purchase_unit: event.target.value })}
                  />
                ),
              },
              {
                title: '基础单位',
                width: 110,
                render: (_: unknown, record: ImportMaterial, index: number) => (
                  <Input
                    value={record.base_unit}
                    onChange={(event) => update(index, { base_unit: event.target.value })}
                  />
                ),
              },
              {
                title: '采购价（元）',
                width: 130,
                render: (_: unknown, record: ImportMaterial, index: number) => (
                  <Input
                    value={record.purchase_price_yuan}
                    onChange={(event) => update(index, { purchase_price_yuan: event.target.value })}
                  />
                ),
              },
              {
                title: '生效日期',
                width: 140,
                render: (_: unknown, record: ImportMaterial, index: number) => (
                  <Input
                    type="date"
                    value={record.effective_date}
                    onChange={(event) => update(index, { effective_date: event.target.value })}
                  />
                ),
              },
            ]}
          />
        </Card>
      )}
    </Space>
  );
}

interface EditableSopLine {
  raw_line: string;
  name: string;
  quantity: string;
  unit: string;
  note: string;
  material_id: string | null;
}

function SopsPanel({ revision }: { revision: number }) {
  const [materials, setMaterials] = useState<CostMaterial[]>([]);
  const [records, setRecords] = useState<z.infer<typeof sopListItemSchema>[]>([]);
  const [scope, setScope] = useState<z.infer<typeof scopeSchema>>('shared');
  const [source, setSource] = useState('');
  const [draft, setDraft] = useState<SopDraft | null>(null);
  const [lines, setLines] = useState<EditableSopLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<{
    product_name: string;
    product_spec: string;
    yield_quantity: string;
    yield_unit: string;
    version: string;
    calculation_date: string;
  }>();
  const load = () => {
    void Promise.all([
      api('GET', '/cost/materials?page=1&page_size=200', materialPageSchema),
      api('GET', '/cost/sops?page=1&page_size=200', sopPageSchema),
    ])
      .then(([materialResult, sopResult]) => {
        setMaterials(materialResult.items.filter((item) => item.active));
        setRecords(sopResult.items);
      })
      .catch((error) => message.error(errorText(error)));
  };
  useEffect(load, [revision]);
  async function parse() {
    if (!source.trim()) {
      void message.warning('请粘贴SOP内容');
      return;
    }
    setBusy(true);
    try {
      const result = await api('POST', '/cost/sops/parse', sopDraftSchema, {
        text: source,
        scope,
      });
      setDraft(result);
      setLines(
        result.materials.map((item) => ({
          raw_line: item.raw_line,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          note: item.note,
          material_id: item.selected?.id ?? null,
        })),
      );
      form.setFieldsValue({
        product_name: result.product_name,
        product_spec: result.product_spec,
        yield_quantity: result.yield_quantity,
        yield_unit: result.yield_unit,
        version: 'V1.0',
        calculation_date: today(),
      });
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  function startManual() {
    const manual: SopDraft = {
      scope,
      product_name: '',
      product_spec: '',
      yield_quantity: '1',
      yield_unit: '个',
      source_text: '',
      unmatched_count: 1,
      materials: [],
    };
    setDraft(manual);
    setLines([
      {
        raw_line: '手工录入',
        name: '手工录入',
        quantity: '1',
        unit: '克',
        note: '',
        material_id: null,
      },
    ]);
    form.setFieldsValue({
      product_name: '',
      product_spec: '',
      yield_quantity: '1',
      yield_unit: '个',
      version: 'V1.0',
      calculation_date: today(),
    });
  }
  const selectableMaterials = useMemo(
    () =>
      materials.filter(
        (item) => item.scope === 'shared' || (scope !== 'shared' && item.scope === scope),
      ),
    [materials, scope],
  );
  const updateLine = (index: number, patch: Partial<EditableSopLine>) =>
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );
  async function save(values: {
    product_name: string;
    product_spec: string;
    yield_quantity: string;
    yield_unit: string;
    version: string;
    calculation_date: string;
  }) {
    if (!draft) return;
    if (lines.some((line) => !line.material_id)) {
      void message.warning('请先为所有SOP材料选择成本库原料');
      return;
    }
    setBusy(true);
    try {
      const saved = await api('POST', '/cost/sops', savedSopSchema, {
        scope,
        ...values,
        source_text: source,
        items: lines.map((line) => ({
          material_id: line.material_id,
          quantity: line.quantity,
          unit: line.unit,
          note: line.note,
        })),
      });
      void message.success(
        `${saved.product_name}已保存：本批¥${saved.batch_cost_yuan}，单个¥${saved.unit_cost_yuan}`,
      );
      setDraft(null);
      setLines([]);
      setSource('');
      form.resetFields();
      load();
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="AI生成成本SOP">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select value={scope} onChange={setScope} options={scopeOptions} style={{ width: 220 }} />
          <Input.TextArea
            rows={8}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder={
              '例如：蓝莓蛋糕10个，每个120g\n鸡蛋500g\n低筋面粉300g\n淡奶油600ml\n蓝莓250g'
            }
          />
          <Space>
            <Button type="primary" loading={busy} onClick={() => void parse()}>
              AI解析并预填
            </Button>
            <Button onClick={startManual}>手工新建SOP</Button>
          </Space>
        </Space>
      </Card>
      {draft && (
        <Card title={`${draft.product_name} · 成本SOP校对`}>
          {draft.unmatched_count > 0 && (
            <Alert
              type="warning"
              showIcon
              message={`有${draft.unmatched_count}种原料未自动匹配，请在同一张表中一次性选择。`}
              style={{ marginBottom: 16 }}
            />
          )}
          <Form form={form} layout="vertical" onFinish={(values) => void save(values)}>
            <Row gutter={16}>
              <Col span={6}>
                <Form.Item label="成品名称" name="product_name" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item label="成品规格" name="product_spec">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item label="产量" name="yield_quantity" rules={[{ required: true }]}>
                  <Input inputMode="decimal" />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item label="产量单位" name="yield_unit" rules={[{ required: true }]}>
                  <Select showSearch options={unitOptions} />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item label="版本" name="version" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="核算日期" name="calculation_date" rules={[{ required: true }]}>
              <Input type="date" style={{ width: 220 }} />
            </Form.Item>
            <Table
              rowKey={(_, index) => String(index)}
              dataSource={lines}
              pagination={false}
              scroll={{ x: 1000 }}
              columns={[
                { title: 'AI识别材料', dataIndex: 'name', width: 150 },
                {
                  title: '成本库原料',
                  width: 300,
                  render: (_: unknown, line: EditableSopLine, index: number) => (
                    <Select
                      showSearch
                      optionFilterProp="label"
                      value={line.material_id}
                      placeholder="请选择原料"
                      style={{ width: '100%' }}
                      onChange={(value) => {
                        const selected = selectableMaterials.find(
                          (material) => material.id === value,
                        );
                        updateLine(index, {
                          material_id: value,
                          ...(selected
                            ? { name: selected.standard_name, unit: selected.base_unit }
                            : {}),
                        });
                      }}
                      options={selectableMaterials.map((material) => ({
                        value: material.id,
                        label: `${material.standard_name}${material.brand ? ` · ${material.brand}` : ''}${material.spec ? ` · ${material.spec}` : ''}`,
                      }))}
                    />
                  ),
                },
                {
                  title: '数量',
                  width: 130,
                  render: (_: unknown, line: EditableSopLine, index: number) => (
                    <Input
                      value={line.quantity}
                      onChange={(event) => updateLine(index, { quantity: event.target.value })}
                    />
                  ),
                },
                {
                  title: '单位',
                  width: 120,
                  render: (_: unknown, line: EditableSopLine, index: number) => (
                    <Select
                      showSearch
                      value={line.unit}
                      onChange={(value) => updateLine(index, { unit: value })}
                      options={unitOptions}
                    />
                  ),
                },
                { title: '原文', dataIndex: 'raw_line', width: 220 },
                {
                  title: '操作',
                  width: 90,
                  fixed: 'right',
                  render: (_: unknown, _line: EditableSopLine, index: number) => (
                    <Button
                      danger
                      type="link"
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((current) =>
                          current.filter((_item, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      移除
                    </Button>
                  ),
                },
              ]}
            />
            <Space style={{ marginTop: 18 }}>
              <Button
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    {
                      raw_line: '手工录入',
                      name: '手工录入',
                      quantity: '1',
                      unit: '克',
                      note: '',
                      material_id: null,
                    },
                  ])
                }
              >
                增加原料行
              </Button>
              <Button type="primary" htmlType="submit" loading={busy}>
                确认并保存成本SOP
              </Button>
            </Space>
          </Form>
        </Card>
      )}
      <Card title="成本SOP汇总">
        <Table
          rowKey="id"
          dataSource={records}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          columns={[
            { title: '成品', dataIndex: 'product_name' },
            { title: '规格', dataIndex: 'product_spec' },
            { title: '版本', dataIndex: 'version', width: 90 },
            { title: '原料数', dataIndex: 'material_count', width: 90 },
            {
              title: '本批成本',
              dataIndex: 'batch_cost_yuan',
              render: (value: string) => `¥${value}`,
            },
            {
              title: '单个成本',
              dataIndex: 'unit_cost_yuan',
              render: (value: string) => `¥${value}`,
            },
            { title: '核算日期', dataIndex: 'calculation_date' },
          ]}
        />
      </Card>
    </Space>
  );
}

export function CostingManagement() {
  const [revision, setRevision] = useState(0);
  const [overview, setOverview] = useState({ materials: 0, sops: 0 });
  useEffect(() => {
    void Promise.all([
      api('GET', '/cost/materials?page=1&page_size=1', materialPageSchema),
      api('GET', '/cost/sops?page=1&page_size=1', sopPageSchema),
    ])
      .then(([materials, sops]) => setOverview({ materials: materials.total, sops: sops.total }))
      .catch(() => undefined);
  }, [revision]);
  return (
    <div className="costing-page">
      <section className="hero compact-hero">
        <span className="eyebrow">COST ACCOUNTING WORKSPACE</span>
        <h1>成本核算</h1>
        <p>维护高精度原料价格，使用AI或手工建立SOP，并保留每次核算快照。</p>
      </section>
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col span={6}>
          <Card>
            <Statistic title="原材料" value={overview.materials} suffix="种" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="成本SOP" value={overview.sops} suffix="份" />
          </Card>
        </Col>
      </Row>
      <Tabs
        items={[
          {
            key: 'materials',
            label: '原材料成本',
            children: (
              <MaterialsPanel
                revision={revision}
                refresh={() => setRevision((value) => value + 1)}
              />
            ),
          },
          {
            key: 'sops',
            label: '成本 SOP',
            children: <SopsPanel revision={revision} />,
          },
          {
            key: 'import',
            label: '数据导入',
            children: <ImportPanel onImported={() => setRevision((value) => value + 1)} />,
          },
        ]}
      />
    </div>
  );
}
