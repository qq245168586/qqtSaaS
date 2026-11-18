import { useRef, useState } from 'react';
import { VoiceInput } from './VoiceInput';
import { prepareDocument, type DocumentDraft } from './services';
export function VoiceDocument({ onInsert }: { onInsert: (draft: DocumentDraft) => void }) {
  const panel = useRef<HTMLDetailsElement>(null);
  const [expanded, setExpanded] = useState(false);
  const insert = (draft: DocumentDraft) => {
    onInsert(draft);
    if (panel.current) panel.current.open = false;
  };
  const [text, setText] = useState('');
  const [style, setStyle] = useState<'memo' | 'document'>('memo');
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function generate() {
    if (lock.current || !text.trim()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      setDraft(await prepareDocument(text, style));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '整理失败，请重试');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <details
      ref={panel}
      className="voice-document"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>语音／口述整理为文档</summary>
      {expanded && (
        <VoiceInput
          disabled={busy}
          onText={(value) => {
            setText((current) => [current, value].filter(Boolean).join('\n'));
            setDraft(null);
          }}
        />
      )}
      <textarea
        aria-label="文档口述原文"
        placeholder="录音、导入语音备忘录，或粘贴口述文字。确认后加入正文，不会自动保存。"
        value={text}
        disabled={busy}
        maxLength={30000}
        onChange={(event) => {
          setText(event.target.value);
          setDraft(null);
        }}
      />
      <div className="voice-controls">
        <select
          aria-label="文档整理方式"
          value={style}
          disabled={busy}
          onChange={(event) => {
            setStyle(event.target.value as 'memo' | 'document');
            setDraft(null);
          }}
        >
          <option value="memo">备忘录</option>
          <option value="document">正式文档</option>
        </select>
        <button type="button" disabled={busy || !text.trim()} onClick={() => void generate()}>
          {busy ? '正在整理…' : '整理为草稿'}
        </button>
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => {
            insert({ title: '语音备忘录', sections: [{ heading: '', text }] });
            setText('');
            setDraft(null);
          }}
        >
          原文加入正文
        </button>
      </div>
      {error && (
        <p role="alert" className="voice-error">
          {error}
        </p>
      )}
      {draft && (
        <>
          <div className="voice-document-preview">
            <strong>{draft.title}</strong>
            {draft.sections.map((section, index) => (
              <div key={index}>
                <h4>{section.heading}</h4>
                <p>{section.text}</p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              insert(draft);
              setDraft(null);
              setText('');
            }}
          >
            确认加入正文，继续编辑
          </button>
        </>
      )}
    </details>
  );
}
