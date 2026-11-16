import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { z } from 'zod';
import { ipc, errorText } from './api';
import { DeliveryPrint } from './DeliveryPrint';
import { findTemplateOverflow } from './TemplatePaper';
import { usePrintTemplates } from './PrintTemplateContext';
import { defaultPrintTemplate } from './default-print-template';
import type { PrintTemplate } from '../electron/print-template-model';
import { companies, type DeliveryNote } from './types';
import { printPageWidth } from './print-page-size';

// Preview DOM and class names are copied from the first-phase NotesView.
// Only cloud IPC/export and global template selection are adapted.
export function DeliveryPrintPreview({
  notes: previewNotes,
  onClose,
  onPrinted,
  onExport,
}: {
  notes: DeliveryNote[];
  onClose: () => void;
  onPrinted: () => Promise<void>;
  onExport: () => Promise<void>;
}) {
  const templateStore = usePrintTemplates();
  const [previewTemplate, setPreviewTemplate] = useState<PrintTemplate | null>(() =>
    structuredClone(defaultPrintTemplate(templateStore.templates)),
  );
  const hasCustom = Boolean(previewTemplate);
  const driverPageWidth = printPageWidth(previewTemplate);
  const [previewOverflow, setPreviewOverflow] = useState<string[]>([]);
  const [printers, setPrinters] = useState<
    { name: string; displayName: string; isDefault?: boolean }[]
  >([]);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [printerError, setPrinterError] = useState('');
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [printing, setPrinting] = useState(false);
  const printInFlight = useRef(false);
  const [copies, setCopies] = useState(1);
  const [printJob, setPrintJob] = useState<{
    kind: 'idle' | 'submitting' | 'success' | 'error';
    message: string;
  }>({ kind: 'idle', message: '' });
  useEffect(() => {
    let active = true;
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() => {
        if (active)
          setPreviewOverflow(
            hasCustom ? findTemplateOverflow(document.querySelector('.print-preview-source')) : [],
          );
      }),
    );
    return () => {
      active = false;
    };
  }, [previewTemplate, previewNotes, hasCustom]);
  const loadPrinters = () => {
    setLoadingPrinters(true);
    setPrinterError('');
    void ipc(
      window.desktop.printers(),
      z.array(
        z.object({ name: z.string(), displayName: z.string(), isDefault: z.boolean().optional() }),
      ),
    )
      .then((items) => {
        setPrinters(items);
        if (!items.length) {
          setSelectedPrinter('');
          setPrinterError('没有检测到可用打印机，请检查系统打印机设置。');
          return;
        }
        setSelectedPrinter((current) => {
          const saved = localStorage.getItem('delivery-printer-name');
          const next =
            items.find((p) => p.name === current)?.name ||
            items.find((p) => p.name === saved)?.name ||
            items.find((p) => p.isDefault)?.name ||
            items[0].name;
          localStorage.setItem('delivery-printer-name', next);
          return next;
        });
      })
      .catch((error) => {
        setPrinterError(`读取打印机失败：${errorText(error)}`);
        setPrinters([]);
        setSelectedPrinter('');
      })
      .finally(() => setLoadingPrinters(false));
  };
  useEffect(() => {
    loadPrinters();
  }, []);
  const closePrintPreview = () => {
    if (!printInFlight.current) onClose();
  };
  const exportPreviewExcel = () => {
    void onExport().catch((error) => setPrintJob({ kind: 'error', message: errorText(error) }));
  };
  const printPreviewNotes = async () => {
    if (printInFlight.current || previewOverflow.length || !selectedPrinter) return;
    printInFlight.current = true;
    setPrinting(true);
    setPrintJob({ kind: 'submitting', message: '正在向打印机提交…' });
    try {
      await ipc(
        window.desktop.print({
          printer: selectedPrinter,
          width: driverPageWidth,
          height: previewTemplate?.paper.height ?? 140,
          copies,
        }),
        z.boolean(),
      );
      try {
        await onPrinted();
        setPrintJob({
          kind: 'success',
          message: '打印任务已提交到系统队列，已记录打印时间，请核对实际出纸。',
        });
      } catch (error) {
        setPrintJob({
          kind: 'success',
          message: `打印任务已提交，但记录打印时间失败：${errorText(error)}。请检查队列，不要直接重打。`,
        });
      }
    } catch (error) {
      setPrintJob({ kind: 'error', message: errorText(error) });
    } finally {
      printInFlight.current = false;
      setPrinting(false);
    }
  };
  return (
    <div
      className="print-preview-modal"
      role="dialog"
      aria-modal="true"
      aria-label="打印预览"
      style={
        {
          '--accent': companies[previewNotes[0].companyId].accent,
          '--print-template-width': `${previewTemplate?.paper.width ?? 210}mm`,
          '--print-template-height': `${previewTemplate?.paper.height ?? 140}mm`,
          '--print-page-width': `${driverPageWidth}mm`,
        } as CSSProperties
      }
    >
      {previewTemplate && (
        <style>{`@media print { @page { size: ${driverPageWidth}mm ${previewTemplate.paper.height}mm; margin:0; } body { width: ${driverPageWidth}mm !important; } }`}</style>
      )}
      <section className="print-preview-dialog">
        <header>
          <div>
            <p className="eyebrow">打印前校对</p>
            <h3>{previewNotes.length === 1 ? previewNotes[0].number : '两张送货单合并打印'}</h3>
            <small>
              {previewNotes.length === 1 ? '一张送货单占一页' : '两张送货单按选择顺序连续打印两页'}
            </small>
          </div>
          <button
            className="close"
            disabled={printing}
            onClick={closePrintPreview}
            aria-label="关闭打印预览"
          >
            ×
          </button>
        </header>
        <div className="print-preview-body">
          <div className="pdf-preview-frame">
            <div className="browser-print-preview">
              {previewNotes.map((note) => (
                <DeliveryPrint key={note.id} note={note} template={previewTemplate} />
              ))}
            </div>
          </div>
          <aside>
            <h4>打印设置</h4>
            <div className="preview-printer-settings">
              <label>
                <span>本次打印模板</span>
                <select
                  aria-label="本次打印模板"
                  disabled={printing || templateStore.loading || !!templateStore.error}
                  value={previewTemplate?.id || ''}
                  onChange={(event) => {
                    setPreviewTemplate(
                      structuredClone(
                        templateStore.templates.find((t) => t.id === event.target.value) ?? null,
                      ),
                    );
                    setPrintJob({ kind: 'idle', message: '' });
                  }}
                >
                  <option value="">内置 Excel 参考版式</option>
                  {templateStore.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.isDefault ? '（默认）' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>打印机</span>
                <select
                  value={selectedPrinter}
                  disabled={loadingPrinters || printing}
                  onChange={(event) => {
                    setSelectedPrinter(event.currentTarget.value);
                    window.localStorage.setItem('delivery-printer-name', event.currentTarget.value);
                  }}
                >
                  {!printers.length && (
                    <option value="">
                      {loadingPrinters ? '正在读取打印机…' : '没有可用打印机'}
                    </option>
                  )}
                  {printers.map((printer) => (
                    <option key={printer.name} value={printer.name}>
                      {printer.displayName}
                      {printer.isDefault ? '（默认）' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>打印份数</span>
                <input
                  type="number"
                  min="1"
                  max="9"
                  value={copies}
                  disabled={printing}
                  onChange={(event) =>
                    setCopies(
                      Math.min(9, Math.max(1, Math.trunc(Number(event.currentTarget.value) || 1))),
                    )
                  }
                />
              </label>
              <button
                className="secondary refresh-printers"
                disabled={loadingPrinters || printing}
                onClick={loadPrinters}
              >
                {loadingPrinters ? '正在刷新…' : '刷新打印机列表'}
              </button>
              {printerError && <div className="printer-error">{printerError}</div>}
            </div>
            <h4 className="print-parameters-title">打印参数</h4>
            <dl>
              {previewTemplate ? (
                <>
                  <div>
                    <dt>纸张 / 驱动页</dt>
                    <dd>
                      {previewTemplate.paper.width} × {previewTemplate.paper.height} mm
                    </dd>
                  </div>
                  <div>
                    <dt>页边距 上 / 右 / 下 / 左</dt>
                    <dd>
                      {previewTemplate.margins.top} / {previewTemplate.margins.right} /{' '}
                      {previewTemplate.margins.bottom} / {previewTemplate.margins.left} mm
                    </dd>
                  </div>
                  <div>
                    <dt>货品行高</dt>
                    <dd>{previewTemplate.table.rowHeight} mm</dd>
                  </div>
                  <div>
                    <dt>字号与坐标</dt>
                    <dd>按模板原尺寸，不拉伸</dd>
                  </div>
                  <div>
                    <dt>页数</dt>
                    <dd>{previewNotes.length} 页</dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt>单张实纸参考</dt>
                    <dd>241 × 93.13 mm（三等分）</dd>
                  </div>
                  <div>
                    <dt>原校准驱动页</dt>
                    <dd>210 × 140 mm</dd>
                  </div>
                  <div>
                    <dt>方向</dt>
                    <dd>横向</dd>
                  </div>
                  <div>
                    <dt>模板宽度</dt>
                    <dd>178 mm</dd>
                  </div>
                  <div>
                    <dt>水平校准</dt>
                    <dd>向右 12 mm</dd>
                  </div>
                  <div>
                    <dt>字体</dt>
                    <dd>宋体（Excel 原始字号）</dd>
                  </div>
                  <div>
                    <dt>纵向布局</dt>
                    <dd>毫米行高，无字体缩放</dd>
                  </div>
                  <div>
                    <dt>页数</dt>
                    <dd>{previewNotes.length} 页</dd>
                  </div>
                </>
              )}
            </dl>
            {previewTemplate && (
              <p>
                请将打印机驱动纸张设为以上尺寸。Excel 导出仍是原始 Excel
                版式，不包含本次自定义拖动布局。
              </p>
            )}
            {!!previewOverflow.length && (
              <div className="tpl-alert error" role="alert">
                本次单据文字可能被裁切：{previewOverflow.join('、')}
                。建议先返回“打印模板”，选中本单据调整尺寸、列宽或字号后再打印。
              </div>
            )}
            <p>
              {previewNotes.length === 2
                ? '按左侧选择顺序作为两个横向页面连续送入针式打印机。'
                : '版式按三联连续纸的实际宽高生成。'}
            </p>
            <p className="native-preview-note">
              左侧就是本次实际打印版式。确认后会直接提交给所选打印机，不会打开 PDF、Excel
              或另一个软件。
            </p>
            {printJob.kind !== 'idle' && (
              <div className={`print-job-status ${printJob.kind}`} role="status">
                {printJob.message}
              </div>
            )}
          </aside>
        </div>
        <footer>
          <button className="secondary" disabled={printing} onClick={closePrintPreview}>
            {printJob.kind === 'success' ? '完成' : '返回修改'}
          </button>
          <button className="secondary" disabled={printing} onClick={exportPreviewExcel}>
            {previewTemplate ? '导出原版 Excel' : '导出所选 Excel'}
          </button>
          <button
            className="primary"
            disabled={printing || loadingPrinters || !selectedPrinter || !!previewOverflow.length}
            onClick={printPreviewNotes}
          >
            {printing
              ? '正在提交打印…'
              : printJob.kind === 'success'
                ? `再次打印（${previewNotes.length} 张）`
                : `打印（${previewNotes.length} 张）`}
          </button>
        </footer>
      </section>
      <div
        className="print-preview-source"
        data-custom-template={hasCustom ? 'true' : undefined}
        aria-hidden="true"
        style={previewTemplate ? { width: `${previewTemplate.paper.width}mm` } : undefined}
      >
        {previewNotes.map((note) => (
          <DeliveryPrint
            key={`print-${note.id}`}
            note={note}
            template={previewTemplate}
            fitToScreen={false}
          />
        ))}
      </div>
    </div>
  );
}
