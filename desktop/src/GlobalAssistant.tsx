import { VoiceInput } from './voice/VoiceInput';
import { assistantFailure, type AssistantFailure } from './assistant-errors';
import { TodoEditor } from './Todos';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Drawer, Empty, Input, Select, Space, Tag, message } from 'antd';
import { api, isOffline } from './api';
import { dispatch, getState, useAppState } from './store';
import {
  assistantDrafts,
  assistantLabels,
  assistantModules,
  assistantResponseSchema,
  assistantSummary,
  type AssistantDraft,
  type AssistantModule,
} from './assistant-model';
import { TaskForm } from './Tasks';
import { DeliveryForm } from './Deliveries';
import { ScheduleEditor } from './ScheduleEditor';
export function GlobalAssistant({
  onCreated,
}: {
  onCreated: (module: 'retail' | 'delivery' | 'schedule' | 'todo') => void;
}) {
  const { assistant } = useAppState();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<AssistantFailure | null>(null),
    [editing, setEditing] = useState<string | null>(null);
  const lock = useRef(false);
  const update = (patch: Partial<typeof assistant>) =>
    dispatch({ type: 'assistant', value: { ...getState().assistant, ...patch } });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  async function parse() {
    if (lock.current || !assistant.text.trim() || isOffline()) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const { text, module } = getState().assistant;
    try {
      const response = await api('POST', '/ai/assistant/parse', assistantResponseSchema, {
        text,
        module,
        supported_modules: assistantModules.filter((value) => value !== 'auto'),
      });
      update({
        drafts: [
          ...getState().assistant.drafts,
          ...assistantDrafts(response, () => crypto.randomUUID()),
        ],
        clarification: response.clarification,
      });
      if (response.items.length) {
        update({ text: '' });
        void message.success(`已识别${response.items.length}项，打开填写页核对后创建`);
      }
    } catch (e) {
      setError(assistantFailure(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const current = assistant.drafts.find((d) => d.key === editing && !d.saved);
  const patchDraft = (key: string, value: AssistantDraft) =>
    update({ drafts: getState().assistant.drafts.map((d) => (d.key === key ? value : d)) });
  const saved = (draft: AssistantDraft) => {
    patchDraft(draft.key, { ...draft, saved: true });
    setEditing(null);
    onCreated(draft.module);
  };
  return (
    <>
      <Button
        className="global-ai-trigger"
        onClick={() => setOpen(true)}
        title="全局 AI 助手（Ctrl / ⌘ + K）"
      >
        <span aria-hidden="true">✦</span> AI 助手
      </Button>
      {!current && (
        <Drawer
          open={open}
          width={820}
          title={
            <div className="assistant-title">
              <span>✦</span>
              <div>
                <strong>AI 工作助手</strong>
                <small>零售订单 · 送货单 · 员工排班 · 待办事项</small>
              </div>
            </div>
          }
          onClose={() => !current && setOpen(false)}
          maskClosable={!current}
          keyboard={!current}
          className="global-assistant"
          extra={<span className="secondary">Ctrl / ⌘ + K</span>}
        >
          <div className="assistant-compose">
            <div className="assistant-compose-heading">
              <strong>把需要录入的内容告诉我</strong>
              <Select
                aria-label="AI识别模块"
                disabled={busy}
                value={assistant.module}
                options={assistantModules.map((value) => ({
                  value,
                  label: assistantLabels[value],
                }))}
                onChange={(module: AssistantModule) => update({ module })}
              />
            </div>
            {open && (
              <VoiceInput
                disabled={busy}
                onText={(text) =>
                  update({ text: [getState().assistant.text, text].filter(Boolean).join('\n') })
                }
              />
            )}
            <Input.TextArea
              aria-label="全局AI输入"
              value={assistant.text}
              disabled={busy}
              maxLength={30000}
              autoSize={{ minRows: 5, maxRows: 12 }}
              placeholder="例如：明天下午3点送一个6寸抹茶巴斯克蛋糕，送到南山区某某大厦一楼，收货人王女士。备注：少糖，附生日蜡烛，提前半小时联系。"
              onChange={(event) => update({ text: event.target.value })}
            />
            <div className="assistant-compose-footer">
              <span>识别只预填内容，核对后由你创建。</span>
              <Button
                type="primary"
                loading={busy}
                disabled={!assistant.text.trim() || isOffline()}
                onClick={() => void parse()}
              >
                识别并预填
              </Button>
            </div>
          </div>
          {error && (
            <Alert
              type="error"
              showIcon
              message={error.title}
              description={
                <>
                  <div>{error.message}</div>
                  <div>原文已保留，本次识别未创建任何记录。</div>
                  <small className="secondary">
                    错误码：{error.code}
                    {error.stage ? ` · ${error.stage}` : ''}
                    {error.reference ? ` · 排查编号：${error.reference}` : ''}
                  </small>
                </>
              }
            />
          )}
          {assistant.clarification && (
            <Alert
              type="info"
              showIcon
              message={assistant.clarification}
              style={{ marginTop: 12 }}
            />
          )}
          <div className="assistant-results-heading">
            <h3>
              待核对内容 <small>{assistant.drafts.filter((d) => !d.saved).length} 项</small>
            </h3>
            <span className="secondary">不会自动创建或打印</span>
          </div>
          {!assistant.drafts.length && <Empty description="识别结果会显示在这里" />}
          <div className="assistant-results">
            {assistant.drafts.map((draft) => {
              const summary = assistantSummary(draft);
              return (
                <Card
                  key={draft.key}
                  size="small"
                  className={draft.saved ? 'assistant-result saved' : 'assistant-result'}
                >
                  <div className="assistant-result-heading">
                    <Tag
                      color={
                        draft.saved
                          ? 'green'
                          : draft.module === 'retail'
                            ? 'blue'
                            : draft.module === 'delivery'
                              ? 'cyan'
                              : 'purple'
                      }
                    >
                      {draft.saved ? '已创建' : assistantLabels[draft.module]}
                    </Tag>
                    <strong>{summary.title}</strong>
                  </div>
                  <p className="assistant-result-date">{summary.date}</p>
                  <p className="assistant-result-details">{summary.details}</p>
                  {!draft.saved && draft.module === 'retail' && 'id' in draft.value && (
                    <Alert
                      type="info"
                      message="任务已创建，仍有附件待处理；继续保存只会更新这张任务，不会重复创建。"
                    />
                  )}
                  {!draft.saved && !!draft.warnings.length && (
                    <ul className="assistant-warnings">
                      {draft.warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  <details>
                    <summary>查看原文</summary>
                    <p className="assistant-source">{draft.source_text}</p>
                  </details>
                  <Space style={{ marginTop: 12 }}>
                    {!draft.saved && (
                      <Button type="primary" onClick={() => setEditing(draft.key)}>
                        {draft.module === 'retail' && 'id' in draft.value
                          ? '继续处理任务附件'
                          : `打开${assistantLabels[draft.module]}填写页`}
                      </Button>
                    )}
                    <Button
                      type="text"
                      disabled={busy}
                      onClick={() =>
                        update({
                          drafts: getState().assistant.drafts.filter((d) => d.key !== draft.key),
                        })
                      }
                    >
                      {draft.saved ? '移除卡片' : '丢弃草稿'}
                    </Button>
                  </Space>
                </Card>
              );
            })}
          </div>
        </Drawer>
      )}
      {current?.module === 'retail' && (
        <TaskForm
          key={current.key}
          initial={current.value}
          requireExpectedDelivery
          onCancel={() => setEditing(null)}
          onPersisted={(task) => patchDraft(current.key, { ...current, value: task })}
          onSaved={() => {
            const latest = getState().assistant.drafts.find((d) => d.key === current.key);
            if (latest) saved(latest);
          }}
        />
      )}
      {current?.module === 'delivery' && (
        <DeliveryForm
          key={current.key}
          initial={current.value}
          onClose={() => setEditing(null)}
          onSaved={() => saved(current)}
        />
      )}
      {current?.module === 'todo' && (
        <TodoEditor
          key={current.key}
          initial={current.value}
          onCancel={() => setEditing(null)}
          onSaved={() => saved(current)}
        />
      )}
      {current?.module === 'schedule' && (
        <ScheduleEditor
          key={current.key}
          initial={current.value}
          onCancel={() => setEditing(null)}
          onSaved={() => saved(current)}
        />
      )}
    </>
  );
}
