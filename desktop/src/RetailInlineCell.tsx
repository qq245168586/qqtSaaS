import { useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Input } from 'antd';
import { errorText } from './api';
export function RetailInlineCell({
  value,
  label,
  display,
  type = 'text',
  disabled,
  onSave,
}: {
  value: string;
  label: string;
  display?: ReactNode;
  type?: 'text' | 'money' | 'datetime' | 'multiline';
  disabled?: boolean;
  onSave: (value: string, previous: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(value),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    cancelled = useRef(false),
    host = useRef<HTMLDivElement>(null);
  const original = useRef(value);
  const begin = (initial = value) => {
    if (disabled) return;
    cancelled.current = false;
    original.current = value;
    setDraft(initial);
    setError('');
    setEditing(true);
  };
  const save = async (direction = 0) => {
    if (lock.current || cancelled.current) return;
    const cells = Array.from(
      host.current
        ?.closest('.retail-sheet')
        ?.querySelectorAll<HTMLElement>('[data-retail-cell],tbody input[role="combobox"]') ?? [],
    ).filter((el) => el.getClientRects().length && !el.hasAttribute('disabled'));
    const index = cells.findIndex((el) => host.current?.contains(el));
    const next = direction ? cells[index + direction] : null;
    if ((type === 'datetime' ? draft.replace('T', ' ') : draft) === original.current) {
      setEditing(false);
      if (next) next.focus();
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await onSave(type === 'datetime' ? draft.replace('T', ' ') : draft, original.current);
      setError('');
      setEditing(false);
      if (next?.isConnected) next.focus();
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelled.current = true;
      setEditing(false);
      setError('');
    } else if (e.key === 'Tab' || (e.key === 'Enter' && (type !== 'multiline' || !e.shiftKey))) {
      e.preventDefault();
      void save(e.key === 'Tab' && e.shiftKey ? -1 : 1);
    }
  };
  return (
    <div ref={host} className={`retail-inline-cell${error ? ' has-error' : ''}`}>
      {editing ? (
        type === 'multiline' ? (
          <Input.TextArea
            data-retail-cell
            aria-label={label}
            autoFocus
            autoSize={{ minRows: 2, maxRows: 8 }}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={keys}
          />
        ) : (
          <Input
            data-retail-cell
            aria-label={label}
            autoFocus
            variant="borderless"
            type={type === 'datetime' ? 'datetime-local' : 'text'}
            prefix={type === 'money' ? '¥' : undefined}
            inputMode={type === 'money' ? 'decimal' : undefined}
            value={type === 'datetime' ? draft.replace(' ', 'T') : draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={keys}
          />
        )
      ) : (
        <button
          data-retail-cell
          type="button"
          className="retail-cell-value"
          aria-label={label}
          disabled={disabled}
          onClick={() => begin()}
          onKeyDown={(e) => {
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault();
              begin(e.key);
            }
          }}
        >
          {display ?? (value || <span className="retail-cell-placeholder">点击填写</span>)}
        </button>
      )}
      {busy && <small>保存中…</small>}
      {error && (
        <small role="alert">
          {error}{' '}
          <button type="button" onClick={() => void save()}>
            重试
          </button>
        </small>
      )}
    </div>
  );
}
export function RetailResizeHeader({
  onResizeWidth,
  width,
  children,
  ...props
}: HTMLAttributes<HTMLTableCellElement> & {
  width?: number;
  onResizeWidth?: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number; scale: number } | null>(null);
  return (
    <th {...props} style={{ ...props.style, position: 'relative' }}>
      {children}
      {onResizeWidth && (
        <span
          role="separator"
          aria-label="调整列宽"
          aria-orientation="vertical"
          tabIndex={0}
          className="retail-column-grip"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              onResizeWidth(
                Math.max(64, Math.min(900, (width ?? 120) + (e.key === 'ArrowRight' ? 16 : -16))),
              );
            }
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const th = e.currentTarget.closest('th');
            const scale = th ? th.getBoundingClientRect().width / th.offsetWidth : 1;
            drag.current = { x: e.clientX, width: width ?? 120, scale: scale || 1 };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current)
              onResizeWidth(
                Math.max(
                  64,
                  Math.min(
                    900,
                    drag.current.width + (e.clientX - drag.current.x) / drag.current.scale,
                  ),
                ),
              );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        />
      )}
    </th>
  );
}
export const retailTableComponents = { header: { cell: RetailResizeHeader } };
