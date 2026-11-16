import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { matchesText } from './search';

export type InputSuggestion = {
  key?: string;
  value: string;
  label?: string;
  searchText?: string;
};

// Do not trim an IME's unfinished syllables. Only the committed text reaches
// the draft; keeping local text also restores rejected input immediately.
export function TemplateLimitedInput({
  value,
  onValueChange,
  onSuggestionSelect,
  suggestions,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => string;
  onSuggestionSelect?: (suggestion: InputSuggestion) => string;
  suggestions?: InputSuggestion[];
}) {
  const [text, setText] = useState(value);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 240 });
  const choices =
    suggestions?.filter((s) =>
      matchesText(`${s.value} ${s.label || ''} ${s.searchText || ''}`, query),
    ) ?? [];
  const expanded = !!suggestions && open && !props.disabled;
  useEffect(() => {
    if (!expanded) return;
    const update = () => {
      const rect = input.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 8;
      const above = below < 150 && rect.top > below;
      const maxHeight = Math.min(240, Math.max(60, above ? rect.top - 8 : below));
      setPosition({
        left: Math.max(4, rect.left),
        top: above ? Math.max(4, rect.top - maxHeight) : rect.bottom,
        width: Math.min(Math.max(rect.width, 220), window.innerWidth - rect.left - 8),
        maxHeight,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [expanded]);
  useEffect(() => {
    if (active >= 0)
      document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);
  useEffect(() => {
    if (!composing.current) setText(value);
  }, [value]);
  const commit = (raw: string) => setText(onValueChange(raw));
  const choose = (choice: InputSuggestion) => {
    setText(onSuggestionSelect ? onSuggestionSelect(choice) : onValueChange(choice.value));
    setOpen(false);
    setActive(-1);
  };
  return (
    <>
      <input
        {...props}
        ref={input}
        value={text}
        role={suggestions ? 'combobox' : props.role}
        autoComplete={suggestions ? 'off' : props.autoComplete}
        aria-autocomplete={suggestions ? 'list' : undefined}
        aria-expanded={suggestions ? expanded : undefined}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        onFocus={(e) => {
          setOpen(true);
          setQuery('');
          setActive(-1);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setOpen(false);
          props.onBlur?.(e);
        }}
        onKeyDown={(e) => {
          props.onKeyDown?.(e);
          if (!suggestions || composing.current || e.nativeEvent.isComposing || e.defaultPrevented)
            return;
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            setActive((i) =>
              !choices.length
                ? -1
                : i < 0
                  ? e.key === 'ArrowDown'
                    ? 0
                    : choices.length - 1
                  : (i + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length,
            );
          }
          if (e.key === 'Enter' && expanded && active >= 0 && choices[active]) {
            e.preventDefault();
            choose(choices[active]);
          }
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          setQuery(e.currentTarget.value);
          setActive(-1);
          commit(e.currentTarget.value);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(-1);
          setOpen(true);
          if (composing.current || (e.nativeEvent as InputEvent).isComposing)
            setText(e.target.value);
          else commit(e.target.value);
        }}
      />
      {expanded &&
        createPortal(
          <div
            id={listId}
            role="listbox"
            aria-label="匹配的历史资料"
            className="pinyin-suggestions"
            style={position}
          >
            {choices.map((choice, index) => (
              <div
                key={choice.key ?? `${choice.value}-${index}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(choice)}
              >
                {choice.label || choice.value}
              </div>
            ))}
            {!choices.length && (
              <div className="suggestions-empty">没有匹配项，可继续输入新名称</div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

// Ant Design Form controls value/onChange; filtering occurs before it receives a value.
export function LimitedField({
  value,
  onChange,
  accept,
  acceptSuggestion,
  ...props
}: Omit<
  React.ComponentProps<typeof TemplateLimitedInput>,
  'value' | 'onValueChange' | 'onSuggestionSelect' | 'accept'
> & {
  value?: string | number | null;
  onChange?: (value: string) => void;
  accept: (value: string, previous: string) => string;
  acceptSuggestion?: (suggestion: InputSuggestion, previous: string) => string;
}) {
  const update = (raw: string, suggestion?: InputSuggestion) => {
    const previous = String(value ?? '');
    const accepted = suggestion
      ? (acceptSuggestion?.(suggestion, previous) ?? accept(raw, previous))
      : accept(raw, previous);
    onChange?.(accepted);
    return accepted;
  };
  return (
    <TemplateLimitedInput
      {...props}
      value={String(value ?? '')}
      onValueChange={(raw) => update(raw)}
      onSuggestionSelect={(suggestion) => update(suggestion.value, suggestion)}
    />
  );
}
