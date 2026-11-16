import type { CSSProperties } from 'react';
import {
  ELEMENT_IDS,
  ELEMENT_LABELS,
  type ElementId,
  type PrintTemplate,
} from '../electron/print-template-model';
import { companies, type DeliveryNote } from './types';
import { amountInChinese } from './DeliveryPrint';
import { PhysicalPaperViewport } from './PhysicalPaperViewport';
import { PrintDate } from './PrintDate';

export { MM_PX } from './PhysicalPaperViewport';
export function findTemplateOverflow(root: ParentNode | null): string[] {
  const labels = new Set<string>();
  root?.querySelectorAll<HTMLElement>('.tpl-element').forEach((el) => {
    const nodes = [
      el,
      ...el.querySelectorAll<HTMLElement>(
        '.tpl-cell, .tpl-text, .tpl-terms-content, .tpl-terms-content > div, .tpl-total-content',
      ),
    ];
    if (
      nodes.some(
        (child) =>
          child.scrollHeight > child.clientHeight + 2 || child.scrollWidth > child.clientWidth + 2,
      )
    )
      labels.add(ELEMENT_LABELS[el.dataset.element as ElementId]);
  });
  if (root?.querySelector('[data-date-overflow="true"]')) labels.add('送货日期');
  return [...labels];
}
export function templateElementStyle(t: PrintTemplate, id: ElementId): CSSProperties {
  const b = t.elements[id];
  return {
    left: `${t.margins.left + b.x}mm`,
    top: `${t.margins.top + b.y}mm`,
    width: `${b.width}mm`,
    height: `${b.height}mm`,
    fontSize: `${b.fontSize}pt`,
    lineHeight: b.lineHeight,
    padding: `${b.padding}mm`,
    letterSpacing: `${b.letterSpacing}mm`,
    textAlign: b.align,
  };
}
export function TemplateContent({
  template: t,
  id,
  note,
}: {
  template: PrintTemplate;
  id: ElementId;
  note: DeliveryNote;
}) {
  const c = companies[note.companyId];
  const total = note.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const texts: Partial<Record<ElementId, string>> = {
    company: c.printName,
    companyAddress: `公司地址：${c.address}`,
    companyPhone: `电话：${c.phone}`,
    number: `№：${note.number}`,
    title: '送　货　单',
    customer: `客户名称：${note.customerName}`,
    address: `收货地址：${note.customerAddress || ''}`,
    phone: `客户电话：${note.customerPhone || ''}`,
    date: `送货日期：${note.date.replace(/-/g, '/')}`,
    page: `第${note.page}页/共${note.totalPages}页`,
    maker: `制单：${note.maker}`,
    keeper: `仓管：${note.keeper}`,
    salesperson: `业务：${note.salesperson}`,
    deliveryPerson: `送货：${note.deliveryPerson}`,
    signature: '客户签章：',
    legend: '第一联存根（白）第二联客户（红）第三联回单（黄）',
  };
  if (id === 'lines') {
    const tri = t.table.columnWeights.length === 9;
    const headers = [
      '序号',
      '订单编号',
      tri ? '产品名称' : '品名 / 规格',
      ...(tri ? ['规格'] : []),
      '单位',
      '数量',
      '单价',
      '金额',
      '备注',
    ];
    const sum = t.table.columnWeights.reduce((a, b) => a + b, 0);
    return (
      <div
        className="tpl-table"
        style={
          {
            gridTemplateColumns: t.table.columnWeights
              .map((w) => `minmax(0, ${w / sum}fr)`)
              .join(' '),
            gridTemplateRows: `${t.table.headerHeight}mm repeat(5, ${t.table.rowHeight}mm)`,
            '--cell-pad': `${t.elements.lines.padding}mm`,
          } as CSSProperties
        }
      >
        {headers.map((h) => (
          <div key={h} className="tpl-cell tpl-heading">
            {h}
          </div>
        ))}
        {Array.from({ length: 5 }, (_, i) => {
          const item = note.items[i];
          const values = [
            i + 1,
            item?.orderNumber,
            item ? [item.name, !tri ? item.specification : ''].filter(Boolean).join(' ') : '',
            ...(tri ? [item?.specification] : []),
            item?.unit,
            item?.quantity,
            item?.unitPrice,
            item ? (item.quantity * item.unitPrice).toFixed(2) : '',
            item?.remark,
          ];
          return values.map((v, j) => (
            <div
              data-row={i}
              data-column={j}
              className={`tpl-cell ${j === 2 ? 'tpl-product' : ''}`}
              key={`${i}-${j}`}
            >
              {v}
            </div>
          ));
        })}
      </div>
    );
  }
  if (id === 'total')
    return (
      <div className="tpl-total-content">
        <span>总额(大写)：{amountInChinese(total)}</span>
        <span>总额(小写)：{total.toFixed(2)}</span>
      </div>
    );
  if (id === 'terms')
    return (
      <div className="tpl-terms-content">
        <span>说明：</span>
        <div>
          1.货物数量及规格请当面点清验收，有关质量问题交货当日内提出，逾期不予退货。
          <br />
          2.货款未全部兑现前，本货物仍属本公司所有。
          <br />
          3.本货物单价为含税单价。
        </div>
      </div>
    );
  if (id === 'date') return <PrintDate value={note.date.replace(/-/g, '/')} />;
  return <span className="tpl-text">{texts[id]}</span>;
}
export function TemplatePaper({ template, note }: { template: PrintTemplate; note: DeliveryNote }) {
  return (
    <article
      className="delivery-paper custom-template-paper"
      data-template-id={template.id}
      style={
        {
          '--tpl-width': `${template.paper.width}mm`,
          '--tpl-height': `${template.paper.height}mm`,
          width: `${template.paper.width}mm`,
          height: `${template.paper.height}mm`,
        } as CSSProperties
      }
    >
      {ELEMENT_IDS.map((id) => (
        <div
          key={id}
          data-element={id}
          className={`tpl-element tpl-${id}`}
          style={templateElementStyle(template, id)}
        >
          <TemplateContent template={template} id={id} note={note} />
        </div>
      ))}
    </article>
  );
}
// Screen-only uniform zoom. @media print removes it; printer receives actual mm.
export function FittedTemplatePaper(props: { template: PrintTemplate; note: DeliveryNote }) {
  const { width, height } = props.template.paper;
  return (
    <PhysicalPaperViewport width={width} height={height}>
      <TemplatePaper {...props} />
    </PhysicalPaperViewport>
  );
}
