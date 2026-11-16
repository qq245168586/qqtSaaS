import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  message,
} from 'antd';
import { z } from 'zod';
import { api, errorText } from './api';
const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  progress: z.number(),
  recurrence: z.enum(['once', 'monthly']),
  cycle_month: z.string().nullable(),
  reminder: z.boolean(),
  version: z.number(),
  overdue: z.boolean(),
});
type Todo = z.infer<typeof todoSchema>;
const listSchema = z.object({
  items: z.array(todoSchema),
  total: z.number(),
  server_now: z.string(),
});
const reminderSchema = z.object({
  overdue_count: z.number().int().nonnegative(),
  server_now: z.string(),
});
const changed = () => window.dispatchEvent(new Event('todos-changed'));
export function useTodoReminders(enabled: boolean) {
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await api('GET', '/todos/reminders', reminderSchema);
      setCount(r.overdue_count);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    const trigger = () => void refresh();
    window.addEventListener('focus', trigger);
    window.addEventListener('todos-changed', trigger);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', trigger);
      window.removeEventListener('todos-changed', trigger);
    };
  }, [enabled, refresh]);
  return { count, error };
}
export interface TodoForm {
  title: string;
  note: string;
  starts_at: string;
  ends_at: string;
  progress: number;
  recurrence: 'once' | 'monthly';
}
function chinaMinute() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16);
}
export function Todos({ canManage, reminderError }: { canManage: boolean; reminderError: string }) {
  const [items, setItems] = useState<Todo[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1);
  const [status, setStatus] = useState('open'),
    [keyword, setKeyword] = useState('');
  const [recurrence, setRecurrence] = useState('all');
  const [historyItem, setHistoryItem] = useState<Todo | null>(null);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [editing, setEditing] = useState<Todo | 'new' | null>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const seq = ++request.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({
        page: String(page),
        page_size: '20',
        status,
        keyword,
        recurrence,
      });
      const r = await api('GET', `/todos?${q}`, listSchema);
      if (seq !== request.current) return;
      if (page > 1 && !r.items.length) {
        setPage((p) => p - 1);
        return;
      }
      setItems(r.items);
      setTotal(r.total);
      setError('');
    } catch (e) {
      if (seq === request.current) setError(errorText(e));
    } finally {
      if (seq === request.current) setLoading(false);
    }
  }, [page, status, keyword, recurrence]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    const focus = () => void load();
    window.addEventListener('focus', focus);
    window.addEventListener('todos-changed', focus);
    return () => {
      ++request.current;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      window.removeEventListener('todos-changed', focus);
    };
  }, [load]);
  function open(value: Todo | 'new') {
    setEditing(value);
  }
  async function setComplete(item: Todo, checked: boolean) {
    setBusy(true);
    try {
      await api('PUT', `/todos/${item.id}`, todoSchema, {
        title: item.title,
        note: item.note,
        starts_at: item.starts_at,
        ends_at: item.ends_at,
        progress: checked ? 100 : 0,
        recurrence: item.recurrence,
        version: item.version,
      });
      changed();
      await load();
    } catch (e) {
      void message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function restart(item: Todo) {
    setBusy(true);
    try {
      await api('POST', `/todos/${item.id}/restart`, todoSchema, { version: item.version });
      changed();
      void message.success('已重新开始，截止时间已按原时长顺延');
      await load();
    } catch (e) {
      void message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const [deleting, setDeleting] = useState<Todo | null>(null);
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api('DELETE', `/todos/${deleting.id}`, z.null(), { version: deleting.version });
      setDeleting(null);
      changed();
      await load();
    } catch (e) {
      void message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="todo-workspace">
      <div className="page-heading">
        <div>
          <h1>待办事项</h1>
          <p>记录日常事项，按截止时间跟进完成情况</p>
        </div>
        {canManage && (
          <Button type="primary" onClick={() => open('new')}>
            新增待办
          </Button>
        )}
      </div>
      <Space wrap className="filters">
        <Select
          aria-label="待办状态"
          value={status}
          style={{ width: 150 }}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: 'open', label: '未完成' },
            { value: 'overdue', label: '已逾期' },
            { value: 'done', label: '已完成' },
            { value: 'all', label: '全部事项' },
          ]}
        />
        <Select
          aria-label="待办类型"
          value={recurrence}
          style={{ width: 130 }}
          onChange={(v) => {
            setRecurrence(v);
            setPage(1);
          }}
          options={[
            { value: 'all', label: '全部类型' },
            { value: 'once', label: '一次性任务' },
            { value: 'monthly', label: '月度任务' },
          ]}
        />
        <Input.Search
          placeholder="搜索待办事项"
          allowClear
          onSearch={(v) => {
            setKeyword(v);
            setPage(1);
          }}
        />
        <Button
          onClick={() => {
            changed();
            void load();
          }}
        >
          刷新
        </Button>
        <span className="secondary">共 {total} 项 · 时间为北京时间</span>
      </Space>
      {(error || reminderError) && (
        <Alert type="error" showIcon message={error || `待办提醒更新失败：${reminderError}`} />
      )}
      <Table<Todo>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={items}
        rowClassName={(r) => (r.progress === 100 ? 'todo-completed' : '')}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          onChange: setPage,
          showSizeChanger: false,
        }}
        tableLayout="fixed"
        columns={[
          {
            title: '事项',
            dataIndex: 'title',
            render: (_, r) => (
              <div className="todo-title">
                <Badge dot={r.reminder} title={r.overdue ? '已到期，尚未完成' : '本月待完成'}>
                  <strong>{r.title}</strong>
                </Badge>
                {r.overdue && <span className="todo-overdue">已逾期</span>}
                {r.note && <div className="secondary todo-note">{r.note}</div>}
              </div>
            ),
          },
          {
            title: '类型',
            width: 85,
            render: (_, r) => (
              <span>
                {r.recurrence === 'monthly' ? '月度任务' : '一次性'}
                {r.cycle_month && <small className="todo-month">{r.cycle_month}</small>}
              </span>
            ),
          },
          {
            title: '起止时间',
            width: 156,
            render: (_, r) => (
              <div className="todo-times">
                <span>起 {r.starts_at}</span>
                <span>止 {r.ends_at}</span>
              </div>
            ),
          },
          {
            title: '状态',
            width: 110,
            render: (_, r) => (
              <Checkbox
                checked={r.progress === 100}
                disabled={!canManage || busy}
                aria-label={`完成待办：${r.title}`}
                onChange={(e) => void setComplete(r, e.target.checked)}
              >
                {r.progress === 100 ? '已完成' : '未完成'}
              </Checkbox>
            ),
          },
          ...(canManage
            ? [
                {
                  title: '操作',
                  width: 205,
                  render: (_: unknown, r: Todo) => (
                    <Space size={0} wrap>
                      <Button type="link" disabled={busy} onClick={() => open(r)}>
                        编辑
                      </Button>
                      {r.progress === 100 && (
                        <Button type="link" disabled={busy} onClick={() => void restart(r)}>
                          重新开始
                        </Button>
                      )}
                      <Button type="link" onClick={() => setHistoryItem(r)}>
                        历史
                      </Button>
                      <Button type="link" danger disabled={busy} onClick={() => setDeleting(r)}>
                        删除
                      </Button>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      {editing && (
        <TodoEditor
          key={editing === 'new' ? 'new' : editing.id}
          initial={
            editing === 'new'
              ? {
                  title: '',
                  note: '',
                  starts_at: chinaMinute(),
                  ends_at: '',
                  progress: 0,
                  recurrence: 'once',
                }
              : editing
          }
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {historyItem && <TodoHistory item={historyItem} onClose={() => setHistoryItem(null)} />}
      <Modal
        title="删除待办事项"
        open={!!deleting}
        onCancel={() => {
          if (!busy) setDeleting(null);
        }}
        onOk={() => void remove()}
        confirmLoading={busy}
        okButtonProps={{ danger: true }}
        cancelButtonProps={{ disabled: busy }}
      >
        <p>确定删除“{deleting?.title}”？</p>
      </Modal>
    </section>
  );
}

export function TodoEditor({
  initial,
  onCancel,
  onSaved,
}: {
  initial: {
    title: string;
    note: string;
    starts_at: string | null;
    ends_at: string | null;
    progress: number;
    recurrence?: 'once' | 'monthly';
    id?: string;
    version?: number;
  };
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<TodoForm>();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const starting = useRef(initial).current;
  useEffect(() => {
    form.setFieldsValue({
      ...starting,
      recurrence: starting.recurrence ?? 'once',
      progress: starting.id && starting.progress === 100 ? 100 : 0,
      starts_at: (starting.starts_at || (starting.id ? '' : chinaMinute())).replace(' ', 'T'),
      ends_at: (starting.ends_at ?? '').replace(' ', 'T'),
    });
  }, [form, starting]);
  async function save(value: TodoForm) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const body = {
        ...value,
        note: value.note ?? '',
        starts_at: value.starts_at.replace('T', ' '),
        ends_at: value.ends_at.replace('T', ' '),
      };
      await api(
        initial.id ? 'PUT' : 'POST',
        initial.id ? `/todos/${initial.id}` : '/todos',
        todoSchema,
        initial.id ? { ...body, version: initial.version } : body,
      );
      changed();
      void message.success('已保存');
      onSaved();
    } catch (e) {
      void message.error(errorText(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={initial.id ? '编辑待办' : '新增待办'}
      onCancel={() => {
        if (!busy) onCancel();
      }}
      onOk={() => form.submit()}
      confirmLoading={busy}
      cancelButtonProps={{ disabled: busy }}
    >
      <Form form={form} layout="vertical" onFinish={save} disabled={busy}>
        <Form.Item
          name="title"
          label="事项"
          rules={[{ required: true, whitespace: true, message: '请填写待办事项' }, { max: 200 }]}
        >
          <Input maxLength={200} placeholder="例如：确认下周原料采购" />
        </Form.Item>
        <Form.Item name="recurrence" label="任务类型" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'once', label: '一次性任务' },
              { value: 'monthly', label: '月度任务' },
            ]}
          />
        </Form.Item>
        <div className="todo-dates">
          <Form.Item
            name="starts_at"
            label="开始时间"
            rules={[{ required: true, message: '请选择开始时间' }]}
          >
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item
            name="ends_at"
            label="截止时间"
            dependencies={['starts_at']}
            rules={[
              { required: true, message: '请选择截止时间' },
              ({ getFieldValue }) => ({
                validator: (_, v: string) =>
                  !v || !getFieldValue('starts_at') || v >= String(getFieldValue('starts_at'))
                    ? Promise.resolve()
                    : Promise.reject(new Error('截止时间不能早于开始时间')),
              }),
            ]}
          >
            <Input type="datetime-local" />
          </Form.Item>
        </div>
        <Form.Item name="progress" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="note" label="备注">
          <Input.TextArea rows={3} maxLength={2000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

const historySchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      reason: z.enum(['monthly', 'restart']),
      archived_at: z.string(),
      snapshot: z.object({
        title: z.string(),
        note: z.string(),
        starts_at: z.string(),
        ends_at: z.string(),
        progress: z.number(),
        completed_at: z.string().nullable().optional(),
      }),
    }),
  ),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});
function TodoHistory({ item, onClose }: { item: Todo; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<z.infer<typeof historySchema>>({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void api('GET', `/todos/${item.id}/history?page=${page}`, historySchema)
      .then((r) => {
        if (active) {
          setResult(r);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [item.id, page]);
  return (
    <Modal open title={`${item.title} · 历史记录`} width={760} footer={null} onCancel={onClose}>
      {error && <Alert type="error" message={error} />}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={result.items}
        pagination={{
          current: page,
          total: result.total,
          pageSize: 20,
          onChange: setPage,
          showSizeChanger: false,
        }}
        columns={[
          {
            title: '周期',
            render: (_, r) => (
              <div>
                {r.snapshot.starts_at.slice(0, 16)}
                <br />
                {r.snapshot.ends_at.slice(0, 16)}
              </div>
            ),
          },
          { title: '状态', render: (_, r) => (r.snapshot.progress === 100 ? '已完成' : '未完成') },
          {
            title: '归档原因',
            render: (_, r) => (r.reason === 'monthly' ? '进入新月份' : '手动重新开始'),
          },
          { title: '完成时间', render: (_, r) => r.snapshot.completed_at?.slice(0, 16) || '—' },
        ]}
        expandable={{ expandedRowRender: (r) => <p>{r.snapshot.note || '无备注'}</p> }}
      />
    </Modal>
  );
}
