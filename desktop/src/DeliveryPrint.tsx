import type { DeliveryNote } from './types';
import { companies } from './types';
import type { PrintTemplate } from '../electron/print-template-model';
import { useDefaultPrintTemplate } from './PrintTemplateContext';
import { FittedTemplatePaper, TemplatePaper } from './TemplatePaper';
import { PhysicalPaperViewport } from './PhysicalPaperViewport';
import { PrintDate } from './PrintDate';

const digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
const unit = ['', '拾', '佰', '仟'];

function fourDigits(value: number) {
  let output = '';
  let pendingZero = false;
  for (let position = 3; position >= 0; position -= 1) {
    const divisor = 10 ** position;
    const current = Math.floor(value / divisor) % 10;
    if (current === 0) {
      if (output) pendingZero = true;
    } else {
      if (pendingZero) output += '零';
      output += digit[current] + unit[position];
      pendingZero = false;
    }
  }
  return output || '零';
}

export function amountInChinese(value: number) {
  const cents = Math.round(value * 100);
  const integer = Math.floor(cents / 100);
  const decimal = cents % 100;
  const integerText =
    integer >= 10000
      ? `${fourDigits(Math.floor(integer / 10000))}万${fourDigits(integer % 10000).replace(/^零/, '')}`
      : fourDigits(integer);
  if (decimal === 0) return `${integerText}元整`;
  const jiao = Math.floor(decimal / 10);
  const fen = decimal % 10;
  return `${integerText}元${jiao ? `${digit[jiao]}角` : ''}${fen ? `${digit[fen]}分` : ''}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

function number(value: number) {
  return Number.isInteger(value)
    ? value.toString()
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function DeliveryPrint({
  note,
  template,
  fitToScreen = true,
}: {
  note: DeliveryNote;
  template?: PrintTemplate | null;
  fitToScreen?: boolean;
}) {
  const defaultTemplate = useDefaultPrintTemplate();
  const active = template === undefined ? defaultTemplate : template;
  if (active)
    return fitToScreen ? (
      <FittedTemplatePaper note={note} template={active} />
    ) : (
      <TemplatePaper note={note} template={active} />
    );
  return fitToScreen ? (
    <PhysicalPaperViewport width={241} height={140}>
      <LegacyDeliveryPrint note={note} />
    </PhysicalPaperViewport>
  ) : (
    <LegacyDeliveryPrint note={note} />
  );
}

export function LegacyDeliveryPrint({ note }: { note: DeliveryNote }) {
  const company = companies[note.companyId];
  const rows = Array.from({ length: 5 }, (_, index) => note.items[index]);
  const total = note.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const sheetColumns =
    note.companyId === 'tri'
      ? '5fr 2fr 8.7266fr 4.4531fr 8.7266fr 5.1797fr 4.4531fr 4.4531fr 7.0898fr 8.543fr 10.453fr 15fr'
      : '5fr 2fr 8.7266fr 4.4531fr 7.3633fr 5.1797fr 5.9063fr 4.4531fr 7.0898fr 8.543fr 10.453fr 15fr';
  const columnWeights =
    note.companyId === 'tri'
      ? [5, 10.7266, 13.1797, 9.6328, 4.4531, 7.0898, 8.543, 10.453, 15]
      : [5, 10.7266, 22.9024, 4.4531, 7.0898, 8.543, 10.453, 15];
  const columnTotal = columnWeights.reduce((sum, value) => sum + value, 0);

  return (
    <article
      className={`delivery-paper delivery-paper--${note.companyId}`}
      style={
        {
          '--company-accent': company.accent,
          '--sheet-columns': sheetColumns,
        } as React.CSSProperties
      }
    >
      <div className="delivery-sheet">
        <div className="delivery-form">
          <div className="delivery-header">
            <div className="excel-company-name">{company.printName}</div>
            <div className="company-contact-row">
              <span>公司地址：{company.address}</span>
              <span>电话：{company.phone}</span>
              <span className="delivery-number">№：{note.number}</span>
            </div>
            <section className="delivery-info-grid">
              <div className="customer-name-line">
                <span>客户名称：</span>
                <strong>{note.customerName}</strong>
              </div>
              <h1>送&nbsp;&nbsp;货&nbsp;&nbsp;单</h1>
              <div className="delivery-date-line">
                <PrintDate value={formatDate(note.date)} />
              </div>
              <div className="customer-address-line">
                <span>客户地址：</span>
                <strong>{note.customerAddress || ''}</strong>
              </div>
              <div className="customer-phone-line">
                <span>客户电话：</span>
                <strong>{note.customerPhone || ''}</strong>
                <small>
                  第{note.page}页/共{note.totalPages}页
                </small>
              </div>
            </section>
          </div>

          <div className="delivery-body">
            <table className="delivery-lines">
              <colgroup>
                {columnWeights.map((weight, index) => (
                  <col key={index} style={{ width: `${(weight / columnTotal) * 100}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th>序号</th>
                  <th>订 单 编 号</th>
                  <th>{note.companyId === 'tri' ? '产品名称' : '品  名 / 规  格'}</th>
                  {note.companyId === 'tri' && <th>规格</th>}
                  <th>单位</th>
                  <th>数量</th>
                  <th>单 价</th>
                  <th>金&nbsp;&nbsp;额</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item, index) => (
                  <tr key={item?.id || `empty-${index}`}>
                    <td>{index + 1}</td>
                    <td>{item?.orderNumber}</td>
                    <td className="product-cell">{item?.name}</td>
                    {note.companyId === 'tri' && <td>{item?.specification}</td>}
                    <td>{item?.unit}</td>
                    <td>{item ? number(item.quantity) : ''}</td>
                    <td>{item ? number(item.unitPrice) : ''}</td>
                    <td>{item ? number(item.quantity * item.unitPrice) : ''}</td>
                    <td>{item?.remark}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <section className="total-row">
              <b className="total-uppercase-label">总额(大写)：</b>
              <span className="total-uppercase-value">{amountInChinese(total)}</span>
              <b className="total-lowercase-label">总额(小写):</b>
              <span className="total-lowercase-value">{total.toFixed(2)}</span>
            </section>
            <section className="delivery-notes">
              <b>说明：</b>
              <div>
                <p>1.货物数量及规格请当面点清验收，有关质量问题交货当日内提出，逾期不予退货。</p>
                <p>2.货款未全部兑现前，本货物仍属本公司所有。</p>
                <p>3.本货物单价为含税单价。</p>
              </div>
            </section>
            <footer className="signatures">
              <span>
                制单:<b>{note.maker}</b>
              </span>
              <span>
                仓管:<b>{note.keeper}</b>
              </span>
              <span>
                业务:<b>{note.salesperson}</b>
              </span>
              <span>
                送货:<b>{note.deliveryPerson}</b>
              </span>
              <span>客户签章:</span>
            </footer>
          </div>
        </div>
        <div className="copy-legend">第一联存根(白)第二联客户(红)第三联回单(黄)</div>
      </div>
    </article>
  );
}

export function DeliveryBatchPrint({ notes }: { notes: DeliveryNote[] }) {
  if (notes.length === 1) return <DeliveryPrint note={notes[0]} />;
  return (
    <section className="delivery-batch-page">
      {notes.slice(0, 2).map((note) => (
        <div className="delivery-batch-slot" key={note.id}>
          <DeliveryPrint note={note} />
        </div>
      ))}
    </section>
  );
}
