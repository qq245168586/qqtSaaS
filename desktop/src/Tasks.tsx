import { retailFlavor } from './retail-flavor';
import { RetailColumnFilter, readRetailFilters, type RetailFilterRule } from './RetailColumnFilter';
import { OrderChannelField } from './OrderChannelField';
import { CachedTaskImage } from './CachedTaskImage';
import { CompanyField } from './CompanySelect';
import { matchingBusinessEmployees, employeeAvailableOn } from './assignment';
import { dispatch, getState, useAppState } from './store';
import { useEffect, useRef, useState, type ClipboardEvent, type Key } from 'react';
import {
  Alert,
  Button,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Card,
  Statistic,
  Select,
  Space,
  Table,
  Tag,
  Upload,
  message,
} from 'antd';
import { z } from 'zod';
import { RightOutlined } from '@ant-design/icons';
import { allResources, api, download, errorText } from './api';
import {
  companyMatchSchema,
  deliveryLinkSchema,
  emptyTask,
  imageSchema,
  nextStates,
  pageSchema,
  states,
  taskSchema,
  type Resource,
  type Task,
  type TaskImage,
  type TaskInput,
} from './contracts';
const options = (items: Resource[]) => items.map((x) => ({ label: x.name, value: x.id }));
function InlineDeliveryFee({
  task,
  editable,
  onSaved,
}: {
  task: Task;
  editable: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [savedValue, setSavedValue] = useState(String(task.delivery_fee ?? '0'));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const canceledRef = useRef(false);
  useEffect(() => setSavedValue(String(task.delivery_fee ?? '0')), [task.delivery_fee]);
  const save = async () => {
    if (savingRef.current || canceledRef.current) return;
    const next = value.trim() || '0';
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(next)) {
      void message.error('运费须为非负金额，最多两位小数');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await api('PATCH', `/tasks/${task.id}/delivery-fee`, taskSchema, {
        delivery_fee: next,
      });
      setSavedValue(String(updated.delivery_fee ?? '0'));
      setEditing(false);
      onSaved();
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <div className="task-inline-fee">
      <span>运费：</span>
      {editing ? (
        <Input
          autoFocus
          size="small"
          prefix="¥"
          variant="borderless"
          className="task-fee-input"
          value={value}
          disabled={saving}
          aria-label={`${task.title}运费`}
          inputMode="decimal"
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void save()}
          onPressEnter={() => void save()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              canceledRef.current = true;
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="task-fee-value"
          disabled={!editable}
          aria-label={`${task.title}运费，${Number(savedValue) ? savedValue + '元' : '未填写'}，点击修改`}
          title={editable ? '点击修改运费' : '运费'}
          onClick={() => {
            canceledRef.current = false;
            setValue(Number(savedValue) ? savedValue : '');
            setEditing(true);
          }}
        >
          {Number(savedValue) ? `¥${Number(savedValue).toFixed(2)}` : '\u00a0'}
        </button>
      )}
    </div>
  );
}
function productLabel(task: Pick<Task, 'product_summary' | 'content'>): string {
  const explicit = task.product_summary?.trim();
  if (explicit) return explicit;
  return task.content?.match(/(?:商品|产品|品名)\s*[:：]\s*([^\n；;]+)/u)?.[1]?.trim() ?? '';
}
export function TaskForm({
  initial,
  onSaved,
  onCancel,
  onPersisted,
  onDraft,
  requireExpectedDelivery = false,
}: {
  onPersisted?: (task: Task) => void;
  onDraft?: (task: TaskInput) => void;
  initial: Task | TaskInput;
  onSaved: () => void;
  onCancel: () => void;
  requireExpectedDelivery?: boolean;
}) {
  const [form] = Form.useForm<TaskInput>();
  const publicAccess = useAppState().session?.user.public_access;
  const [catalog, setCatalog] = useState<Record<string, Resource[]>>({});
  const [images, setImages] = useState<TaskImage[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [companyMatch, setCompanyMatch] = useState(initial.company_match);
  const companyChosen = useRef(!!initial.company_code);
  const assigneeChosen = useRef('id' in initial || !!initial.assignee_employee_id);
  const titleText = Form.useWatch('title', form);
  const productText = Form.useWatch('product_summary', form);
  const contentText = Form.useWatch('content', form);
  useEffect(() => {
    if (companyChosen.current || 'id' in initial || !(titleText || productText || contentText))
      return;
    const timer = window.setTimeout(() => void suggestCompany(true), 700);
    return () => window.clearTimeout(timer);
  }, [titleText, productText, contentText]);
  const [suggesting, setSuggesting] = useState(false);
  async function suggestCompany(automatic = false) {
    const values = form.getFieldsValue();
    const text = [values.title, values.product_summary, values.content, values.source_text]
      .filter(Boolean)
      .join(' ');
    if (!text.trim()) return;
    setSuggesting(true);
    try {
      const result = await api(
        'POST',
        '/company-suggestions',
        z.object({ company_code: z.enum(['tri', 'tmy']), company_match: companyMatchSchema }),
        { text },
      );
      if (
        automatic &&
        (companyChosen.current ||
          form.getFieldValue('title') !== values.title ||
          form.getFieldValue('product_summary') !== values.product_summary ||
          form.getFieldValue('content') !== values.content)
      )
        return;
      setCompanyMatch(result.company_match);
      if (result.company_code !== form.getFieldValue('company_code')) {
        form.setFieldsValue({
          company_code: result.company_code,
          category_id: null,
        });
      }
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setSuggesting(false);
    }
  }
  const expectedDate = Form.useWatch('expected_delivery_at', form);
  const documentDate = (
    expectedDate ||
    ('id' in initial ? initial.created_at : null) ||
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  ).slice(0, 10);
  const department = Form.useWatch('department_id', form);
  const company = Form.useWatch('company_code', form) ?? initial.company_code ?? 'tmy';
  const processing = useRef(0);
  const savingLock = useRef(false);
  const [processingCount, setProcessingCount] = useState(0);
  const [previewFiles, setPreviewFiles] = useState<Array<{ file: File; url: string }>>([]);
  const [imageError, setImageError] = useState('');
  const [imageRevision, setImageRevision] = useState(0);
  const [savedStatus, setSavedStatus] = useState(initial.status);
  useEffect(() => {
    if (!('id' in initial)) return;
    const timer = window.setInterval(() => {
      if (!savingLock.current) setImageRevision((value) => value + 1);
    }, 240000);
    return () => window.clearInterval(timer);
  }, ['id' in initial ? initial.id : undefined]);
  useEffect(() => {
    const previews = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPreviewFiles(previews);
    return () => previews.forEach((item) => URL.revokeObjectURL(item.url));
  }, [files]);
  const companyCatalog = (key: string) =>
    key === 'departments'
      ? (catalog[key] ?? [])
      : (catalog[key] ?? []).filter((item) => !publicAccess || item.company_code === company);
  const assignmentEmployees = matchingBusinessEmployees(
    catalog.departments ?? [],
    catalog.employees ?? [],
    department,
    documentDate,
  );
  const orderTakerEmployees = (catalog.employees ?? []).filter((employee) =>
    employeeAvailableOn(employee, documentDate),
  );
  useEffect(() => {
    const selected = catalog.employees?.find(
      (e) => e.id === form.getFieldValue('assignee_employee_id'),
    );
    if (selected && !employeeAvailableOn(selected, documentDate)) {
      form.setFieldValue('assignee_employee_id', null);
      assigneeChosen.current = false;
    }
    const selectedOrderTaker = catalog.employees?.find(
      (e) => e.id === form.getFieldValue('order_taker_employee_id'),
    );
    if (selectedOrderTaker && !employeeAvailableOn(selectedOrderTaker, documentDate))
      form.setFieldValue('order_taker_employee_id', null);
  }, [documentDate, catalog.employees, form]);
  const [assigneeHint, setAssigneeHint] = useState('');
  useEffect(() => {
    if (
      !department ||
      assigneeChosen.current ||
      !(catalog.employees?.length && catalog.departments?.length)
    )
      return;
    const values = form.getFieldsValue();
    const text = [values.title, values.product_summary, values.content, values.source_text]
      .filter(Boolean)
      .join(' ');
    const expectedDepartment = department;
    const timer = window.setTimeout(() => {
      void api(
        'POST',
        '/assignee-suggestions',
        z.object({
          employee_id: z.string().nullable(),
          reason: z.string(),
          source: z.enum(['history', 'business', 'manual']),
          sample_count: z.number(),
        }),
        { department_id: expectedDepartment, text, document_date: documentDate },
      )
        .then((result) => {
          if (assigneeChosen.current || form.getFieldValue('department_id') !== expectedDepartment)
            return;
          setAssigneeHint(result.reason);
          if (
            result.employee_id &&
            matchingBusinessEmployees(
              catalog.departments ?? [],
              catalog.employees ?? [],
              expectedDepartment,
              documentDate,
            ).some((employee) => employee.id === result.employee_id)
          )
            form.setFieldValue('assignee_employee_id', result.employee_id);
        })
        .catch((error) => message.error(errorText(error)));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    department,
    company,
    documentDate,
    titleText,
    productText,
    contentText,
    catalog.employees,
    catalog.departments,
  ]);
  const historicalOptions = (
    items: Resource[],
    field: 'category_id' | 'department_id' | 'assignee_employee_id' | 'order_taker_employee_id',
    label: 'category_name' | 'department_name' | 'assignee_name' | 'order_taker_name',
  ) => {
    const list: Array<{ value: string; label: string; disabled?: boolean }> = options(items);
    const oldId = initial[field];
    if (
      'id' in initial &&
      oldId &&
      company === (initial.company_code ?? 'tmy') &&
      !list.some((item) => item.value === oldId)
    ) {
      list.push({
        value: oldId,
        label: `${initial[label] ?? '历史记录'}（历史关联）`,
        disabled: true,
      });
    }
    return list;
  };
  const [taskId, setTaskId] = useState('id' in initial ? initial.id : undefined);
  useEffect(() => {
    void Promise.all(
      ['departments', 'employees', 'categories'].map(
        async (key) => [key, await allResources(`/${key}`)] as const,
      ),
    )
      .then((entries) => setCatalog(Object.fromEntries(entries)))
      .catch((e) => message.error(errorText(e)));
    setImageError('');
    if (taskId)
      void api('GET', `/tasks/${taskId}/images?page_size=100`, pageSchema(imageSchema))
        .then((x) => setImages(x.items))
        .catch((e) => setImageError(errorText(e)));
  }, [taskId, imageRevision]);
  async function addFile(file: File) {
    if (savingLock.current) return;
    processing.current++;
    setProcessingCount(processing.current);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        void message.error('仅支持 PNG、JPG、WebP');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        void message.error('单张图片不能超过 10 MiB');
        return;
      }
      const bitmap = await createImageBitmap(file);
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (pixels > 24000000) {
        void message.error('图片不能超过 2400 万像素');
        return;
      }
      setFiles((current) => {
        if (current.length + images.length >= 12) {
          void message.error('每个任务最多 12 张图片');
          return current;
        }
        return [...current, file];
      });
    } finally {
      processing.current--;
      setProcessingCount(processing.current);
    }
  }
  function paste(event: ClipboardEvent) {
    const incoming = Array.from(event.clipboardData.items)
      .filter((x) => x.type.startsWith('image/'))
      .map((x) => x.getAsFile())
      .filter((x): x is File => !!x);
    if (incoming.length) {
      event.preventDefault();
      incoming.forEach((file) => void addFile(file).catch((e) => message.error(errorText(e))));
    }
  }
  async function save(draftOnly = false) {
    if (savingLock.current || processing.current) return;
    savingLock.current = true;
    setBusy(true);
    try {
      const value = await form.validateFields();
      const payload = {
        ...emptyTask(),
        ...value,
        expected_delivery_at: value.expected_delivery_at?.replace('T', ' ') || null,
      };
      if (draftOnly && onDraft) {
        if (files.length) {
          void message.warning('含新图片的任务请直接保存任务，以免丢失附件。');
          return;
        }
        onDraft({ ...payload, company_match: companyMatch });
        return;
      }
      const result = await api(
        taskId ? 'PUT' : 'POST',
        taskId ? `/tasks/${taskId}` : '/tasks',
        taskSchema,
        payload,
      );
      setTaskId(result.id);
      setSavedStatus(result.status);
      onPersisted?.(result);
      const failed: File[] = [];
      for (const file of files) {
        const data = new FormData();
        data.append('file', file);
        try {
          await api('POST', `/tasks/${result.id}/images`, z.unknown(), data);
        } catch {
          failed.push(file);
        }
      }
      setFiles(failed);
      if (failed.length) {
        void message.warning(
          `任务已保存，${failed.length} 张图片上传失败，保留在当前窗口，可再次保存重试`,
        );
        const current = await api(
          'GET',
          `/tasks/${result.id}/images?page_size=100`,
          pageSchema(imageSchema),
        );
        setImages(current.items);
      } else {
        void message.success('任务已保存');
        onSaved();
      }
    } catch (e) {
      void message.error(errorText(e));
    } finally {
      savingLock.current = false;
      setBusy(false);
    }
  }
  const cancel = () => {
    if (savingLock.current || processing.current) return;
    if (files.length)
      Modal.confirm({
        title: '关闭任务编辑？',
        content: '尚未保存的修改与新图片将被丢弃；已保存的任务和图片仍会保留。',
        onOk: onCancel,
      });
    else onCancel();
  };
  return (
    <Modal
      title={taskId ? '编辑任务' : '确认任务草稿'}
      open
      width={860}
      onCancel={cancel}
      closable={!busy && !processingCount}
      maskClosable={false}
      footer={
        <Space>
          <Button disabled={busy || !!processingCount} onClick={cancel}>
            取消
          </Button>
          {onDraft && !taskId && (
            <Button disabled={busy || !!processingCount} onClick={() => void save(true)}>
              保存草稿供批量确认
            </Button>
          )}
          <Button
            type="primary"
            loading={busy}
            disabled={!!processingCount}
            onClick={() => void save()}
          >
            保存任务
          </Button>
        </Space>
      }
    >
      <div onPaste={paste}>
        <Form
          form={form}
          layout="vertical"
          disabled={busy || !!processingCount}
          onValuesChange={(changed: Partial<TaskInput>) => {
            if ('company_code' in changed) {
              companyChosen.current = true;
              form.setFieldValue('category_id', null);
            }
            if ('department_id' in changed) {
              assigneeChosen.current = false;
              setAssigneeHint('');
              form.setFieldValue('assignee_employee_id', null);
            }
            if ('assignee_employee_id' in changed) assigneeChosen.current = true;
          }}
          initialValues={{
            ...initial,
            company_code: initial.company_code ?? 'tmy',
            expected_delivery_at: initial.expected_delivery_at?.slice(0, 16).replace(' ', 'T'),
          }}
        >
          {publicAccess && (
            <>
              <CompanyField />
              <Alert
                type="info"
                message={
                  companyMatch?.reason ??
                  '未匹配到历史选择时，默认使用主营公司天美意；可识别建议或自行切换，保存后的选择用于后续匹配。'
                }
              />
              <Button loading={suggesting} onClick={() => void suggestCompany()}>
                根据订单匹配公司
              </Button>
            </>
          )}
          <div className="form-grid">
            <Form.Item name="customer_name" label="客户名称" rules={[{ max: 100 }]}>
              <Input placeholder="填写客户名称，便于收入汇总筛选" maxLength={100} />
            </Form.Item>
            <Form.Item
              name="product_summary"
              label="商品"
              rules={[{ required: true, message: '请填写实际商品名称' }, { max: 500 }]}
            >
              <Input placeholder="例如：蓝莓乳酪、伯爵蛋糕" maxLength={500} />
            </Form.Item>
            <Form.Item name="delivery_address" label="配送地址" rules={[{ max: 500 }]}>
              <Input placeholder="与商品详情分开填写" maxLength={500} />
            </Form.Item>
            <Form.Item
              name="order_amount"
              label="商品金额（元，不含配送费）"
              extra="汇总只统计这里的商品金额。"
            >
              <InputNumber<string>
                aria-label="订单金额（元）"
                stringMode
                min="0"
                max="9999999999.99"
                precision={2}
                step="0.01"
                placeholder="例如 128.00"
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item name="delivery_fee" label="配送费（元）" initialValue="0.00">
              <InputNumber<string>
                aria-label="配送费（元）"
                stringMode
                min="0"
                max="9999999999.99"
                precision={2}
                step="0.01"
                placeholder="0.00"
                style={{ width: '100%' }}
              />
            </Form.Item>
            <OrderChannelField form={form} existing={!!taskId} />
            <Form.Item name="entry_progress" label="金蝶录入">
              <Select
                options={[
                  { value: 'not_entered', label: '未录入' },
                  { value: 'entered', label: '已录入' },
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item name="title" label="任务标题" rules={[{ required: true, max: 200 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="content" label="订单内容">
            <Input.TextArea rows={4} maxLength={20000} />
          </Form.Item>
          <div className="form-grid">
            <Form.Item name="category_id" label="业务分类">
              <Select
                allowClear
                options={historicalOptions(
                  companyCatalog('categories'),
                  'category_id',
                  'category_name',
                )}
              />
            </Form.Item>
            <Form.Item name="department_id" label="部门" rules={[{ required: true }]}>
              <Select
                options={historicalOptions(
                  companyCatalog('departments'),
                  'department_id',
                  'department_name',
                )}
              />
            </Form.Item>
            <Form.Item
              name="assignee_employee_id"
              label="负责人"
              rules={[{ required: true }]}
              extra={assigneeHint || undefined}
            >
              <Select
                options={historicalOptions(
                  assignmentEmployees,
                  'assignee_employee_id',
                  'assignee_name',
                )}
              />
            </Form.Item>
            <Form.Item
              name="order_taker_employee_id"
              label="接单人"
              rules={[{ required: true, message: '请选择接单人' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择本订单的接单员工"
                options={historicalOptions(
                  orderTakerEmployees,
                  'order_taker_employee_id',
                  'order_taker_name',
                )}
              />
            </Form.Item>
            <Form.Item
              name="expected_delivery_at"
              label="预计交付（精确到分钟）"
              rules={
                requireExpectedDelivery
                  ? [{ required: true, message: 'AI任务必须填写预计交付日期和时间' }]
                  : undefined
              }
            >
              <Input type="datetime-local" />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select
                options={(taskId
                  ? nextStates(savedStatus)
                  : (Object.keys(states) as (keyof typeof states)[])
                ).map((value) => ({ value, label: states[value] }))}
              />
            </Form.Item>
            <Form.Item name="priority" label="优先级">
              <Select
                options={[
                  { value: 'low', label: '低' },
                  { value: 'normal', label: '普通' },
                  { value: 'high', label: '高' },
                  { value: 'urgent', label: '加急' },
                ]}
              />
            </Form.Item>
            <Form.Item name="task_type" label="任务类型">
              <Select
                options={[
                  { value: 'order', label: '订单' },
                  { value: 'production', label: '生产' },
                  { value: 'shipping', label: '发货' },
                  { value: 'change', label: '变更' },
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item name="note" label="备注">
            <Input.TextArea maxLength={10000} />
          </Form.Item>
          <Form.Item name="source_text" hidden>
            <Input />
          </Form.Item>
        </Form>
        {imageError && (
          <Alert
            type="error"
            message="图片加载失败"
            description={imageError}
            action={<Button onClick={() => setImageRevision((v) => v + 1)}>重试</Button>}
          />
        )}
        {processingCount > 0 && <Alert message="正在检查图片，请稍候再保存任务。" />}
        <Space wrap>
          <Upload
            disabled={busy || !!processingCount}
            accept="image/png,image/jpeg,image/webp"
            multiple
            showUploadList={false}
            beforeUpload={(file) => {
              void addFile(file).catch((e) => message.error(errorText(e)));
              return false;
            }}
          >
            <Button disabled={busy || !!processingCount}>添加图片</Button>
          </Upload>
          <span>可在此窗口按 ⌘V / Ctrl+V 粘贴图片</span>
        </Space>
        <div className="attachment-list">
          <Image.PreviewGroup>
            {images.map((item) => (
              <div key={item.id}>
                {taskId && <CachedTaskImage taskId={taskId} id={item.id} />}
                <Button
                  danger
                  disabled={busy || !!processingCount}
                  size="small"
                  onClick={() =>
                    Modal.confirm({
                      title: '立即删除这张已保存的图片？',
                      onOk: async () => {
                        if (savingLock.current) return;
                        savingLock.current = true;
                        setBusy(true);
                        try {
                          await api('DELETE', `/tasks/images/${item.id}`, z.unknown());
                          await window.desktop.invalidateImage(item.id);
                          setImages((current) => current.filter((x) => x.id !== item.id));
                        } catch (error) {
                          void message.error(errorText(error));
                          throw error;
                        } finally {
                          savingLock.current = false;
                          setBusy(false);
                        }
                      },
                    })
                  }
                >
                  删除
                </Button>
              </div>
            ))}
          </Image.PreviewGroup>
          {previewFiles.map(({ file, url }, index) => (
            <div key={`${file.name}-${index}`}>
              <Image
                width={90}
                height={75}
                style={{ objectFit: 'cover' }}
                src={url}
                alt={file.name}
              />
              <div>{file.name}</div>
              <Button
                disabled={busy || !!processingCount}
                size="small"
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
              >
                移除
              </Button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
function TaskImages({ id }: { id: string }) {
  const [images, setImages] = useState<TaskImage[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void api('GET', `/tasks/${id}/images?page_size=12`, pageSchema(imageSchema))
        .then((data) => {
          if (active) {
            setImages(data.items);
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(errorText(e));
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 240000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [id, revision]);
  if (error)
    return (
      <Button type="link" size="small" onClick={() => setRevision((v) => v + 1)}>
        图片加载失败，重试
      </Button>
    );
  return (
    <Image.PreviewGroup>
      {images.map((image, index) => (
        <CachedTaskImage key={image.id} taskId={id} id={image.id} size={42} hidden={index >= 3} />
      ))}
      {images.length > 3 && <span>共 {images.length} 张</span>}
    </Image.PreviewGroup>
  );
}
export function Tasks({
  requestedId,
  clearRequest,
  canManage,
  onDelivery,
  onCategoryManage,
}: {
  requestedId: string | null;
  clearRequest: () => void;
  canManage: boolean;
  onDelivery: (id: string) => void;
  onCategoryManage: () => void;
}) {
  const state = useAppState();
  const tasks = state.tasks,
    total = state.taskTotal,
    page = state.taskPage,
    filter = state.taskFilters;
  const setTasks = (tasks: Task[]) => dispatch({ type: 'tasks', tasks });
  const setTotal = (total: number) => dispatch({ type: 'total', total });
  const setPage = (page: number) => dispatch({ type: 'page', page });
  const setFilter = (update: (current: Record<string, string>) => Record<string, string>) =>
    dispatch({ type: 'filters', filters: update(getState().taskFilters) });
  const columnRules = readRetailFilters(filter.column_filters);
  const applyColumnRules = (rules: RetailFilterRule[]) => {
    setPage(1);
    setFilter((current) => ({
      ...current,
      column_filters: rules.length ? JSON.stringify(rules) : '',
    }));
  };
  const creationRequests = useRef(new Map<string, string>());
  const [linked, setLinked] = useState<z.infer<typeof deliveryLinkSchema>[] | null>(null);
  useEffect(() => {
    if (!requestedId) return;
    let active = true;
    void api('GET', `/tasks/${requestedId}`, taskSchema)
      .then((task) => {
        if (active) {
          canManage ? setEditing(task) : setDetails(task);
          clearRequest();
        }
      })
      .catch((e) => message.error(errorText(e)));
    return () => {
      active = false;
    };
  }, [requestedId]);
  const [details, setDetails] = useState<Task | null>(null);
  const [catalog, setCatalog] = useState<Record<string, Resource[]>>({});
  const [editing, setEditing] = useState<Task | TaskInput | null>(null);
  const loading = state.taskLoading;
  const setLoading = (loading: boolean) => dispatch({ type: 'loading', loading });
  const [revision, setRevision] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [takerUpdatingId, setTakerUpdatingId] = useState<string | null>(null);
  const [recognizingId, setRecognizingId] = useState<string | null>(null);
  const setOrderTaker = async (task: Task, employeeId: string) => {
    setTakerUpdatingId(task.id);
    try {
      await api('PATCH', `/tasks/${task.id}/order-taker`, taskSchema, {
        order_taker_employee_id: employeeId,
      });
      reload();
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setTakerUpdatingId(null);
    }
  };
  const recognizeDetails = async (task: Task) => {
    setRecognizingId(task.id);
    try {
      await api(
        'POST',
        `/ai/retail-details/${task.id}`,
        z.object({ product_summary: z.string(), delivery_address: z.string() }),
        {},
      );
      reload();
      void message.success('已识别商品与地址；原文没有的信息仍保留为空');
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setRecognizingId(null);
    }
  };
  const [expandedTaskIds, setExpandedTaskIds] = useState<Key[]>([]);
  const [expandedFeeIds, setExpandedFeeIds] = useState<string[]>([]);
  const reload = () => setRevision((value) => value + 1);
  const toggleTaskExpanded = (taskId: string) =>
    setExpandedTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
    );
  useEffect(() => {
    if (!canManage) return;
    void Promise.all(
      ['departments', 'employees', 'categories'].map(
        async (key) => [key, await allResources(`/${key}`)] as const,
      ),
    )
      .then((entries) => setCatalog(Object.fromEntries(entries)))
      .catch((e) => message.error(errorText(e)));
  }, []);
  const query = new URLSearchParams({
    ...filter,
    status: '',
    page: String(page),
    page_size: '20',
  }).toString();
  useEffect(() => {
    let active = true;
    setLoading(true);
    void api(
      'GET',
      `/tasks?${query}`,
      pageSchema(taskSchema).extend({ total_amount: z.union([z.string(), z.number()]) }),
    )
      .then((data) => {
        if (!active) return;
        dispatch({ type: 'error', error: '' });
        setTasks(data.items);
        setTotal(data.total);
        setTotalAmount(Number(data.total_amount));
      })
      .catch((e: unknown) => {
        if (!active) return;
        dispatch({ type: 'error', error: errorText(e) });
        void message.error(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, revision]);
  const change = (key: string, value: string) => {
    setPage(1);
    setFilter((current) => ({
      ...current,
      [key]: value,
      ...(key === 'department_id' ? { assignee_employee_id: '' } : {}),
    }));
  };
  const setEntryProgress = async (task: Task, entry_progress: Task['entry_progress']) => {
    try {
      const updated = await api('PATCH', `/tasks/${task.id}/entry-progress`, taskSchema, {
        entry_progress,
      });
      setTasks(getState().tasks.map((item) => (item.id === updated.id ? updated : item)));
      if (columnRules.some((rule) => rule.field === 'entry_progress')) reload();
      void message.success(entry_progress === 'entered' ? '已标记为已录入' : '已标记为未录入');
    } catch (error) {
      void message.error(errorText(error));
    }
  };
  const setTaskStatus = async (task: Task, status: Task['status']) => {
    if (status === task.status) return;
    setStatusUpdatingId(task.id);
    try {
      const updated = await api('PATCH', `/tasks/${task.id}/status`, taskSchema, { status });
      setTasks(tasks.map((item) => (item.id === updated.id ? updated : item)));
      reload();
      void message.success(`状态已更新为“${states[status]}”`);
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setStatusUpdatingId(null);
    }
  };
  const actions = (task: Task) => (
    <Space>
      {!!(task.delivery_note_count || task.delivery_notes?.length) && (
        <Button
          type="link"
          onClick={() =>
            void api(
              'GET',
              `/tasks/${task.id}/delivery-notes`,
              z.union([
                z.array(deliveryLinkSchema),
                z.object({ items: z.array(deliveryLinkSchema) }),
              ]),
            )
              .then((result) => setLinked(Array.isArray(result) ? result : result.items))
              .catch((e) => message.error(errorText(e)))
          }
        >
          已关联送货单（{task.delivery_note_count ?? task.delivery_notes?.length ?? 0}）
        </Button>
      )}

      <Button type="link" onClick={() => (canManage ? setEditing(task) : setDetails(task))}>
        {canManage ? '编辑' : '详情'}
      </Button>
      {canManage && (
        <>
          <Button
            type="link"
            onClick={() => {
              const requestId = creationRequests.current.get(task.id) ?? crypto.randomUUID();
              creationRequests.current.set(task.id, requestId);
              void api(
                'POST',
                `/delivery-notes/from-task/${task.id}`,
                z.object({ id: z.string() }).passthrough(),
                { request_id: requestId },
              )
                .then((x) => {
                  creationRequests.current.delete(task.id);
                  onDelivery(x.id);
                })
                .catch((e) => message.error(errorText(e)));
            }}
          >
            开送货单
          </Button>
          <Button
            danger
            type="link"
            onClick={() =>
              Modal.confirm({
                title: '删除此任务？',
                content: '任务会从汇总中移除；图片附件会一并删除，已关联送货单会保留来源记录。',
                onOk: async () => {
                  try {
                    await api('DELETE', `/tasks/${task.id}`, z.unknown());
                    void message.success('任务已删除');
                    reload();
                  } catch (error) {
                    void message.error(errorText(error));
                    throw error;
                  }
                },
              })
            }
          >
            删除
          </Button>
        </>
      )}
    </Space>
  );
  return (
    <>
      {linked && (
        <Modal
          open
          title={`已关联送货单（${linked.length}）`}
          footer={null}
          onCancel={() => setLinked(null)}
        >
          {linked.map((note) => (
            <p key={note.id}>
              <Button type="link" onClick={() => onDelivery(note.id)}>
                {note.note_number || '送货草稿'} {note.delivery_date}
              </Button>
            </p>
          ))}
        </Modal>
      )}
      <div className="page-heading">
        <div>
          <h1>任务汇总</h1>
          <p>零售订单与交付安排</p>
        </div>
        <Space>
          {canManage && <Button onClick={onCategoryManage}>分类管理</Button>}
          <Button
            disabled={!canManage}
            onClick={() => {
              void download(`/tasks/export?${query}`, '任务.xlsx').catch((e) =>
                message.error(errorText(e)),
              );
            }}
          >
            导出 Excel
          </Button>
          {canManage && (
            <Button type="primary" onClick={() => setEditing(emptyTask())}>
              手动新建
            </Button>
          )}
        </Space>
      </div>
      <Space wrap className="filters">
        <Input
          type="month"
          value={filter.month}
          onChange={(e) => change('month', e.target.value)}
        />
        {[
          ['categories', 'category_id', '全部分类'],
          ['departments', 'department_id', '全部部门'],
          ['employees', 'assignee_employee_id', '全部负责人'],
        ].map(([key, field, label]) => (
          <Select
            key={key}
            disabled={!canManage}
            style={{ width: 150 }}
            value={filter[field] ?? ''}
            onChange={(value) => change(field, value)}
            options={[
              { value: '', label },
              ...options(
                key === 'employees' && filter.department_id
                  ? matchingBusinessEmployees(
                      catalog.departments ?? [],
                      catalog.employees ?? [],
                      filter.department_id,
                    )
                  : (catalog[key] ?? []),
              ),
            ]}
          />
        ))}
        <Select
          disabled={!canManage}
          style={{ width: 150 }}
          value={filter.order_taker_employee_id ?? ''}
          onChange={(value) => change('order_taker_employee_id', value)}
          options={[{ value: '', label: '全部接单人' }, ...options(catalog.employees ?? [])]}
        />
        <Select
          style={{ width: 130 }}
          value={filter.priority ?? ''}
          onChange={(value) => change('priority', value)}
          options={[
            { value: '', label: '全部优先级' },
            { value: 'low', label: '低' },
            { value: 'normal', label: '普通' },
            { value: 'high', label: '高' },
            { value: 'urgent', label: '加急' },
          ]}
        />
        <Input.Search placeholder="搜索任务" onSearch={(value) => change('keyword', value)} />
        <Button
          onClick={() => {
            setPage(1);
            setFilter(() => ({ month: new Date().toLocaleDateString('sv-SE').slice(0, 7) }));
          }}
        >
          重置筛选
        </Button>
        <Button onClick={reload}>刷新</Button>
      </Space>
      {state.taskError && <Alert type="error" message={state.taskError} />}
      <div className="task-summary-metrics" aria-label="任务汇总统计">
        <span>订单总数</span>
        <strong>{total}</strong>
        <span>订单金额</span>
        <strong>¥{totalAmount.toFixed(2)}</strong>
        <span className="secondary">按当前筛选统计，已取消订单不计金额</span>
      </div>
      <Table<Task>
        className="task-summary-table"
        rowClassName={(task) => `task-row task-row-${task.status}`}
        tableLayout="fixed"
        sticky
        scroll={{ x: 1140 }}
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={tasks}
        pagination={{ current: page, pageSize: 20, total, onChange: setPage }}
        expandable={{
          showExpandColumn: false,
          expandedRowKeys: expandedTaskIds,
          expandedRowRender: (task) => (
            <div className="task-expanded-detail">
              <div className="task-expanded-content">
                <p>
                  <strong>商品：</strong>
                  {productLabel(task) || '待补充'}
                </p>
                {retailFlavor(task) && (
                  <p>
                    <strong>口味：</strong>
                    {retailFlavor(task)}
                  </p>
                )}
                <p>
                  <strong>配送地址：</strong>
                  {task.delivery_address || '待补充'}
                </p>
                <strong>订单详情</strong>
                <p>{task.content || '暂无订单内容'}</p>
                {!!task.note && <p className="secondary">备注：{task.note}</p>}
              </div>
              <div className="task-expanded-meta">
                <span>
                  公司：{task.company_name ?? (task.company_code === 'tri' ? '趣趣特' : '天美意')}
                </span>
                <span>客户：{task.customer_name || '—'}</span>
                <span>渠道：{task.order_channel || '—'}</span>
                <span>
                  商品金额：
                  {task.order_amount == null ? '待补' : `¥${Number(task.order_amount).toFixed(2)}`}
                </span>
                <span>配送费：¥{Number(task.delivery_fee ?? 0).toFixed(2)}</span>
                <span>分类：{task.category_name ?? '未分类'}</span>
                <span>负责人：{task.assignee_name || '—'}</span>
                <span>接单人：{task.order_taker_name || '待补'}</span>
              </div>
              <TaskImages key={`${task.id}-${revision}`} id={task.id} />
              <div className="task-expanded-actions">
                {actions(task)}
                {canManage && (
                  <Button
                    type="link"
                    loading={recognizingId === task.id}
                    disabled={!!recognizingId}
                    onClick={() => void recognizeDetails(task)}
                  >
                    AI 补全商品与地址
                  </Button>
                )}
              </div>
            </div>
          ),
        }}
        columns={[
          {
            title: '序号',
            width: 58,
            align: 'center',
            render: (_value, _task, index) => (page - 1) * 20 + index + 1,
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 92,
            render: (value: Task['status'], task) => (
              <Select
                className={`task-status-select task-status-${value} task-entry-${task.entry_progress === 'entered' ? 'entered' : 'not-entered'}`}
                variant="borderless"
                size="small"
                suffixIcon={null}
                popupMatchSelectWidth={128}
                classNames={{ popup: { root: 'task-status-popup' } }}
                aria-label={`${task.title}状态，点击修改`}
                value={value}
                disabled={statusUpdatingId === task.id}
                loading={statusUpdatingId === task.id}
                onClick={(event) => event.stopPropagation()}
                onChange={(next) => void setTaskStatus(task, next)}
                options={(canManage
                  ? (Object.keys(states) as Task['status'][])
                  : nextStates(value)
                ).map((status) => ({
                  value: status,
                  label: (
                    <span className={`task-status-text task-status-${status}`}>
                      <i />
                      {states[status]}
                    </span>
                  ),
                }))}
              />
            ),
          },
          {
            title: '时间',
            dataIndex: 'expected_delivery_at',
            width: 132,
            render: (value: string | null) =>
              value ? (
                <span className="task-delivery-time">
                  <span>{value.slice(5, 10)}</span>
                  <span>{value.slice(11, 16)}</span>
                </span>
              ) : (
                '待补充'
              ),
          },
          {
            title: '订单',
            dataIndex: 'title',
            render: (_, task) => (
              <button
                type="button"
                className="task-order-toggle task-one-line"
                title={`${task.title} ${task.product_summary ?? ''} ${task.content ?? ''}`}
                aria-label={`${expandedTaskIds.includes(task.id) ? '收起' : '展开'}${task.title}订单详情`}
                aria-expanded={expandedTaskIds.includes(task.id)}
                onClick={() => toggleTaskExpanded(task.id)}
              >
                <span
                  className={`task-expand-arrow${expandedTaskIds.includes(task.id) ? ' is-expanded' : ''}`}
                  aria-hidden="true"
                >
                  <RightOutlined />
                </span>
                <strong>{task.title}</strong>
                <span>{productLabel(task) || '商品待补'}</span>
                {!!task.order_channel && <span>{task.order_channel}</span>}
              </button>
            ),
          },
          {
            title: (
              <RetailColumnFilter
                field="order_taker_employee_id"
                title="接单人"
                rules={columnRules}
                choices={options(catalog.employees ?? [])}
                onApply={applyColumnRules}
              />
            ),
            width: 126,
            render: (_, task) =>
              canManage ? (
                <Select
                  aria-label={`${task.title}接单人`}
                  variant="borderless"
                  size="small"
                  style={{ width: '100%' }}
                  placeholder="选择接单人"
                  value={task.order_taker_employee_id || undefined}
                  loading={takerUpdatingId === task.id}
                  disabled={takerUpdatingId === task.id}
                  showSearch
                  optionFilterProp="label"
                  options={options(
                    (catalog.employees ?? []).filter(
                      (employee) =>
                        employee.id === task.order_taker_employee_id ||
                        employeeAvailableOn(
                          employee,
                          (
                            task.expected_delivery_at ||
                            task.created_at ||
                            new Date().toLocaleDateString('sv-SE')
                          ).slice(0, 10),
                        ),
                    ),
                  )}
                  onChange={(value) => void setOrderTaker(task, value)}
                />
              ) : (
                task.order_taker_name || '接单人待补'
              ),
          },
          {
            title: (
              <RetailColumnFilter
                field="order_amount"
                title="金额"
                rules={columnRules}
                onApply={applyColumnRules}
              />
            ),
            dataIndex: 'order_amount',
            width: 150,
            render: (value: string | number | null, task) => (
              <div className="task-amount-cell">
                <button
                  type="button"
                  className="task-amount-toggle"
                  aria-label={`${expandedFeeIds.includes(task.id) ? '收起' : '展开'}运费`}
                  aria-expanded={expandedFeeIds.includes(task.id)}
                  onClick={() =>
                    setExpandedFeeIds((ids) =>
                      ids.includes(task.id)
                        ? ids.filter((id) => id !== task.id)
                        : [...ids, task.id],
                    )
                  }
                >
                  <span>{value == null ? '待补' : `¥${Number(value).toFixed(2)}`}</span>
                  <RightOutlined
                    className={`task-expand-arrow${expandedFeeIds.includes(task.id) ? ' is-expanded' : ''}`}
                  />
                </button>
                {expandedFeeIds.includes(task.id) && (
                  <InlineDeliveryFee task={task} editable={canManage} onSaved={reload} />
                )}
              </div>
            ),
          },
          {
            title: (
              <RetailColumnFilter
                field="assignee_employee_id"
                title="负责人"
                rules={columnRules}
                choices={options(catalog.employees ?? [])}
                onApply={applyColumnRules}
              />
            ),
            dataIndex: 'assignee_name',
            width: 92,
            render: (value) => value || '—',
          },
          {
            title: '优先级',
            dataIndex: 'priority',
            width: 72,
            render: (value) =>
              ({ low: '低', normal: '普通', high: '高', urgent: '加急' })[String(value) as 'low'],
          },
          {
            title: (
              <RetailColumnFilter
                field="entry_progress"
                title="金蝶录入"
                rules={columnRules}
                onApply={applyColumnRules}
              />
            ),
            dataIndex: 'entry_progress',
            width: 118,
            render: (value: Task['entry_progress'], task) =>
              canManage ? (
                <Select
                  className="task-progress-select"
                  variant="borderless"
                  size="small"
                  value={value}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(next) => void setEntryProgress(task, next)}
                  options={[
                    { value: 'not_entered', label: '未录入' },
                    { value: 'entered', label: '已录入' },
                  ]}
                />
              ) : value === 'entered' ? (
                '已录入'
              ) : (
                '未录入'
              ),
          },
        ]}
      />

      {details && (
        <Modal open title="任务详情" footer={null} onCancel={() => setDetails(null)}>
          <h3>{details.title}</h3>
          <p>商品：{productLabel(details) || '待补充'}</p>
          {retailFlavor(details) && <p>口味：{retailFlavor(details)}</p>}
          <p>配送地址：{details.delivery_address || '待补充'}</p>
          <p>订单详情：{details.content || '—'}</p>
          <p>
            商品金额：
            {details.order_amount == null
              ? '待补'
              : `¥${Number(details.order_amount).toFixed(2)}`}{' '}
            / 配送费：¥
            {Number(details.delivery_fee ?? 0).toFixed(2)}
          </p>
          <p>负责人：{details.assignee_name}</p>
          <p>接单人：{details.order_taker_name || '待补'}</p>
          <p>
            分类：{details.category_name ?? '未分类'} / 预计交付：
            {details.expected_delivery_at ?? '待补充'}
          </p>
          <p>备注：{details.note}</p>
          <TaskImages id={details.id} />
        </Modal>
      )}
      {editing && (
        <TaskForm
          initial={editing}
          onCancel={() => {
            setEditing(null);
            reload();
          }}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}
export function Overview() {
  const { taskFilters: filter, session } = useAppState();
  const canManage = session?.user.role !== 'employee';
  const [catalog, setCatalog] = useState<Record<string, Resource[]>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!canManage) return;
    void Promise.all(
      ['departments', 'employees', 'categories'].map(
        async (key) => [key, await allResources(`/${key}`)] as const,
      ),
    )
      .then((entries) => setCatalog(Object.fromEntries(entries)))
      .catch((e) => message.error(errorText(e)));
  }, [canManage]);
  const query = new URLSearchParams(filter).toString();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void (async () => {
      const result: Task[] = [];
      for (let page = 1; ; page++) {
        const data = await api(
          'GET',
          `/tasks?${query}&page=${page}&page_size=200`,
          pageSchema(taskSchema),
        );
        if (!active) return;
        result.push(...data.items);
        if (result.length >= data.total || !data.items.length) break;
      }
      if (active) setTasks(result);
    })()
      .catch((e) => {
        if (active) {
          setTasks([]);
          setError(errorText(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, revision]);
  const change = (key: string, value: string) =>
    dispatch({
      type: 'filters',
      filters: {
        ...getState().taskFilters,
        [key]: value,
        ...(key === 'department_id' ? { assignee_employee_id: '' } : {}),
      },
    });
  const distribution = (field: 'department_name' | 'assignee_name') =>
    Object.entries(
      tasks.reduce<Record<string, number>>((result, task) => {
        const name = task[field] ?? '未分配';
        result[name] = (result[name] ?? 0) + 1;
        return result;
      }, {}),
    ).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>订单概览</h1>
          <p>统计与任务列表的月份、分类、部门、员工及搜索条件保持一致。</p>
        </div>
        <Button onClick={() => setRevision((v) => v + 1)}>刷新</Button>
      </div>
      <Space wrap className="filters">
        <Input
          type="month"
          value={filter.month}
          onChange={(e) => change('month', e.target.value)}
        />
        {(
          [
            ['categories', 'category_id', '全部分类'],
            ['departments', 'department_id', '全部部门'],
            ['employees', 'assignee_employee_id', '全部负责人'],
          ] as const
        ).map(([key, field, label]) => (
          <Select
            key={field}
            disabled={!canManage}
            style={{ width: 150 }}
            value={filter[field] ?? ''}
            options={[
              { value: '', label },
              ...options(
                key === 'employees' && filter.department_id
                  ? matchingBusinessEmployees(
                      catalog.departments ?? [],
                      catalog.employees ?? [],
                      filter.department_id,
                    )
                  : (catalog[key] ?? []),
              ),
            ]}
            onChange={(value) => change(field, value)}
          />
        ))}
        <Select
          style={{ width: 130 }}
          value={filter.status ?? ''}
          options={[
            { value: '', label: '全部状态' },
            ...Object.entries(states).map(([value, label]) => ({ value, label })),
          ]}
          onChange={(value) => change('status', value)}
        />
        <Select
          style={{ width: 130 }}
          value={filter.priority ?? ''}
          options={[
            { value: '', label: '全部优先级' },
            ...Object.entries({ low: '低', normal: '普通', high: '高', urgent: '加急' }).map(
              ([value, label]) => ({ value, label }),
            ),
          ]}
          onChange={(value) => change('priority', value)}
        />
        <Input.Search
          placeholder="搜索任务"
          defaultValue={filter.keyword}
          onSearch={(value) => change('keyword', value)}
        />
        <Button
          onClick={() =>
            dispatch({
              type: 'filters',
              filters: { month: new Date().toLocaleDateString('sv-SE').slice(0, 7) },
            })
          }
        >
          重置筛选
        </Button>
      </Space>
      {error && <Alert type="error" message={error} />}
      <div className="stats-grid">
        <Card loading={loading}>
          <Statistic title="当前筛选任务" value={tasks.length} />
        </Card>
        {Object.entries(states).map(([status, label]) => (
          <Card key={status} loading={loading}>
            <Statistic
              title={label}
              value={tasks.filter((task) => task.status === status).length}
            />
          </Card>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 20 }}>
        {(['department_name', 'assignee_name'] as const).map((field) => (
          <Card
            key={field}
            loading={loading}
            title={field === 'department_name' ? '部门任务分布' : '员工任务分布'}
          >
            <Table
              pagination={false}
              rowKey="name"
              size="small"
              dataSource={distribution(field).map(([name, count]) => ({ name, count }))}
              columns={[
                { title: '名称', dataIndex: 'name' },
                { title: '任务数量', dataIndex: 'count' },
              ]}
            />
          </Card>
        ))}
      </div>
    </>
  );
}
