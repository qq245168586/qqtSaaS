import { useEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import {
  changeTableHeights,
  createPrintTemplate,
  DELIVERY_PAPER_REFERENCE,
  ELEMENT_IDS,
  ELEMENT_LABELS,
  PAPER_PRESETS,
  PAPER_SOURCE,
  resizeTemplateElement,
  roundMm,
  templateBoundsErrors,
  templateOverlaps,
  validatePrintTemplate,
  type ElementBox,
  type ElementId,
  type PrintTemplate,
} from '../electron/print-template-model';
import { usePrintTemplates } from './PrintTemplateContext';
import { findTemplateOverflow, MM_PX, TemplatePaper } from './TemplatePaper';
import { PaperReferenceGuides } from './PaperReferenceGuides';
import { type CompanyId, type DeliveryNote } from './types';
import { defaultPrintTemplate } from './default-print-template';

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 600,
  unit = 'mm',
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  unit?: string;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="tpl-number-field">
      <span>
        {label} <small>{unit}</small>
      </span>
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = e.target.valueAsNumber;
          // Keep incomplete input (e.g. '1' while typing '140') editable.
          if (e.target.value !== '' && Number.isFinite(n) && n >= min && n <= max)
            onChange(roundMm(n));
        }}
        onBlur={() => {
          if (!text.trim() || !Number.isFinite(Number(text))) {
            setText(String(value));
            return;
          }
          const n = roundMm(Math.max(min, Math.min(max, Number(text))));
          setText(String(n));
          if (n !== value) onChange(n);
        }}
      />
    </label>
  );
}
function exampleNote(companyId: CompanyId): DeliveryNote {
  return {
    id: 'template-example',
    companyId,
    number: `${companyId.toUpperCase()}26090712345601`,
    date: '2026-09-07',
    customerName: '示例客户（仅用于模板校对）',
    customerAddress: '示例收货地址 88 号',
    customerPhone: '13800000000',
    page: 1,
    totalPages: 1,
    items: [
      {
        id: 'example-item',
        name: '示例产品',
        specification: '标准装',
        unit: '个',
        quantity: 10,
        unitPrice: 12.5,
      },
    ],
    maker: '张三',
    keeper: '李四',
    salesperson: '王五',
    deliveryPerson: '赵六',
  };
}
export function PrintTemplateEditor({
  notes,
  onDirtyChange,
}: {
  notes: DeliveryNote[];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const store = usePrintTemplates();
  const templates = store.templates;
  const [draft, setDraft] = useState(() => createPrintTemplate(crypto.randomUUID()));
  const [saved, setSaved] = useState('');
  const [selected, setSelected] = useState<ElementId>('title');
  const [tab, setTab] = useState<'paper' | 'element'>('paper');
  const [zoom, setZoom] = useState(0.85);
  const [grid, setGrid] = useState(true);
  const [guides, setGuides] = useState<string[]>([DELIVERY_PAPER_REFERENCE.id]);
  const [sampleId, setSampleId] = useState(notes[0]?.id || '');
  const [past, setPast] = useState<PrintTemplate[]>([]);
  const [future, setFuture] = useState<PrintTemplate[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [overflow, setOverflow] = useState<string[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const canvasViewport = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const resizeStart = useRef<PrintTemplate | null>(null);
  const dirty = saved !== JSON.stringify(draft);
  const fallbackNote = useMemo(() => exampleNote('tmy'), []);
  const note = notes.find((n) => n.id === sampleId) ?? notes[0] ?? fallbackNote;
  const box = draft.elements[selected];
  const bounds = templateBoundsErrors(draft);
  const thirdReferenceErrors = guides.includes(DELIVERY_PAPER_REFERENCE.id)
    ? templateBoundsErrors({ ...draft, paper: DELIVERY_PAPER_REFERENCE })
    : [];
  const overlaps = templateOverlaps(draft);
  const errors = [...bounds, ...overlaps];
  const choose = (t: PrintTemplate) => {
    setDraft(structuredClone(t));
    setSaved(JSON.stringify(t));
    setPast([]);
    setFuture([]);
    setStatus('');
  };
  useEffect(() => {
    if (!store.loading && !initialized.current) {
      initialized.current = true;
      choose(defaultPrintTemplate(templates) ?? draft);
    }
  }, [store.loading]);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  useEffect(() => {
    const check = () => {
      const next = findTemplateOverflow(stage.current);
      setOverflow((current) => (current.join('\n') === next.join('\n') ? current : next));
    };
    const timer = window.setTimeout(check, 150);
    void document.fonts.ready.then(check);
    return () => clearTimeout(timer);
  }, [draft, note]);
  const edit = (next: PrintTemplate) => {
    setPast((p) => [...p.slice(-49), draft]);
    setFuture([]);
    setDraft(next);
    setStatus('');
  };
  const updateBox = (patch: Partial<ElementBox>) =>
    edit(resizeTemplateElement(draft, selected, patch));
  const discardOkay = () => !dirty || window.confirm('模板有未保存的修改，是否放弃这些修改？');
  const save = async () => {
    setBusy(true);
    setStatus('');
    try {
      const result = await store.save(validatePrintTemplate({ ...draft, isDefault: true }));
      choose(result);
      setStatus('已保存到云端，并设为全局默认，应用于两家公司送货单展示和打印。');
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  };
  const makeNew = (copy = false) => {
    if (!discardOkay()) return;
    const next = copy
      ? {
          ...structuredClone(draft),
          id: crypto.randomUUID(),
          name: `${draft.name} 副本`.slice(0, 60),
          isDefault: false,
          updatedAt: '',
        }
      : createPrintTemplate(crypto.randomUUID());
    choose(next);
    setSaved('');
  };
  const referenceSizes = PAPER_PRESETS.filter((p) => guides.includes(p.id));
  const canvasWidth = Math.max(draft.paper.width, ...referenceSizes.map((p) => p.width));
  const canvasHeight = Math.max(draft.paper.height, ...referenceSizes.map((p) => p.height));
  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setFuture((f) => [draft, ...f]);
    setPast((p) => p.slice(0, -1));
    setDraft(previous);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p, draft]);
    setFuture((f) => f.slice(1));
    setDraft(next);
  };
  return (
    <div className="page template-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">全局通用模板</p>
          <h2>打印模板</h2>
          <p>拖动固定元素，按毫米微调；保存后自动应用，送货单展示、预览与打印共用版式。</p>
        </div>
      </div>
      {store.error && (
        <div className="tpl-alert error">
          {store.error}
          <button onClick={() => void store.refresh()}>重试</button>
        </div>
      )}
      <div className="tpl-toolbar card">
        <label>
          已存模板
          <select
            aria-label="已存模板"
            value={templates.some((t) => t.id === draft.id) ? draft.id : ''}
            disabled={busy || store.loading}
            onChange={(e) => {
              const t = templates.find((t) => t.id === e.target.value);
              if (t && discardOkay()) choose(t);
            }}
          >
            <option value="" disabled>
              新模板（待保存）
            </option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isDefault ? ' · 默认' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="tpl-name">
          模板名称
          <input
            aria-label="模板名称"
            maxLength={60}
            value={draft.name}
            disabled={busy}
            onChange={(e) => edit({ ...draft, name: e.target.value })}
          />
        </label>
        <button className="secondary" disabled={busy} onClick={() => makeNew()}>
          新建模板
        </button>
        <button className="secondary" disabled={busy} onClick={() => makeNew(true)}>
          复制
        </button>
        <button
          className="primary"
          disabled={busy || !!errors.length || store.loading || !!store.error}
          onClick={() => void save()}
        >
          {busy ? '正在保存…' : '保存模板'}
        </button>
      </div>
      <div className="tpl-default-row">
        <span>保存后自动用于两家公司的送货单展示和打印；没有自定义模板时才使用系统版式。</span>
        <span>{dirty ? '● 有未保存修改' : '已同步'} · 不修改送货单业务数据</span>
      </div>
      {status && (
        <div className="tpl-alert" role="status">
          {status}
        </div>
      )}
      <div className="tpl-editor-layout">
        <aside className="tpl-inspector card">
          <div className="tpl-tabs">
            <button className={tab === 'paper' ? 'active' : ''} onClick={() => setTab('paper')}>
              纸张与边距
            </button>
            <button className={tab === 'element' ? 'active' : ''} onClick={() => setTab('element')}>
              元素与间距
            </button>
          </div>
          <fieldset disabled={busy}>
            {tab === 'paper' ? (
              <>
                <label>
                  纸张尺寸
                  <select
                    aria-label="纸张尺寸"
                    value={
                      PAPER_PRESETS.find(
                        (p) => p.width === draft.paper.width && p.height === draft.paper.height,
                      )?.id || 'custom'
                    }
                    onChange={(e) => {
                      const p = PAPER_PRESETS.find((p) => p.id === e.target.value);
                      if (p) edit({ ...draft, paper: { width: p.width, height: p.height } });
                    }}
                  >
                    {PAPER_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.width} × {p.height} · {p.name}
                      </option>
                    ))}
                    <option value="custom">自定义尺寸</option>
                  </select>
                </label>
                <div className="tpl-fields">
                  <NumberField
                    label="纸张宽度"
                    value={draft.paper.width}
                    min={80}
                    max={400}
                    onChange={(width) => edit({ ...draft, paper: { ...draft.paper, width } })}
                  />
                  <NumberField
                    label="纸张高度"
                    value={draft.paper.height}
                    min={60}
                    onChange={(height) => edit({ ...draft, paper: { ...draft.paper, height } })}
                  />
                </div>
                <h4>页边距</h4>
                <p className="tpl-help">
                  元素坐标以左、上页边距为原点。调整边距会整体平移，不拉伸文字。
                </p>
                <div className="tpl-fields">
                  {(['top', 'bottom', 'left', 'right'] as const).map((side, index) => (
                    <NumberField
                      key={side}
                      label={['上边距', '下边距', '左边距', '右边距'][index]}
                      value={draft.margins[side]}
                      max={100}
                      onChange={(n) => edit({ ...draft, margins: { ...draft.margins, [side]: n } })}
                    />
                  ))}
                </div>
                <h4>灰色纸张参考线（不打印）</h4>
                {PAPER_PRESETS.map((p) => (
                  <label key={p.id} className="tpl-check">
                    <input
                      type="checkbox"
                      checked={guides.includes(p.id)}
                      onChange={(e) =>
                        setGuides((g) =>
                          e.target.checked ? [...g, p.id] : g.filter((id) => id !== p.id),
                        )
                      }
                    />
                    <span>
                      {p.width} × {p.height} mm
                      <br />
                      <small>{p.name}</small>
                    </span>
                  </label>
                ))}
                <p className="tpl-help">
                  当前实纸是将 279.4 mm 长边分成 3 张：单张 241 ×（279.4 ÷ 3）≈ 241 × 93.13
                  mm，默认灰框和四边距均以此为参考。279.4 mm
                  未等分整张框仅供可选对照，不是单张送货单边界。
                </p>
                <p className="tpl-help">
                  虚线沿用上方页边距，不代表打印机硬边距。参考线不会修改已保存的输出尺寸；要使用三等分输出页，请在“纸张尺寸”中选
                  241 × 93.13，并检查元素是否在边距内。三联指复写层数，三等分指撕纸线间距。
                </p>
                <a href={PAPER_SOURCE} target="_blank" rel="noreferrer">
                  查看爱普生连续纸尺寸说明 ↗
                </a>
              </>
            ) : (
              <>
                <label>
                  选择固定元素
                  <select
                    aria-label="选择固定元素"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value as ElementId)}
                  >
                    {ELEMENT_IDS.map((id) => (
                      <option key={id} value={id}>
                        {ELEMENT_LABELS[id]}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="tpl-help">
                  拖动蓝框边缘或角点缩小、放大宽高；字号不会被拉伸。也可以输入精确尺寸，或用方向键移动
                  0.5 mm（Shift 为 2 mm）。固定元素不能增删。
                </p>
                <div className="tpl-fields">
                  <NumberField label="X 坐标" value={box.x} onChange={(x) => updateBox({ x })} />
                  <NumberField label="Y 坐标" value={box.y} onChange={(y) => updateBox({ y })} />
                  <NumberField
                    label="元素宽度"
                    value={box.width}
                    min={2}
                    onChange={(width) => updateBox({ width })}
                  />
                  <NumberField
                    label="元素高度"
                    value={box.height}
                    min={selected === 'lines' ? 18 : 2}
                    max={selected === 'lines' ? 120 : 600}
                    onChange={(height) => updateBox({ height })}
                  />
                  <NumberField
                    label="字号"
                    unit="pt"
                    value={box.fontSize}
                    min={6}
                    max={36}
                    step={0.5}
                    onChange={(fontSize) => updateBox({ fontSize })}
                  />
                  <NumberField
                    label="行距倍数"
                    unit="倍"
                    value={box.lineHeight}
                    min={0.8}
                    max={2}
                    step={0.05}
                    onChange={(lineHeight) => updateBox({ lineHeight })}
                  />
                  <NumberField
                    label="字间距"
                    value={box.letterSpacing}
                    max={3}
                    onChange={(letterSpacing) => updateBox({ letterSpacing })}
                  />
                  <NumberField
                    label="内部留白"
                    value={box.padding}
                    max={5}
                    onChange={(padding) => updateBox({ padding })}
                  />
                </div>
                <label>
                  文本对齐
                  <select
                    aria-label="文本对齐"
                    value={box.align}
                    onChange={(e) => updateBox({ align: e.target.value as ElementBox['align'] })}
                  >
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                    <option value="right">右对齐</option>
                  </select>
                </label>
                {selected === 'lines' && (
                  <>
                    <h4>表格行高与列宽</h4>
                    <p className="tpl-help">
                      调整行高时，下方合计、说明和签名随之下移；不改变字体比例。
                    </p>
                    <div className="tpl-fields">
                      <NumberField
                        label="货品行高"
                        value={draft.table.rowHeight}
                        min={3}
                        max={20}
                        onChange={(v) =>
                          edit(changeTableHeights(draft, v, draft.table.headerHeight))
                        }
                      />
                      <NumberField
                        label="表头行高"
                        value={draft.table.headerHeight}
                        min={3}
                        max={20}
                        onChange={(v) => edit(changeTableHeights(draft, draft.table.rowHeight, v))}
                      />
                      {draft.table.columnWeights.map((weight, index) => (
                        <NumberField
                          key={index}
                          label={`${['序号', '订单编号', '品名', ...(draft.table.columnWeights.length === 9 ? ['规格'] : []), '单位', '数量', '单价', '金额', '备注'][index]}列权重`}
                          value={weight}
                          unit="比例"
                          min={1}
                          max={200}
                          onChange={(v) =>
                            edit({
                              ...draft,
                              table: {
                                ...draft.table,
                                columnWeights: draft.table.columnWeights.map((w, i) =>
                                  i === index ? v : w,
                                ),
                              },
                            })
                          }
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </fieldset>
          <hr />
          <button
            className="tpl-delete"
            disabled={busy || !templates.some((t) => t.id === draft.id)}
            onClick={async () => {
              if (
                !window.confirm(
                  '删除此打印模板？如果它是默认模板，将恢复使用内置版式。不会删除送货单。',
                )
              )
                return;
              setBusy(true);
              try {
                await store.remove(draft.id);
                choose(createPrintTemplate(crypto.randomUUID()));
                setStatus('模板已从云端删除，送货单数据不变。');
              } catch (e) {
                setStatus(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            删除当前模板
          </button>
        </aside>
        <section className="tpl-canvas-panel card">
          <div className="tpl-canvas-toolbar">
            <button disabled={!past.length || busy} onClick={undo}>
              撤销
            </button>
            <button disabled={!future.length || busy} onClick={redo}>
              重做
            </button>
            <label>
              <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />{' '}
              0.5 mm 吸附
            </label>
            <select
              aria-label="画布缩放"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              {![0.5, 0.65, 0.75, 0.85, 1, 1.25].includes(zoom) && (
                <option value={zoom}>{Math.round(zoom * 100)}%</option>
              )}
              {[0.5, 0.65, 0.75, 0.85, 1, 1.25].map((z) => (
                <option key={z} value={z}>
                  {Math.round(z * 100)}%
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                setZoom(
                  Math.max(
                    0.25,
                    Math.min(
                      1.25,
                      ((canvasViewport.current?.clientWidth || 800) - 72) / (canvasWidth * MM_PX),
                    ),
                  ),
                )
              }
            >
              适合宽度
            </button>
            <button
              onClick={() =>
                setZoom(
                  Math.max(
                    0.2,
                    Math.min(
                      1.25,
                      ((canvasViewport.current?.clientWidth || 800) - 96) / (canvasWidth * MM_PX),
                      ((canvasViewport.current?.clientHeight || 660) - 96) / (canvasHeight * MM_PX),
                    ),
                  ),
                )
              }
            >
              适合画布
            </button>
          </div>
          <div className="tpl-reference-summary">
            单张实纸参考：241 ×（279.4 ÷ 3）≈ 241 × 93.13 mm
            {guides.includes('third') ? '（灰框已显示）' : '（灰框未显示）'}。当前模板输出页：
            {draft.paper.width} × {draft.paper.height} mm，参考线不改变输出尺寸。
            <br />
            纸张左上角为共同原点；元素 X/Y 从左、上页边距开始计算。文字和线条按实际 mm / pt
            输出，不随窗口改变。
          </div>
          <label className="tpl-sample">
            校对单据
            <select
              aria-label="校对单据"
              value={note.id}
              onChange={(e) => setSampleId(e.target.value)}
            >
              {notes.length ? (
                notes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.number} · {n.customerName}
                  </option>
                ))
              ) : (
                <option value="template-example">示例数据（不会保存为送货单）</option>
              )}
            </select>
          </label>
          <div className="tpl-canvas-viewport" ref={canvasViewport}>
            <div
              className="tpl-canvas-size"
              style={{
                width: canvasWidth * MM_PX * zoom + 48,
                height: canvasHeight * MM_PX * zoom + 56,
              }}
            >
              <div
                ref={stage}
                className="tpl-design-surface"
                style={{
                  width: canvasWidth * MM_PX,
                  height: canvasHeight * MM_PX,
                  transform: `scale(${zoom})`,
                }}
              >
                <TemplatePaper template={draft} note={note} />
                <div
                  className="tpl-margin-guide"
                  style={{
                    left: draft.margins.left * MM_PX,
                    top: draft.margins.top * MM_PX,
                    width:
                      Math.max(0, draft.paper.width - draft.margins.left - draft.margins.right) *
                      MM_PX,
                    height:
                      Math.max(0, draft.paper.height - draft.margins.top - draft.margins.bottom) *
                      MM_PX,
                  }}
                />
                <PaperReferenceGuides sizes={referenceSizes} margins={draft.margins} />
                <div
                  className="tpl-overlay"
                  style={{
                    left: draft.margins.left * MM_PX,
                    top: draft.margins.top * MM_PX,
                    width:
                      Math.max(0, draft.paper.width - draft.margins.left - draft.margins.right) *
                      MM_PX,
                    height:
                      Math.max(0, draft.paper.height - draft.margins.top - draft.margins.bottom) *
                      MM_PX,
                  }}
                >
                  {ELEMENT_IDS.map((id) => {
                    const b = draft.elements[id];
                    return (
                      <Rnd
                        key={id}
                        className={`tpl-drag-box ${selected === id ? 'selected' : ''}`}
                        size={{ width: b.width * MM_PX, height: b.height * MM_PX }}
                        position={{ x: b.x * MM_PX, y: b.y * MM_PX }}
                        scale={zoom}
                        bounds="parent"
                        enableResizing={selected === id && !busy}
                        disableDragging={busy}
                        minWidth={2 * MM_PX}
                        minHeight={(id === 'lines' ? 18 : 2) * MM_PX}
                        maxHeight={id === 'lines' ? 120 * MM_PX : undefined}
                        resizeGrid={grid ? [MM_PX * 0.5, MM_PX * 0.5] : undefined}
                        resizeHandleComponent={Object.fromEntries(
                          [
                            'top',
                            'right',
                            'bottom',
                            'left',
                            'topRight',
                            'bottomRight',
                            'bottomLeft',
                            'topLeft',
                          ].map((direction) => [
                            direction,
                            <div
                              key={direction}
                              className={`tpl-resize-handle ${direction}`}
                              data-resize={direction}
                              aria-label={`缩放${ELEMENT_LABELS[id]} ${direction}`}
                            />,
                          ]),
                        )}
                        onResizeStart={() => {
                          resizeStart.current = draft;
                          setSelected(id);
                          setTab('element');
                        }}
                        onResize={(_e, _direction, ref, _delta, position) => {
                          const base = resizeStart.current;
                          if (base)
                            setDraft(
                              resizeTemplateElement(base, id, {
                                x: roundMm(Math.max(0, position.x / MM_PX)),
                                y: roundMm(Math.max(0, position.y / MM_PX)),
                                width: roundMm(parseFloat(ref.style.width) / MM_PX),
                                height: roundMm(parseFloat(ref.style.height) / MM_PX),
                              }),
                            );
                        }}
                        onResizeStop={(_e, _direction, ref, _delta, position) => {
                          const base = resizeStart.current;
                          if (!base) return;
                          const next = resizeTemplateElement(base, id, {
                            x: roundMm(Math.max(0, position.x / MM_PX)),
                            y: roundMm(Math.max(0, position.y / MM_PX)),
                            width: roundMm(parseFloat(ref.style.width) / MM_PX),
                            height: roundMm(parseFloat(ref.style.height) / MM_PX),
                          });
                          if (JSON.stringify(base) !== JSON.stringify(next)) {
                            setPast((p) => [...p.slice(-49), base]);
                            setFuture([]);
                          }
                          setDraft(next);
                          setStatus('');
                          resizeStart.current = null;
                        }}
                        dragGrid={grid ? [MM_PX * 0.5, MM_PX * 0.5] : undefined}
                        onDragStart={() => {
                          setSelected(id);
                          setTab('element');
                        }}
                        onDragStop={(_e, d) =>
                          edit({
                            ...draft,
                            elements: {
                              ...draft.elements,
                              [id]: {
                                ...b,
                                x: roundMm(Math.max(0, d.x / MM_PX)),
                                y: roundMm(Math.max(0, d.y / MM_PX)),
                              },
                            },
                          })
                        }
                      >
                        <div
                          role="button"
                          aria-label={`移动${ELEMENT_LABELS[id]}`}
                          tabIndex={0}
                          onFocus={() => setSelected(id)}
                          onClick={() => {
                            setSelected(id);
                            setTab('element');
                          }}
                          onKeyDown={(e) => {
                            if (
                              !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                                e.key,
                              ) ||
                              busy
                            )
                              return;
                            e.preventDefault();
                            const step = e.shiftKey ? 2 : 0.5;
                            edit({
                              ...draft,
                              elements: {
                                ...draft.elements,
                                [id]: {
                                  ...b,
                                  x: roundMm(
                                    Math.max(
                                      0,
                                      b.x +
                                        (e.key === 'ArrowRight'
                                          ? step
                                          : e.key === 'ArrowLeft'
                                            ? -step
                                            : 0),
                                    ),
                                  ),
                                  y: roundMm(
                                    Math.max(
                                      0,
                                      b.y +
                                        (e.key === 'ArrowDown'
                                          ? step
                                          : e.key === 'ArrowUp'
                                            ? -step
                                            : 0),
                                    ),
                                  ),
                                },
                              },
                            });
                          }}
                        >
                          <span>{ELEMENT_LABELS[id]}</span>
                        </div>
                      </Rnd>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className="tpl-canvas-caption">
            白纸：模板输出页 · 默认灰框：241 × 93.13 mm 三等分单张实纸 · 虚线：当前设置的页边距 ·
            蓝框：选中元素。可点“适合画布”查看全部边界；辅助线不打印。
          </div>
          <div className={`tpl-validation ${errors.length ? 'error' : ''}`} role="status">
            {errors.length ? (
              <>
                <b>请调整后再保存</b>
                <ul>
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </>
            ) : (
              <span>✓ 所有元素都在当前模板输出页的边距内，未检测到元素框重叠。</span>
            )}
            {!!thirdReferenceErrors.length && (
              <p data-third-reference-warning>
                三等分实纸参考检查（241 × 93.13 mm）：{thirdReferenceErrors.join('；')}
                。模板输出页与实纸参考分别校验；请按灰色边界调整，本提示不会自动缩放或改写模板。
              </p>
            )}
            {!!overflow.length && (
              <p>
                当前单据文字可能溢出：{overflow.join('、')}。请加大元素尺寸或调整字号、列宽后检查。
              </p>
            )}
            <small>
              内容较长的客户、产品需要分别校对。驱动的不可打印区域与走纸偏移仍需用实际打印机试打；屏幕校验不能替代实机结果。
            </small>
          </div>
        </section>
      </div>
    </div>
  );
}
