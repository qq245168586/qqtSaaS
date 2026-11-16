// Browser + main-process shared schema. Values are physical mm / typographic pt.
export const ELEMENT_LABELS = {
  company: '公司名称',
  companyAddress: '公司地址',
  companyPhone: '公司电话',
  number: '送货单号',
  title: '送货单标题',
  customer: '客户名称',
  address: '收货地址',
  phone: '客户电话',
  date: '送货日期',
  page: '页码',
  lines: '货品表格',
  total: '金额合计',
  terms: '说明条款',
  maker: '制单人',
  keeper: '仓管',
  salesperson: '业务',
  deliveryPerson: '送货人',
  signature: '客户签章',
  legend: '三联说明',
} as const;
export type ElementId = keyof typeof ELEMENT_LABELS;
export const ELEMENT_IDS = Object.keys(ELEMENT_LABELS) as ElementId[];
export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  padding: number;
  letterSpacing: number;
  align: 'left' | 'center' | 'right';
}
export interface PrintTemplate {
  version: 1;
  id: string;
  name: string;
  isDefault: boolean;
  updatedAt: string;
  paper: { width: number; height: number };
  margins: { top: number; right: number; bottom: number; left: number };
  elements: Record<ElementId, ElementBox>;
  table: { rowHeight: number; headerHeight: number; columnWeights: number[] };
}
// User-confirmed stock: 241 mm wide, the 279.4 mm feed length split in thirds.
// Keep stored templates/legacy driver calibration independent of this guide.
export const DELIVERY_PAPER_REFERENCE = { id: 'third', width: 241, height: 93.13 } as const;
export const PAPER_PRESETS = [
  { id: 'half-rounded', name: '241 二等分（常用标称）', width: 241, height: 140 },
  { id: 'half', name: '241 二等分（11 英寸精确等分）', width: 241, height: 139.7 },
  { ...DELIVERY_PAPER_REFERENCE, name: '241 三等分（279.4 ÷ 3，当前实纸参考）' },
  { id: 'full', name: '241 整张（11 英寸）', width: 241, height: 279.4 },
] as const;
export const PAPER_SOURCE =
  'https://www.epson.com.cn/faq/1b29e00cf494479289ad01948b44eb5b.html?productId=14dd9b54180143dc94cc429e8a5787de';
