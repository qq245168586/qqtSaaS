import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, message } from 'antd';
import { z } from 'zod';
import { api, errorText, isOffline } from './api';
import {
  scheduleRowSchema,
  scheduleSnapshotSchema,
  type ScheduleSnapshot,
} from './schedules-model';
import type { ScheduleDraft } from './assistant-model';
interface Values {
  employee_id: string;
  work_date: string;
  shift_kind: 'work' | 'rest' | 'comp_leave';
  start_time: string;
  ot_hours: number;
  off_hours: number;
  note: string;
}
export function ScheduleEditor({
  initial,
  fixedIdentity = false,
  onCancel,
  onSaved,
}: {
  initial: ScheduleDraft;
  fixedIdentity?: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<Values>();
  const date = Form.useWatch('work_date', form) ?? initial.work_date ?? '';
  const employeeId = Form.useWatch('employee_id', form) ?? initial.employee_id;
  const kind = Form.useWatch('shift_kind', form) ?? initial.shift_kind;
  const start = Form.useWatch('start_time', form) ?? initial.start_time;
  const [snapshot, setSnapshot] = useState<ScheduleSnapshot | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const month = /^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(date)
    ? date.slice(0, 7)
    : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSnapshot(null);
    setError('');
    void api('GET', `/employee-schedules?month=${month}`, scheduleSnapshotSchema)
      .then((data) => {
        if (active) setSnapshot(data);
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
  }, [month, revision]);
  const employee = snapshot?.employees.find((e) => e.id === employeeId);
  const row = snapshot?.items.find((r) => r.employee_id === employeeId && r.work_date === date);
  const departed =
    !!employee && (employee.left_on ? date >= employee.left_on : employee.status === 'left');
  const disabled = departed || busy || loading || !snapshot || snapshot.month !== month || !!error;
  const end =
    start && /^([01]\d|2[0-3]):[0-5]\d$/.test(start)
      ? (() => {
          const [h, m] = start.split(':').map(Number);
          const total = h * 60 + m + 540;
          return `${total >= 1440 ? '次日 ' : ''}${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
        })()
      : '—';
  async function save() {
    if (lock.current || disabled || isOffline()) return;
    lock.current = true;
    setBusy(true);
    try {
      const v = await form.validateFields();
      if (!employee || !snapshot) throw new Error('请选择有效员工并加载最新排班');
      await api('PUT', `/employee-schedules/${v.employee_id}/${v.work_date}`, scheduleRowSchema, {
        shift_kind: v.shift_kind,
        start_time: v.shift_kind === 'work' ? v.start_time : null,
        overtime_minutes: v.shift_kind === 'comp_leave' ? 0 : Math.round(v.ot_hours * 60),
        timeoff_minutes: v.shift_kind === 'rest' ? 0 : Math.round(v.off_hours * 60),
        note: v.note ?? '',
        version: row?.version ?? 0,
      });
      void message.success('排班已保存');
      onSaved();
    } catch (e) {
      if (!(e && typeof e === 'object' && 'errorFields' in e)) {
        void message.error(errorText(e));
        setRevision((n) => n + 1);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function clear() {
    if (!row || lock.current || busy || loading || !snapshot || !!error || isOffline()) return;
    lock.current = true;
    setBusy(true);
    try {
      await api('DELETE', `/employee-schedules/${employeeId}/${date}`, z.null(), {
        version: row.version,
      });
      void message.success('已清除排班');
      onSaved();
    } catch (e) {
      void message.error(errorText(e));
      setRevision((n) => n + 1);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={fixedIdentity ? `${initial.employee_name} · ${date}` : '核对员工排班'}
      width={620}
      maskClosable={false}
      closable={!busy}
      onCancel={() => !busy && onCancel()}
      footer={
        <Space>
          {fixedIdentity && row && !row.deleted_at && (
            <Button danger disabled={busy || loading || isOffline()} onClick={() => void clear()}>
              清除排班
            </Button>
          )}
          <Button disabled={busy} onClick={onCancel}>
            {fixedIdentity ? '关闭' : '取消'}
          </Button>
          <Button
            type="primary"
            loading={busy}
            disabled={disabled || isOffline()}
            onClick={() => void save()}
          >
            {fixedIdentity ? '保存排班' : row && !row.deleted_at ? '确认修改排班' : '确认创建排班'}
          </Button>
        </Space>
      }
    >
      {error && (
        <Alert
          type="error"
          message={error}
          action={<Button onClick={() => setRevision((n) => n + 1)}>重试</Button>}
        />
      )}
      {departed && (
        <Alert type="warning" message="该员工在所选日期已离职，不能用于此日期的新排班。" />
      )}
      {!fixedIdentity && row && !row.deleted_at && (
        <Alert
          type="warning"
          message={`该员工当天已有排班：${row.shift_kind === 'work' ? row.start_time + '–' + row.standard_end : row.shift_kind === 'rest' ? '例休' : '调休'}；确认后会修改原排班，不会新增第二条。`}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          employee_id: initial.employee_id ?? undefined,
          work_date: initial.work_date ?? '',
          shift_kind: initial.shift_kind,
          start_time: initial.start_time ?? '08:00',
          ot_hours: initial.overtime_minutes / 60,
          off_hours: initial.timeoff_minutes / 60,
          note: initial.note,
        }}
      >
        <div className="assistant-form-grid">
          <Form.Item
            name="employee_id"
            label="员工"
            rules={[{ required: true, message: '请选择员工' }]}
          >
            <Select
              disabled={fixedIdentity || busy || loading}
              showSearch
              optionFilterProp="label"
              placeholder="选择现有员工"
              options={(snapshot?.employees ?? [])
                .filter((e) => (e.left_on ? !date || date < e.left_on : e.status !== 'left'))
                .map((e) => ({
                  value: e.id,
                  label: `${e.name} · ${e.department_name ?? '未设置部门'}`,
                }))}
            />
          </Form.Item>
          <Form.Item
            name="work_date"
            label="排班日期"
            rules={[{ required: true, message: '请填写排班日期' }]}
          >
            <Input type="date" disabled={fixedIdentity || busy} min="2000-01-01" max="2099-12-31" />
          </Form.Item>
        </div>
        <Form.Item name="shift_kind" label="班次" rules={[{ required: true }]}>
          <Select
            disabled={disabled}
            options={[
              { value: 'work', label: '工作' },
              { value: 'rest', label: '例休（1天，扣例休天数）' },
              { value: 'comp_leave', label: '调休（扣小时余额）' },
            ]}
            onChange={(v) =>
              form.setFieldsValue({ ot_hours: 0, off_hours: v === 'comp_leave' ? 8 : 0 })
            }
          />
        </Form.Item>
        {kind === 'work' && (
          <>
            <Form.Item name="start_time" label="开始时间" rules={[{ required: true }]}>
              <Input type="time" step={60} disabled={disabled} />
            </Form.Item>
            <p>正常结束：{end}，含1小时休息；加班、调休另行登记。</p>
          </>
        )}
        {kind === 'rest' && (
          <p>整天例休单独扣减1天，不折算为调休小时；此日登记加班后不算整天已休。</p>
        )}
        <div className="assistant-form-grid">
          <Form.Item name="ot_hours" label="加班（小时）" rules={[{ required: true }]}>
            <InputNumber
              min={0}
              max={16}
              step={1 / 60}
              disabled={disabled || kind === 'comp_leave'}
            />
          </Form.Item>
          <Form.Item name="off_hours" label="调休（小时）" rules={[{ required: true }]}>
            <InputNumber min={0} max={8} step={1 / 60} disabled={disabled || kind === 'rest'} />
          </Form.Item>
        </div>
        <Form.Item name="note" label="备注">
          <Input.TextArea maxLength={500} disabled={disabled} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
