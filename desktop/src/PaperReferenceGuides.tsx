import { DELIVERY_PAPER_REFERENCE, type PrintTemplate } from '../electron/print-template-model';
import { MM_PX } from './PhysicalPaperViewport';

export function PaperReferenceGuides({
  sizes,
  margins,
}: {
  sizes: ReadonlyArray<{ id: string; width: number; height: number }>;
  margins: PrintTemplate['margins'];
}) {
  return (
    <>
      {sizes.map((p) => (
        <div
          key={p.id}
          data-paper-reference={p.id}
          className="tpl-size-guide"
          style={{ width: p.width * MM_PX, height: p.height * MM_PX }}
        >
          <span className="tpl-reference-size-label">
            {p.id === 'third' ? '单张实纸参考 ' : p.id === 'full' ? '未等分整张 ' : ''}
            {p.width} × {p.height} mm{p.id === 'third' ? '（279.4 ÷ 3）' : ''}
          </span>
          {(p.id === 'third' || p.id === 'full') && (
            <>
              <b className="tpl-reference-title">
                {p.id === 'third'
                  ? '单张实纸：241 × 93.13 mm（279.4 ÷ 3）'
                  : '未等分整张：241 × 279.4 mm'}{' '}
                · 灰线不打印
              </b>
              <div
                className="tpl-reference-margin"
                data-reference-margin={p.id}
                style={{
                  left: margins.left * MM_PX,
                  top: margins.top * MM_PX,
                  width: Math.max(0, p.width - margins.left - margins.right) * MM_PX,
                  height: Math.max(0, p.height - margins.top - margins.bottom) * MM_PX,
                }}
              >
                <i className="top">上边距 {margins.top} mm</i>
                <i className="bottom">下边距 {margins.bottom} mm</i>
                <i className="left">左边距 {margins.left} mm</i>
                <i className="right">右边距 {margins.right} mm</i>
              </div>
              {p.id === 'full' &&
                [1, 2].map((part) => (
                  <div
                    key={part}
                    className="tpl-reference-fold"
                    data-reference-fold={`third-${part}`}
                    style={{ top: ((p.height * part) / 3) * MM_PX }}
                  >
                    <i>
                      第 {part} 条三等分线：{((p.height * part) / 3).toFixed(2)} mm · 每张约{' '}
                      {DELIVERY_PAPER_REFERENCE.height} mm
                    </i>
                  </div>
                ))}
            </>
          )}
        </div>
      ))}
    </>
  );
}