export const roundMm = (n: number) => Math.round(n * 100) / 100;
export function createPrintTemplate(id: string): PrintTemplate {
  const box = (
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize = 10,
    align: ElementBox['align'] = 'left',
  ): ElementBox => ({
    x,
    y,
    width,
    height,
    fontSize,
    lineHeight: 1,
    padding: 0,
    letterSpacing: 0,
    align,
  });
  // Start from 1.0.17's compact physical layout, not the stretched 1.0.16 layout.
  return {
    version: 1,
    id,
    name: '自定义送货单',
    isDefault: false,
    updatedAt: '',
    paper: { width: 241, height: 140 },
    margins: { top: 11, right: 12, bottom: 8, left: 12 },
    elements: {
      company: box(0, 0, 171.5, 6.2, 15, 'center'),
      companyAddress: box(0, 6.2, 100, 4.8, 8),
      companyPhone: box(101, 6.2, 37, 4.8, 8),
      number: box(138.5, 6.2, 33, 4.8, 7),
      customer: box(0, 11, 85, 5, 10),
      title: box(86, 11, 30, 5, 13, 'center'),
      date: box(118, 11, 53.5, 5, 9),
      address: box(0, 16, 121, 6, 8),
      phone: box(122, 16, 49.5, 4, 8),
      page: box(144, 20, 27.5, 3, 7, 'right'),
      lines: { ...box(0, 23, 171.5, 30.48, 10), padding: 0.4 },
      total: box(0, 53.48, 171.5, 5.5, 10),
      terms: box(0, 58.98, 171.5, 15.66, 8),
      maker: box(0, 74.64, 34, 6, 10),
      keeper: box(34.3, 74.64, 34, 6, 10),
      salesperson: box(68.6, 74.64, 34, 6, 10),
      deliveryPerson: box(102.9, 74.64, 34, 6, 10),
      signature: box(137.2, 74.64, 34.3, 6, 10),
      legend: box(173, 6.2, 5, 78, 8),
    },
    table: {
      rowHeight: 5.08,
      headerHeight: 5.08,
      columnWeights: [5, 8, 25.5, 6, 4.5, 6, 7, 9, 13],
    },
  };
}
export function templateBoundsErrors(t: PrintTemplate): string[] {
  const w = t.paper.width - t.margins.left - t.margins.right;
  const h = t.paper.height - t.margins.top - t.margins.bottom;
  return ELEMENT_IDS.filter((id) => {
    const b = t.elements[id];
    return b.x < 0 || b.y < 0 || b.x + b.width > w + 0.02 || b.y + b.height > h + 0.02;
  }).map((id) => `${ELEMENT_LABELS[id]}超出页边距内的可用范围`);
}
export function templateOverlaps(t: PrintTemplate): string[] {
  const result: string[] = [];
  ELEMENT_IDS.forEach((a, i) =>
    ELEMENT_IDS.slice(i + 1).forEach((b) => {
      const x = t.elements[a],
        y = t.elements[b];
      if (
        Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x) > 0.2 &&
        Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y) > 0.2
      )
        result.push(`${ELEMENT_LABELS[a]}与${ELEMENT_LABELS[b]}重叠`);
    }),
  );
  return result;
}
// Whitelist every field, reject absent/extra elements and non-finite CSS values at IPC boundary.
export function validatePrintTemplate(input: unknown): PrintTemplate {
  const t = input as PrintTemplate;
  const fail = (message: string): never => {
    throw new Error(`打印模板无效：${message}`);
  };
  const num = (n: unknown, min: number, max: number) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
      return fail(`数值必须在 ${min} 至 ${max} 范围内`);
    return roundMm(n);
  };
  if (!t || t.version !== 1) fail('版本不正确');
  if (typeof t.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(t.id)) fail('模板标识不正确');
  if (typeof t.name !== 'string' || !t.name.trim() || t.name.trim().length > 60)
    fail('名称需为 1 至 60 个字');
  if (
    !t.paper ||
    !t.margins ||
    !t.table ||
    !t.elements ||
    Object.keys(t.elements).length !== ELEMENT_IDS.length ||
    ELEMENT_IDS.some((id) => !t.elements[id])
  )
    fail('固定元素不能增加或删除');
  const elements = Object.fromEntries(
    ELEMENT_IDS.map((id) => {
      const b = t.elements[id];
      if (!['left', 'center', 'right'].includes(b.align)) fail('对齐方式不正确');
      return [
        id,
        {
          x: num(b.x, 0, 600),
          y: num(b.y, 0, 600),
          width: num(b.width, 2, 600),
          height: num(b.height, 2, 600),
          fontSize: num(b.fontSize, 6, 36),
          lineHeight: num(b.lineHeight, 0.8, 2),
          padding: num(b.padding, 0, 5),
          letterSpacing: num(b.letterSpacing, 0, 3),
          align: b.align,
        },
      ];
    }),
  ) as Record<ElementId, ElementBox>;
  if (!Array.isArray(t.table.columnWeights) || ![8, 9].includes(t.table.columnWeights.length))
    fail('表格列数不正确');
  const result: PrintTemplate = {
    version: 1,
    id: t.id,
    name: t.name.trim(),
    isDefault: t.isDefault === true,
    updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : '',
    paper: { width: num(t.paper.width, 80, 400), height: num(t.paper.height, 60, 600) },
    margins: {
      top: num(t.margins.top, 0, 100),
      right: num(t.margins.right, 0, 100),
      bottom: num(t.margins.bottom, 0, 100),
      left: num(t.margins.left, 0, 100),
    },
    elements,
    table: {
      rowHeight: num(t.table.rowHeight, 3, 20),
      headerHeight: num(t.table.headerHeight, 3, 20),
      columnWeights: t.table.columnWeights.map((n) => num(n, 1, 200)),
    },
  };
  if (
    Math.abs(elements.lines.height - result.table.headerHeight - result.table.rowHeight * 5) > 0.03
  )
    fail('表格高度与行高不一致');
  const errors = [...templateBoundsErrors(result), ...templateOverlaps(result)];
  if (errors.length) fail(errors.join('；'));
  return result;
}
export function changeTableHeights(
  t: PrintTemplate,
  rowHeight: number,
  headerHeight: number,
): PrintTemplate {
  const next = structuredClone(t);
  const oldBottom = next.elements.lines.y + next.elements.lines.height;
  const height = roundMm(headerHeight + rowHeight * 5);
  const delta = height - next.elements.lines.height;
  next.table = { ...next.table, rowHeight, headerHeight };
  ELEMENT_IDS.forEach((id) => {
    if (id !== 'lines' && next.elements[id].y >= oldBottom - 0.01)
      next.elements[id].y = roundMm(next.elements[id].y + delta);
  });
  next.elements.lines.height = height;
  return next;
}

// Resizing changes the container, never stretches the font. The five item rows
// remain equal, and the totals/signatures follow the table's new bottom edge.
export function resizeTemplateElement(
  t: PrintTemplate,
  id: ElementId,
  patch: Partial<ElementBox>,
): PrintTemplate {
  const next = structuredClone(t);
  const old = t.elements[id];
  next.elements[id] = { ...old, ...patch };
  if (id === 'lines' && patch.height !== undefined) {
    const height = Math.max(18, Math.min(120, patch.height));
    const ratio = height / old.height;
    const header = roundMm(Math.max(3, Math.min(20, t.table.headerHeight * ratio)));
    const row = roundMm(Math.max(3, Math.min(20, (height - header) / 5)));
    next.table = { ...t.table, headerHeight: header, rowHeight: row };
    next.elements.lines.height = roundMm(header + row * 5);
    const oldBottom = old.y + old.height;
    const delta = next.elements.lines.y + next.elements.lines.height - oldBottom;
    ELEMENT_IDS.forEach((other) => {
      if (other !== 'lines' && t.elements[other].y >= oldBottom - 0.01)
        next.elements[other].y = roundMm(t.elements[other].y + delta);
    });
  }
  return next;
}
