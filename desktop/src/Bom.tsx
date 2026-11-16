import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Upload,
  message,
} from 'antd';
import type { UploadProps } from 'antd';
import { z } from 'zod';
import { api, download, errorText } from './api';
import { toBomParseRequest } from './bom-contract';
import {
  eggProfileSchema,
  eggUnit,
  eggPart,
  eggQuantity,
  foldRecipeEggs,
  type EggProfile,
} from './bom-eggs';
import { dispatch, useAppState } from './store';

const candidateSchema = z.object({
  product_id: z.string().nullable(),
  product_code: z.string(),
  product_name: z.string(),
  product_spec: z.string(),
  product_unit: z.string(),
  bom_unit: z.string(),
  confidence: z.number(),
  method: z.string(),
});
type Candidate = z.infer<typeof candidateSchema>;

const parsedMaterialSchema = z.object({
  raw_line: z.string(),
  parsed_name: z.string(),
  parsed_spec: z.string(),
  input_quantity: z.string(),
  input_unit: z.string(),
  material_remark: z.string(),
  candidates: z.array(candidateSchema),
  selected: candidateSchema.nullable(),
  match_status: z.enum(['matched', 'unmatched']),
});

const parseResultSchema = z.object({
  bom_number: z.string(),
  company_code: z.enum(['tri', 'tmy']),
  source_text: z.string(),
  finished_product: z.object({
    raw_name: z.string(),
    spec: z.string(),
    yield_quantity: z.string(),
    yield_unit: z.string(),
    candidates: z.array(candidateSchema),
  }),
  materials: z.array(parsedMaterialSchema),
  unmatched_count: z.number(),
});

type ParseResult = z.infer<typeof parseResultSchema>;
type Material = z.infer<typeof parsedMaterialSchema> & {
  pending?: boolean;
  pendingName?: string;
  pendingSpec?: string;
  pendingUnit?: string;
  remember?: boolean;
};

type Draft = Omit<ParseResult, 'materials'> & {
  materials: Material[];
  finishedSelection: Candidate | null;
  finishedPending: boolean;
  finishedPendingName: string;
  finishedPendingSpec: string;
  finishedPendingUnit: string;
};

const listItemSchema = z.object({
  id: z.string(),
  company_code: z.enum(['tri', 'tmy']),
  bom_number: z.string(),
  finished_product_name: z.string(),
  finished_product_spec: z.string(),
  finished_product_code: z.string(),
  finished_category: z.string().nullish(),
  finished_product_unit: z.string(),
  yield_quantity: z.union([z.string(), z.number()]),
  version: z.string(),
  warehouse_name: z.string(),
  remark: z.string(),
  status: z.enum(['draft', 'needs_review', 'pending_material', 'exportable', 'exported']),
  material_count: z.coerce.number(),
  unresolved_count: z.coerce.number(),
  created_at: z.string(),
});
type BomListItem = z.infer<typeof listItemSchema>;

const bomItemSchema = z.object({
  id: z.string(),
  product_code: z.string(),
  product_name: z.string(),
  product_spec: z.string(),
  bom_unit: z.string(),
  material_quantity: z.union([z.string(), z.number()]),
  material_remark: z.string(),
  match_status: z.enum(['matched', 'suggested', 'unmatched', 'pending_product']),
});

const bomDetailSchema = listItemSchema.extend({ items: z.array(bomItemSchema) });
type BomDetail = z.infer<typeof bomDetailSchema>;

const pageSchema = z.object({
  items: z.array(listItemSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});

const importResultSchema = z.object({
  total_count: z.number(),
  created_count: z.number(),
  updated_count: z.number(),
  unchanged_count: z.number(),
  file_name: z.string(),
});

const kingdeeProductSchema = z.object({
  id: z.string(),
  product_code: z.string(),
  product_name: z.string(),
  product_spec: z.string(),
  product_unit: z.string(),
  category_name: z.string(),
  barcode: z.string(),
  disabled: z.coerce.boolean(),
  backflush_enabled: z.coerce.boolean(),
  backflush_warehouse: z.string(),
  backflush_position: z.string(),
  cost_method: z.string(),
  kingdee_synced_at: z.string().nullable(),
});
type KingdeeProduct = z.infer<typeof kingdeeProductSchema>;

const productSearchSchema = z.object({
  items: z.array(kingdeeProductSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});

const productSaveResultSchema = z.object({
  item: kingdeeProductSchema,
  created: z.boolean(),
});

const companyOptions = [
  { value: 'tri', label: '趣趣特' },
  { value: 'tmy', label: '天美意' },
] as const;

const statusLabels: Record<BomListItem['status'], string> = {
  draft: '草稿',
  needs_review: '待检查',
  pending_material: '待新增商品',
  exportable: '可导出',
  exported: '已导出',
};

function candidateLabel(candidate: Candidate): string {
  return `${candidate.product_code} · ${candidate.product_name}${candidate.product_spec ? ` · ${candidate.product_spec}` : ''} · ${candidate.product_unit}`;
}

function ProductMatcherSelect({
  company,
  candidates,
  value,
  inputUnit,
  onChange,
}: {
  company: 'tri' | 'tmy';
  candidates: Candidate[];
  value?: string;
  inputUnit: string;
  onChange: (candidate: Candidate | null, pending: boolean) => void;
}) {
  const [remote, setRemote] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const options = [...candidates, ...remote].filter(
    (candidate, index, all) =>
      candidate.product_id &&
      all.findIndex((item) => item.product_id === candidate.product_id) === index,
  );
  async function search(keyword: string) {
    if (!keyword.trim()) return;
    setLoading(true);
    try {
      const result = await api(
        'GET',
        `/kingdee-products?company_code=${company}&keyword=${encodeURIComponent(keyword.trim())}`,
        productSearchSchema,
      );
      setRemote(
        result.items.map((product) => ({
          product_id: product.id,
          product_code: product.product_code,
          product_name: product.product_name,
          product_spec: product.product_spec,
          product_unit: product.product_unit,
          bom_unit: inputUnit,
          confidence: 100,
          method: '人工搜索选择',
        })),
      );
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Select
      showSearch
      filterOption={false}
      loading={loading}
      value={value}
      placeholder="输入编码、名称或规格搜索全部商品"
      style={{ width: '100%' }}
      onSearch={(keyword) => void search(keyword)}
      onChange={(selected) => {
        if (selected === '__pending__') onChange(null, true);
        else
          onChange(options.find((candidate) => candidate.product_id === selected) ?? null, false);
      }}
      options={[
        ...options.map((candidate) => ({
          value: candidate.product_id ?? '',
          label: `${candidateLabel(candidate)}（${candidate.confidence}分，${candidate.method}）`,
        })),
        { value: '__pending__', label: '＋ 金蝶中尚未建立这个商品' },
      ]}
    />
  );
}

function BatchMatchModal({
  draft,
  open,
  onChange,
  onClose,
}: {
  draft: Draft;
  open: boolean;
  onChange: (next: Draft) => void;
  onClose: () => void;
}) {
  const unresolved = useMemo(
    () =>
      draft.materials.map((item, index) => ({ item, index })).filter(({ item }) => !item.selected),
    [draft.materials],
  );
  const finishedResolved = Boolean(draft.finishedSelection || draft.finishedPending);
  const complete =
    finishedResolved &&
    unresolved.every(({ item }) =>
      item.pending
        ? Boolean(item.pendingName?.trim() && item.pendingUnit?.trim())
        : Boolean(item.selected),
    );

  const setFinished = (value: string) => {
    if (value === '__pending__')
      onChange({
        ...draft,
        finishedSelection: null,
        finishedPending: true,
        finishedPendingName: draft.finishedPendingName || draft.finished_product.raw_name,
        finishedPendingSpec: draft.finishedPendingSpec || draft.finished_product.spec,
        finishedPendingUnit: draft.finishedPendingUnit || draft.finished_product.yield_unit,
      });
    else
      onChange({
        ...draft,
        finishedSelection:
          draft.finished_product.candidates.find((item) => item.product_id === value) ?? null,
        finishedPending: false,
      });
  };

  const updateMaterial = (index: number, update: Partial<Material>) => {
    const materials = draft.materials.map((item, current) =>
      current === index ? { ...item, ...update } : item,
    );
    onChange({ ...draft, materials });
  };

  return (
    <Modal
      title={`批量确认未匹配商品（${unresolved.length + (finishedResolved ? 0 : 1)}项）`}
      open={open}
      width={1180}
      maskClosable={false}
      closable={false}
      cancelText="返回修改原文"
      okText="统一确认"
      okButtonProps={{ disabled: !complete }}
      onCancel={onClose}
      onOk={onClose}
    >
      <Alert
        type="warning"
        showIcon
        message="本次所有未匹配商品集中在这里处理"
        description="选择已有金蝶商品，或者登记为待金蝶新增。待新增商品可以保存草稿，但在同步到有效金蝶编码前不能导出。"
        style={{ marginBottom: 16 }}
      />
      {!draft.finishedSelection && (
        <Card size="small" title="成品" style={{ marginBottom: 12 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <strong>{draft.finished_product.raw_name}</strong>
            <ProductMatcherSelect
              company={draft.company_code}
              candidates={draft.finished_product.candidates}
              inputUnit={draft.finished_product.yield_unit}
              value={draft.finishedPending ? '__pending__' : undefined}
              onChange={(candidate, pending) => {
                if (pending) setFinished('__pending__');
                else if (candidate?.product_id)
                  onChange({ ...draft, finishedSelection: candidate, finishedPending: false });
              }}
            />
            {draft.finishedPending && (
              <Space wrap>
                <Input
                  addonBefore="拟新增名称"
                  value={draft.finishedPendingName}
                  onChange={(event) =>
                    onChange({ ...draft, finishedPendingName: event.target.value })
                  }
                />
                <Input
                  addonBefore="规格"
                  value={draft.finishedPendingSpec}
                  onChange={(event) =>
                    onChange({ ...draft, finishedPendingSpec: event.target.value })
                  }
                />
                <Input
                  addonBefore="单位"
                  value={draft.finishedPendingUnit}
                  onChange={(event) =>
                    onChange({ ...draft, finishedPendingUnit: event.target.value })
                  }
                />
              </Space>
            )}
          </Space>
        </Card>
      )}
      <Table
        size="small"
        rowKey={({ index }) => String(index)}
        pagination={false}
        dataSource={unresolved}
        scroll={{ y: 430 }}
        columns={[
          {
            title: '原始材料',
            width: 210,
            render: (_, row) => (
              <div>
                <strong>{row.item.parsed_name}</strong>
                <div className="muted">{row.item.raw_line}</div>
              </div>
            ),
          },
          {
            title: '用量',
            width: 100,
            render: (_, row) => `${row.item.input_quantity} ${row.item.input_unit}`,
          },
          {
            title: '匹配处理',
            render: (_, row) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                <ProductMatcherSelect
                  company={draft.company_code}
                  candidates={row.item.candidates}
                  inputUnit={row.item.input_unit}
                  value={
                    row.item.pending ? '__pending__' : (row.item.selected?.product_id ?? undefined)
                  }
                  onChange={(candidate, pending) => {
                    if (pending)
                      updateMaterial(row.index, {
                        selected: null,
                        pending: true,
                        pendingName: row.item.pendingName || row.item.parsed_name,
                        pendingSpec: row.item.pendingSpec || row.item.parsed_spec,
                        pendingUnit: row.item.pendingUnit || row.item.input_unit,
                        remember: false,
                      });
                    else if (candidate)
                      updateMaterial(row.index, {
                        selected: candidate,
                        pending: false,
                        remember: true,
                      });
                  }}
                />
                {row.item.pending && (
                  <Space wrap>
                    <Input
                      addonBefore="拟新增名称"
                      value={row.item.pendingName}
                      onChange={(event) =>
                        updateMaterial(row.index, { pendingName: event.target.value })
                      }
                    />
                    <Input
                      addonBefore="规格"
                      value={row.item.pendingSpec}
                      onChange={(event) =>
                        updateMaterial(row.index, { pendingSpec: event.target.value })
                      }
                    />
                    <Input
                      addonBefore="单位"
                      value={row.item.pendingUnit}
                      onChange={(event) =>
                        updateMaterial(row.index, { pendingUnit: event.target.value })
                      }
                    />
                  </Space>
                )}
              </Space>
            ),
          },
        ]}
      />
    </Modal>
  );
}

function BomEditor({ onSaved }: { onSaved: () => void }) {
  const { eggProfile } = useAppState();
  const [eggForm] = Form.useForm<EggProfile>();
  const [eggSettingsOpen, setEggSettingsOpen] = useState(false);
  const [form] = Form.useForm<{
    company_code: 'tri' | 'tmy';
    source_text: string;
    bom_number: string;
    bom_category: string;
    version: string;
    warehouse_name: string;
    remark: string;
    yield_quantity: number;
    finished_product_unit: string;
  }>();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function openEggSettings() {
    eggForm.setFieldsValue(eggProfile);
    setEggSettingsOpen(true);
  }

  async function completeParse(result: ParseResult, profile: EggProfile) {
    const folded = foldRecipeEggs(result.materials, profile);
    const materials: Material[] = [];
    for (const entry of folded) {
      if (entry.kind === 'original') {
        materials.push(entry.material);
        continue;
      }
      const found = await api(
        'GET',
        `/kingdee-products?company_code=${result.company_code}&keyword=${encodeURIComponent('鸡蛋')}&page_size=200`,
        productSearchSchema,
      );
      const eggProducts = found.items.filter(
        (product) =>
          !product.disabled &&
          eggPart({
            ...entry.material,
            parsed_name: product.product_name,
            raw_line: product.product_name,
            material_remark: '',
          }) === 'whole' &&
          ['个', 'g', 'kg'].includes(eggUnit(product.product_unit)) &&
          (!entry.material.parsed_spec || product.product_spec === entry.material.parsed_spec),
      );
      const sameUnit = eggProducts.filter(
        (product) => eggUnit(product.product_unit) === entry.material.input_unit,
      );
      const compatible = sameUnit.length ? sameUnit : eggProducts.length === 1 ? eggProducts : [];
      const outputUnit =
        compatible.length === 1 ? eggUnit(compatible[0]!.product_unit) : entry.material.input_unit;
      const foldedMaterial = {
        ...entry.material,
        input_unit: outputUnit,
        input_quantity: eggQuantity(entry.egg_count, outputUnit, profile.whole_grams),
        material_remark: entry.material.material_remark.replace(
          `导出${entry.material.input_unit}`,
          `导出${outputUnit}`,
        ),
      };
      const candidates: Candidate[] = compatible.map((product) => ({
        product_id: product.id,
        product_code: product.product_code,
        product_name: product.product_name,
        product_spec: product.product_spec,
        product_unit: product.product_unit,
        bom_unit: product.product_unit,
        confidence: 95,
        method: '整蛋折算后匹配',
      }));
      const selected = candidates.length === 1 ? candidates[0]! : null;
      materials.push({
        ...foldedMaterial,
        candidates,
        selected,
        match_status: selected ? 'matched' : 'unmatched',
      });
    }
    const finishedSelection =
      result.finished_product.candidates.length === 1 &&
      (result.finished_product.candidates[0]?.confidence ?? 0) >= 90
        ? (result.finished_product.candidates[0] ?? null)
        : null;
    const next: Draft = {
      ...result,
      materials,
      finishedSelection,
      finishedPending: false,
      finishedPendingName: result.finished_product.raw_name,
      finishedPendingSpec: result.finished_product.spec,
      finishedPendingUnit: result.finished_product.yield_unit,
    };
    setDraft(next);
    form.setFieldsValue({
      bom_number: result.bom_number,
      version: 'V1.0',
      yield_quantity: Number(result.finished_product.yield_quantity),
      finished_product_unit: result.finished_product.yield_unit,
    });
    if (next.materials.some((item) => !item.selected) || !finishedSelection) setReviewOpen(true);
  }

  async function confirmEggSettings() {
    try {
      const values = await eggForm.validateFields();
      const profile = eggProfileSchema.parse(
        Object.fromEntries(
          Object.entries(values).filter(([, value]) => value !== undefined && value !== null),
        ),
      );
      setBusy(true);
      dispatch({ type: 'eggProfile', profile });
      setEggSettingsOpen(false);
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function parse() {
    const values = await form.validateFields(['company_code', 'source_text']);
    setBusy(true);
    setDraft(null);
    try {
      const result = await api('POST', '/bom/parse', parseResultSchema, toBomParseRequest(values));
      await completeParse(result, eggProfile);
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    const values = await form.validateFields();
    const incomplete =
      (!draft.finishedSelection && !draft.finishedPending) ||
      draft.materials.some(
        (item) =>
          !item.selected && !(item.pending && item.pendingName?.trim() && item.pendingUnit?.trim()),
      );
    if (incomplete) {
      setReviewOpen(true);
      void message.warning('请一次处理完全部未匹配商品');
      return;
    }
    const incompatibleEgg = draft.materials.find(
      (item) =>
        item.material_remark.startsWith('整蛋规则v1：') &&
        eggUnit(item.selected?.bom_unit ?? item.pendingUnit ?? item.input_unit) !==
          eggUnit(item.input_unit),
    );
    if (incompatibleEgg) {
      void message.error(
        '鸡蛋的金蝶用量单位与折算单位不一致，请在整蛋折算设置中选择对应单位后重新解析',
      );
      return;
    }
    setBusy(true);
    try {
      await api('POST', '/boms', z.unknown(), {
        ...values,
        finished_product_id: draft.finishedSelection?.product_id ?? null,
        finished_product_name: draft.finishedSelection?.product_name ?? draft.finishedPendingName,
        finished_product_spec: draft.finishedSelection?.product_spec ?? draft.finishedPendingSpec,
        source_text: draft.source_text,
        items: draft.materials.map((item) => ({
          raw_line: item.raw_line,
          parsed_name: item.parsed_name,
          parsed_spec: item.parsed_spec,
          input_quantity: item.input_quantity,
          input_unit: item.input_unit,
          product_id: item.selected?.product_id ?? null,
          product_name: item.selected?.product_name ?? item.pendingName ?? item.parsed_name,
          product_code: item.selected?.product_code ?? '',
          product_spec: item.selected?.product_spec ?? item.pendingSpec ?? item.parsed_spec,
          bom_unit: item.selected?.bom_unit ?? item.pendingUnit ?? item.input_unit,
          material_quantity: item.input_quantity,
          material_remark: item.material_remark,
          match_status: item.selected ? 'matched' : 'pending_product',
          match_confidence: item.selected?.confidence ?? 0,
          match_method: item.selected?.method ?? '待金蝶新增',
          remember_mapping: Boolean(item.remember),
        })),
      });
      void message.success(
        draft.finishedPending || draft.materials.some((item) => item.pending)
          ? 'BOM已保存；待新增商品同步后才能导出'
          : 'BOM已保存，可导出金蝶引入文件',
      );
      setDraft(null);
      form.resetFields();
      form.setFieldsValue({ company_code: 'tri', version: 'V1.0' });
      onSaved();
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          company_code: 'tri',
          version: 'V1.0',
          bom_category: '',
          warehouse_name: '',
        }}
      >
        <Card title="粘贴配方并生成 BOM">
          <Space.Compact block>
            <Form.Item name="company_code" noStyle rules={[{ required: true }]}>
              <Select style={{ width: 170 }} options={[...companyOptions]} />
            </Form.Item>
            <Button type="primary" loading={busy} onClick={() => void parse()}>
              AI 解析并匹配
            </Button>
            <Button disabled={busy} onClick={openEggSettings}>
              整蛋折算设置
            </Button>
          </Space.Compact>
          <Form.Item
            name="source_text"
            label="原始配方"
            rules={[{ required: true, whitespace: true, message: '请粘贴成品和材料用量' }]}
          >
            <Input.TextArea
              rows={9}
              placeholder={'例如：\n蓝莓蛋糕 1个\n鸡蛋 100克\n低筋面粉 80克\n蓝莓 50克'}
            />
          </Form.Item>
        </Card>
        {draft && (
          <Card
            title={`${draft.finishedSelection?.product_name || draft.finishedPendingName || draft.finished_product.raw_name} · BOM 校对`}
            style={{ marginTop: 18 }}
            extra={<Button onClick={() => setReviewOpen(true)}>批量确认未匹配</Button>}
          >
            <div className="form-grid">
              <Form.Item name="bom_number" label="BOM单编号" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="version" label="版本" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="bom_category" label="BOM分类">
                <Input />
              </Form.Item>
              <Form.Item name="yield_quantity" label="产品产量" rules={[{ required: true }]}>
                <InputNumber min={0.000001} precision={6} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="finished_product_unit" label="成品单位" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="warehouse_name" label="发料仓库">
                <Input placeholder="必须与金蝶名称完全一致" />
              </Form.Item>
            </div>
            <Form.Item name="remark" label="BOM备注">
              <Input />
            </Form.Item>
            <Table
              rowKey={(_, index) => String(index)}
              pagination={false}
              dataSource={draft.materials}
              scroll={{ x: 1000 }}
              columns={[
                { title: '原始材料', dataIndex: 'raw_line', width: 220 },
                { title: '解析名称', dataIndex: 'parsed_name', width: 140 },
                {
                  title: '材料用量',
                  width: 120,
                  render: (_, item) => `${item.input_quantity} ${item.input_unit}`,
                },
                {
                  title: '金蝶商品',
                  render: (_, item) =>
                    item.selected ? (
                      <span>{candidateLabel(item.selected)}</span>
                    ) : item.pending ? (
                      <span>
                        {item.pendingName} {item.pendingSpec}
                      </span>
                    ) : (
                      '尚未处理'
                    ),
                },
                {
                  title: '状态',
                  width: 120,
                  render: (_, item) =>
                    item.selected ? (
                      <Tag color="green">已匹配</Tag>
                    ) : item.pending ? (
                      <Tag color="orange">待金蝶新增</Tag>
                    ) : (
                      <Tag color="red">未匹配</Tag>
                    ),
                },
                { title: '折算与损耗', dataIndex: 'material_remark', width: 380 },
              ]}
            />
            <Space style={{ marginTop: 18 }}>
              <Button type="primary" loading={busy} onClick={() => void save()}>
                保存 BOM
              </Button>
              <Button onClick={() => setDraft(null)}>放弃本次解析</Button>
            </Space>
          </Card>
        )}
      </Form>
      <Modal
        title="整蛋折算设置"
        open={eggSettingsOpen}
        confirmLoading={busy}
        onOk={() => void confirmEggSettings()}
        onCancel={() => {
          setEggSettingsOpen(false);
        }}
        okText="保存设置"
      >
        <p>
          默认整蛋50g、蛋黄17g、蛋白33g，按近似生产用量自动折算，剩余部分计入损耗。无需确认即可生成，可在金蝶微调；这里仅用于手动调整本机参数。
        </p>
        <Form form={eggForm} layout="vertical">
          <Form.Item name="yolk_grams" label="每颗鸡蛋的蛋黄重量（克）">
            <InputNumber
              min={0.001}
              max={1000}
              placeholder="留空使用默认估算重量"
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item name="white_grams" label="每颗鸡蛋的蛋白重量（克）">
            <InputNumber
              min={0.001}
              max={1000}
              placeholder="留空使用默认估算重量"
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item name="output_unit" label="金蝶鸡蛋用量单位" rules={[{ required: true }]}>
            <Select
              options={[
                { value: '个', label: '个（颗 / 枚）' },
                { value: 'g', label: '克' },
                { value: 'kg', label: '千克' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="whole_grams"
            label="每颗鸡蛋的金蝶库存计量重量（克）"
            extra="默认50g/颗；可按金蝶库存口径微调，留空恢复50g。"
          >
            <InputNumber
              min={0.001}
              max={2000}
              placeholder="实际库存换算重量"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Modal>
      {draft && (
        <BatchMatchModal
          draft={draft}
          open={reviewOpen}
          onChange={setDraft}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </>
  );
}

type ProductForm = {
  company_code: 'tri' | 'tmy';
  product_code: string;
  product_name: string;
  category_name: string;
  barcode: string;
  product_spec: string;
  product_unit: string;
  disabled: boolean;
  backflush_enabled: boolean;
  backflush_warehouse: string;
  backflush_position: string;
  cost_method: string;
};

const defaultProductForm = (company: 'tri' | 'tmy'): ProductForm => ({
  company_code: company,
  product_code: '',
  product_name: '',
  category_name: '',
  barcode: '',
  product_spec: '',
  product_unit: '',
  disabled: false,
  backflush_enabled: false,
  backflush_warehouse: '',
  backflush_position: '',
  cost_method: '移动平均法',
});

function CatalogManagement() {
  const [company, setCompany] = useState<'tri' | 'tmy'>('tri');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<KingdeeProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [revision, setRevision] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<KingdeeProduct | null>(null);
  const [form] = Form.useForm<ProductForm>();
  const [modal, context] = Modal.useModal();

  useEffect(() => {
    let active = true;
    setLoading(true);
    const query = new URLSearchParams({
      company_code: company,
      page: String(page),
      page_size: '50',
    });
    if (appliedKeyword) query.set('keyword', appliedKeyword);
    void api('GET', `/kingdee-products?${query.toString()}`, productSearchSchema)
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((error) => message.error(errorText(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [company, page, appliedKeyword, revision]);

  function openCreate() {
    setEditing(null);
    form.setFieldsValue(defaultProductForm(company));
    setEditorOpen(true);
  }

  function openEdit(item: KingdeeProduct) {
    setEditing(item);
    form.setFieldsValue({
      company_code: company,
      product_code: item.product_code,
      product_name: item.product_name,
      category_name: item.category_name,
      barcode: item.barcode,
      product_spec: item.product_spec,
      product_unit: item.product_unit,
      disabled: item.disabled,
      backflush_enabled: item.backflush_enabled,
      backflush_warehouse: item.backflush_warehouse,
      backflush_position: item.backflush_position,
      cost_method: item.cost_method || '移动平均法',
    });
    setEditorOpen(true);
  }

  async function saveSingle() {
    try {
      const values = await form.validateFields();
      setBusy(true);
      const result = editing
        ? await api('PATCH', `/kingdee-products/${editing.id}`, productSaveResultSchema, values)
        : await api('POST', '/kingdee-products', productSaveResultSchema, values);
      void message.success(result.created ? '商品已新增' : '商品信息已更新');
      setEditorOpen(false);
      setRevision((value) => value + 1);
    } catch (error) {
      if (error instanceof Error) void message.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const upload: UploadProps['customRequest'] = async ({ file, onSuccess, onError }) => {
    if (!(file instanceof File)) return;
    setBusy(true);
    try {
      const previewData = new FormData();
      previewData.append('file', file);
      const preview = await api(
        'POST',
        `/kingdee-products/import/preview?company_code=${company}`,
        importResultSchema,
        previewData,
      );
      const confirmed = await modal.confirm({
        title: `同步${company === 'tri' ? '趣趣特' : '天美意'}商品库？`,
        content: `共 ${preview.total_count} 条：新增 ${preview.created_count} 条，更新 ${preview.updated_count} 条，不变 ${preview.unchanged_count} 条。`,
        okText: '确认同步',
      });
      if (!confirmed) {
        onSuccess?.('cancelled');
        return;
      }
      const importData = new FormData();
      importData.append('file', file);
      const result = await api(
        'POST',
        `/kingdee-products/import?company_code=${company}`,
        importResultSchema,
        importData,
      );
      void message.success(
        `商品库已同步：新增${result.created_count}，更新${result.updated_count}`,
      );
      setRevision((value) => value + 1);
      onSuccess?.(result);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(errorText(error));
      onError?.(failure);
      void message.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="金蝶商品资料库">
      {context}
      <Alert
        type="info"
        showIcon
        message="BOM 直接使用系统商品数据库"
        description="历史商品已经录入。金蝶商品有新增或修改时，可导入完整“引出列表_商品”Excel 批量更新，也可在这里单条新增或编辑。"
        style={{ marginBottom: 16 }}
      />
      <Space wrap className="filter-controls" style={{ marginBottom: 16 }}>
        <Select
          value={company}
          onChange={(value) => {
            setCompany(value);
            setPage(1);
          }}
          options={[...companyOptions]}
        />
        <Upload accept=".xlsx,.xls" showUploadList={false} customRequest={upload} disabled={busy}>
          <Button loading={busy}>导入 Excel 更新商品库</Button>
        </Upload>
        <Button type="primary" onClick={openCreate}>
          单条录入商品
        </Button>
        <Input.Search
          allowClear
          value={keyword}
          placeholder="搜索商品编码、名称或规格"
          style={{ width: 320 }}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={(value) => {
            setAppliedKeyword(value.trim());
            setPage(1);
          }}
        />
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        scroll={{ x: 1200 }}
        pagination={{
          current: page,
          pageSize: 50,
          total,
          showSizeChanger: false,
          showTotal: (count) => `共 ${count} 条商品`,
          onChange: setPage,
        }}
        columns={[
          { title: '商品编码', dataIndex: 'product_code', width: 130 },
          { title: '商品名称', dataIndex: 'product_name', width: 220 },
          { title: '商品类别', dataIndex: 'category_name', width: 150 },
          { title: '规格型号', dataIndex: 'product_spec', width: 180 },
          { title: '计量单位', dataIndex: 'product_unit', width: 100 },
          { title: '条形码', dataIndex: 'barcode', width: 150 },
          {
            title: '状态',
            width: 90,
            render: (_, item) =>
              item.disabled ? <Tag color="default">已禁用</Tag> : <Tag color="green">启用</Tag>,
          },
          { title: '成本计算方法', dataIndex: 'cost_method', width: 140 },
          {
            title: '操作',
            fixed: 'right',
            width: 90,
            render: (_, item) => (
              <Button type="link" onClick={() => openEdit(item)}>
                编辑
              </Button>
            ),
          },
        ]}
      />
      <Modal
        title={editing ? '编辑金蝶商品' : '单条录入金蝶商品'}
        open={editorOpen}
        width={820}
        confirmLoading={busy}
        okText="保存商品"
        cancelText="取消"
        onOk={() => void saveSingle()}
        onCancel={() => setEditorOpen(false)}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          message="请按照金蝶商品资料的格式填写"
          description="商品编码、商品名称和计量单位必须与金蝶一致。例如：SP00056｜王后低筋面粉｜面粉｜25kg/包｜g。没有条形码、倒冲仓库或仓位时可留空。"
          style={{ marginBottom: 16 }}
        />
        <Form form={form} layout="vertical">
          <Form.Item name="company_code" label="所属公司" rules={[{ required: true }]}>
            <Select options={[...companyOptions]} disabled={Boolean(editing)} />
          </Form.Item>
          <div className="form-grid">
            <Form.Item
              name="product_code"
              label="商品编码"
              extra="填写金蝶商品编码，如 SP00056"
              rules={[{ required: true, message: '请输入金蝶商品编码' }]}
            >
              <Input placeholder="例如：SP00056" />
            </Form.Item>
            <Form.Item
              name="product_name"
              label="商品名称"
              extra="填写金蝶中的完整商品名称"
              rules={[{ required: true, message: '请输入商品名称' }]}
            >
              <Input placeholder="例如：王后低筋面粉" />
            </Form.Item>
            <Form.Item name="category_name" label="商品类别">
              <Input placeholder="例如：面粉、奶油、半成品" />
            </Form.Item>
            <Form.Item name="product_spec" label="规格型号">
              <Input placeholder="例如：25kg/包；没有可留空" />
            </Form.Item>
            <Form.Item
              name="product_unit"
              label="计量单位"
              extra="必须与金蝶一致，如 g、kg、ml、个、件"
              rules={[{ required: true, message: '请输入计量单位' }]}
            >
              <Input placeholder="例如：g" />
            </Form.Item>
            <Form.Item name="barcode" label="条形码">
              <Input placeholder="没有可留空" />
            </Form.Item>
            <Form.Item name="cost_method" label="成本计算方法">
              <Input placeholder="例如：移动平均法" />
            </Form.Item>
            <Form.Item name="backflush_warehouse" label="倒冲仓库">
              <Input placeholder="没有可留空" />
            </Form.Item>
            <Form.Item name="backflush_position" label="倒冲仓位">
              <Input placeholder="没有可留空" />
            </Form.Item>
            <Form.Item name="disabled" label="禁用状态" valuePropName="checked">
              <Switch checkedChildren="禁用" unCheckedChildren="启用" />
            </Form.Item>
            <Form.Item name="backflush_enabled" label="倒冲领料" valuePropName="checked">
              <Switch checkedChildren="是" unCheckedChildren="否" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </Card>
  );
}

export function BomManagement() {
  const [tab, setTab] = useState('list');
  const [items, setItems] = useState<BomListItem[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<Record<string, BomDetail>>({});
  useEffect(() => {
    let active = true;
    setLoading(true);
    void api('GET', '/boms', pageSchema)
      .then((result) => {
        if (active) setItems(result.items);
      })
      .catch((error) => message.error(errorText(error)))
      .finally(() => setLoading(false));
    return () => {
      active = false;
    };
  }, [revision]);

  async function remove(item: BomListItem) {
    try {
      await api('DELETE', `/boms/${item.id}`, z.null());
      setItems((current) => current.filter((record) => record.id !== item.id));
      void message.success('BOM已删除');
    } catch (error) {
      void message.error(errorText(error));
    }
  }

  async function loadDetail(item: BomListItem) {
    if (details[item.id]) return;
    try {
      const detail = await api('GET', `/boms/${item.id}`, bomDetailSchema);
      setDetails((current) => ({ ...current, [item.id]: detail }));
    } catch (error) {
      void message.error(errorText(error));
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">KINGDEE BOM WORKSPACE</span>
          <h1>BOM 管理</h1>
          <p>粘贴配方、匹配金蝶商品，并生成可直接引入的 BOM 文件。</p>
        </div>
      </div>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'list',
            label: 'BOM 汇总',
            children: (
              <Card>
                <Table
                  rowKey="id"
                  loading={loading}
                  dataSource={items}
                  scroll={{ x: 1200 }}
                  expandable={{
                    onExpand: (expanded, item) => {
                      if (expanded) void loadDetail(item);
                    },
                    expandedRowRender: (item) => {
                      const detail = details[item.id];
                      if (!detail) return <span className="muted">正在加载材料明细…</span>;
                      return (
                        <Table
                          size="small"
                          rowKey="id"
                          pagination={false}
                          dataSource={detail.items}
                          scroll={{ x: 1500 }}
                          columns={[
                            { title: '物料编码', dataIndex: 'product_code', width: 120 },
                            { title: '物料名称', dataIndex: 'product_name', width: 180 },
                            { title: '规格型号', dataIndex: 'product_spec', width: 160 },
                            { title: '单位', dataIndex: 'bom_unit', width: 80 },
                            { title: '材料用量', dataIndex: 'material_quantity', width: 110 },
                            { title: '损耗率(%)', width: 100, render: () => '—' },
                            { title: '发料方式', width: 100, render: () => '—' },
                            {
                              title: '发料仓库',
                              width: 120,
                              render: () => detail.warehouse_name || '—',
                            },
                            { title: '发料仓位', width: 100, render: () => '—' },
                            { title: '关键件', width: 90, render: () => '—' },
                            { title: '可替代', width: 90, render: () => '—' },
                            { title: '替代方案编码', width: 130, render: () => '—' },
                            { title: '物料备注', dataIndex: 'material_remark', width: 180 },
                          ]}
                        />
                      );
                    },
                  }}
                  columns={[
                    { title: 'BOM单编号', dataIndex: 'bom_number', width: 170 },
                    {
                      title: '公司',
                      width: 100,
                      render: (_, item) => (item.company_code === 'tri' ? '趣趣特' : '天美意'),
                    },
                    { title: '商品编码', dataIndex: 'finished_product_code', width: 120 },
                    { title: '商品名称', dataIndex: 'finished_product_name', width: 190 },
                    { title: '商品类别(E)', dataIndex: 'finished_category', width: 140 },
                    { title: '规格型号', dataIndex: 'finished_product_spec', width: 130 },
                    { title: '版本', dataIndex: 'version', width: 90 },
                    { title: '是否禁用', width: 90, render: () => '否' },
                    { title: 'BOM备注', dataIndex: 'remark', width: 180 },
                    { title: '材料数', dataIndex: 'material_count', width: 90 },
                    {
                      title: '状态',
                      width: 120,
                      render: (_, item) => (
                        <Tag
                          color={
                            item.unresolved_count
                              ? 'orange'
                              : item.status === 'exported'
                                ? 'blue'
                                : 'green'
                          }
                        >
                          {statusLabels[item.status]}
                        </Tag>
                      ),
                    },
                    {
                      title: '操作',
                      fixed: 'right',
                      width: 220,
                      render: (_, item) => (
                        <Space>
                          <Button
                            disabled={item.unresolved_count > 0 || !item.finished_product_code}
                            onClick={() =>
                              void download(
                                `/boms/${item.id}/export/kingdee`,
                                `${item.bom_number}_金蝶BOM引入.xls`,
                              ).catch((error) => message.error(errorText(error)))
                            }
                          >
                            导出金蝶
                          </Button>
                          <Button danger type="link" onClick={() => void remove(item)}>
                            删除
                          </Button>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'create',
            label: 'AI 生成 BOM',
            children: (
              <BomEditor
                onSaved={() => {
                  setRevision((value) => value + 1);
                  setTab('list');
                }}
              />
            ),
          },
          { key: 'catalog', label: '商品资料维护', children: <CatalogManagement /> },
        ]}
      />
    </>
  );
}
