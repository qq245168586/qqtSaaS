import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import { z } from 'zod';
import { allResources, api, errorText } from './api';
import type { Resource } from './contracts';
import { employeeAvailableOn } from './assignment';
import { CompanyField } from './CompanySelect';
import { useAppState } from './store';
const resources = [
  ['departments', '部门'],
  ['employees', '员工'],
  ['categories', '业务分类'],
  ['customers', '客户'],
  ['customer-categories', '客户分类'],
  ['products', '产品'],
  ['personnel', '署名人员'],
] as const;
type ResourceKind = (typeof resources)[number][0];
const labels = Object.fromEntries(resources) as Record<ResourceKind, string>;
const hasCompanyOwnership = (kind: ResourceKind) => kind !== 'departments' && kind !== 'employees';
const roleLabels: Record<string, string> = {
  general: '通用',
  maker: '制单',
  warehouse: '仓管',
  sales: '业务',
  deliverer: '送货',
};
export function Catalog({
  initialKind = 'departments',
  allowedKinds,
}: {
  initialKind?: ResourceKind;
  allowedKinds?: ResourceKind[];
}) {
  const publicAccess = useAppState().session?.user.public_access;
  const visible = resources.filter(([key]) => !allowedKinds || allowedKinds.includes(key));
  const [kind, setKind] = useState<ResourceKind>(initialKind);
  const [items, setItems] = useState<Resource[]>([]);
  const [related, setRelated] = useState<Record<string, Resource[]>>({});
  const [editing, setEditing] = useState<Resource | false | null>(null);
  const [revision, setRevision] = useState(0);
  const [modal, modalContext] = Modal.useModal();
  const [form] = Form.useForm<{
    name: string;
    code?: string;
    status?: string;
    left_on?: string | null;
    unit?: string;
    default_price?: string | number;
    role_type?: string;
    company_code?: 'tri' | 'tmy';
    sort?: number;
    active?: number | boolean;
    department_id?: string | null;
    category_id?: string | null;
    address?: string | null;
    phone?: string | null;
    contact?: string | null;
    spec?: string | null;
  }>();
  const employeeStatus = Form.useWatch('status', form);
  const [departure, setDeparture] = useState<Resource | null>(null);
  const [departureDate, setDepartureDate] = useState('');
  const [departing, setDeparting] = useState(false);
  async function depart() {
    if (!departure || !departureDate) return;
    setDeparting(true);
    try {
      await api('POST', `/employees/${departure.id}/departure`, z.unknown(), {
        left_on: departureDate,
      });
      setDeparture(null);
      setRevision((x) => x + 1);
      void message.success('已登记离职，历史记录保留');
    } catch (e) {
      void message.error(errorText(e));
    } finally {
      setDeparting(false);
    }
  }
  const formCompany = Form.useWatch('company_code', form);
  useEffect(() => setKind(initialKind), [initialKind]);
  useEffect(() => {
    let active = true;
    setItems([]);
    void allResources(`/${kind}`)
      .then((items) => {
        if (active) setItems(items);
      })
      .catch((e) => message.error(errorText(e)));
    void Promise.all(
      ['departments', 'employees', 'customer-categories'].map(
        async (key) => [key, await allResources(`/${key}`)] as const,
      ),
    )
      .then((entries) => {
        if (active) setRelated(Object.fromEntries(entries));
      })
      .catch((e) => message.error(errorText(e)));
    return () => {
      active = false;
    };
  }, [kind, revision]);
  function edit(record: Resource | false) {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue(
      record
        ? { ...record, code: record.code ?? '' }
        : {
            name: '',
            company_code: 'tmy',
            status: 'active',
            active: 1,
            sort: 0,
            unit: '个',
            default_price: 0,
            role_type: 'general',
          },
    );
  }
  async function save() {
    try {
      const input = await form.validateFields();
      if (
        ['departments', 'categories', 'customer-categories', 'products', 'personnel'].includes(kind)
      )
        input.sort = editing ? (editing.sort ?? 0) : 0;
      if (!hasCompanyOwnership(kind)) delete input.company_code;
      await api(
        editing ? 'PUT' : 'POST',
        editing ? `/${kind}/${editing.id}` : `/${kind}`,
        z.unknown(),
        input,
      );
      setEditing(null);
      setRevision((x) => x + 1);
      void message.success('已保存');
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      void message.error(errorText(e));
    }
  }
  async function remove(resourceKind: ResourceKind, record: Resource) {
    try {
      await api('DELETE', `/${resourceKind}/${record.id}`, z.null());
      setItems((current) => current.filter((item) => item.id !== record.id));
      setRevision((value) => value + 1);
      void message.success(`${labels[resourceKind]}“${record.name}”已删除`);
    } catch (error) {
      void message.error(errorText(error));
      throw error;
    }
  }
  return (
    <>
      {modalContext}
      <div className="page-heading">
        <div>
          <span className="eyebrow">BUSINESS DIRECTORY</span>
          <h1>{visible.length === 1 ? `${labels[kind]}管理` : '统一基础资料'}</h1>
          <p>沿用原工作台的资料维护方式，为任务和送货单提供可选择的数据。</p>
        </div>
        <Button type="primary" onClick={() => edit(false)}>
          ＋ 新增{labels[kind]}
        </Button>
      </div>
      <Tabs
        activeKey={kind}
        onChange={(value) => setKind(value as ResourceKind)}
        items={visible.map(([key, label]) => ({ key, label }))}
      />
      <Card>
        <Table<Resource>
          rowKey="id"
          dataSource={items}
          columns={[
            ...(publicAccess && hasCompanyOwnership(kind)
              ? [
                  {
                    title: '公司',
                    render: (_: unknown, record: Resource) =>
                      record.company_name ??
                      (record.company_code === 'tri'
                        ? '趣趣特'
                        : record.company_code === 'tmy'
                          ? '天美意'
                          : '未设置'),
                  },
                ]
              : []),
            {
              title: `${labels[kind]}名称`,
              dataIndex: 'name',
              render: (name) => <strong>{name}</strong>,
            },
            ...(kind === 'departments'
              ? [
                  {
                    title: '在职员工',
                    render: (_: unknown, record: Resource) =>
                      `${(related.employees ?? []).filter((employee) => employee.department_id === record.id && employeeAvailableOn(employee, new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }))).length} 人`,
                  },
                ]
              : []),
            ...(kind === 'employees'
              ? [
                  {
                    title: '所属部门',
                    render: (_: unknown, record: Resource) =>
                      (related.departments ?? []).find((x) => x.id === record.department_id)
                        ?.name ?? '—',
                  },
                  {
                    title: '在职状态',
                    render: (_: unknown, record: Resource) => (
                      <Tag color={record.status === 'left' ? 'default' : 'green'}>
                        {record.status === 'left'
                          ? record.left_on &&
                            record.left_on >
                              new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
                            ? '待离职'
                            : '离职'
                          : '在职'}
                      </Tag>
                    ),
                  },
                  {
                    title: '离职日期',
                    dataIndex: 'left_on',
                    render: (v: string | null) => v ?? '—',
                  },
                  { title: '电话', dataIndex: 'phone' },
                ]
              : []),
            ...(kind === 'customers'
              ? [
                  {
                    title: '客户分类',
                    render: (_: unknown, record: Resource) =>
                      (related['customer-categories'] ?? []).find(
                        (x) => x.id === record.category_id,
                      )?.name ?? '未分类',
                  },
                  { title: '地址', dataIndex: 'address' },
                  { title: '联系人', dataIndex: 'contact' },
                  { title: '电话', dataIndex: 'phone' },
                ]
              : []),
            ...(kind === 'products'
              ? [
                  { title: '规格', dataIndex: 'spec' },
                  { title: '单位', dataIndex: 'unit' },
                  { title: '默认单价', dataIndex: 'default_price' },
                ]
              : []),
            ...(kind === 'personnel'
              ? [
                  {
                    title: '署名角色',
                    dataIndex: 'role_type',
                    render: (value: string) => roleLabels[value] ?? value,
                  },
                ]
              : []),
            {
              title: '操作',
              render: (_, record) => (
                <Space>
                  <Button type="link" onClick={() => edit(record)}>
                    编辑
                  </Button>
                  {kind === 'employees' ? (
                    <Button
                      danger
                      type="link"
                      disabled={record.status === 'left'}
                      onClick={() => {
                        setDeparture(record);
                        setDepartureDate(
                          new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
                        );
                      }}
                    >
                      离职
                    </Button>
                  ) : (
                    <Button
                      danger
                      type="link"
                      onClick={() =>
                        modal.confirm({
                          title: `删除${labels[kind]}“${record.name}”？`,
                          content: '删除后不再出现在选择列表中；有关联任务的资料会由服务器保护。',
                          okText: '删除',
                          okButtonProps: { danger: true },
                          cancelText: '取消',
                          onOk: () => remove(kind, record),
                        })
                      }
                    >
                      删除
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
          pagination={{ pageSize: 20 }}
        />
      </Card>
      <p className="secondary">
        部门和员工为全局共享资料；其他基础资料的关联、删除保护与公司归属由服务器验证。
      </p>
      <Modal
        open={editing !== null}
        title="维护基础资料"
        onCancel={() => setEditing(null)}
        onOk={() => void save()}
      >
        <Form form={form} layout="vertical">
          {publicAccess && hasCompanyOwnership(kind) && (
            <CompanyField disabled={Boolean(editing)} />
          )}
          <Form.Item name="name" label="名称" rules={[{ required: true, max: 100 }]}>
            <Input />
          </Form.Item>
          {kind === 'employees' && (
            <>
              <Form.Item name="department_id" label="部门" rules={[{ required: true }]}>
                <Select
                  options={(related.departments ?? []).map((x) => ({ value: x.id, label: x.name }))}
                />
              </Form.Item>
              <Form.Item name="status" label="状态">
                <Select
                  disabled={!!editing && editing.status === 'left'}
                  options={[
                    { value: 'active', label: '在职' },
                    { value: 'left', label: '离职' },
                  ]}
                />
              </Form.Item>
              {employeeStatus === 'left' && (
                <Form.Item
                  name="left_on"
                  label="离职日期（当天起停用）"
                  rules={[{ required: true, message: '请选择离职日期' }]}
                >
                  <Input type="date" disabled={!!editing && editing.status === 'left'} />
                </Form.Item>
              )}
              <Form.Item name="phone" label="电话">
                <Input />
              </Form.Item>
            </>
          )}
          {kind === 'customers' && (
            <>
              <Form.Item name="code" label="客户编号">
                <Input maxLength={50} />
              </Form.Item>
              <Form.Item name="category_id" label="客户分类">
                <Select
                  allowClear
                  options={(related['customer-categories'] ?? [])
                    .filter((x) => !formCompany || x.company_code === formCompany)
                    .map((x) => ({ value: x.id, label: x.name }))}
                />
              </Form.Item>
              <Form.Item name="address" label="地址">
                <Input />
              </Form.Item>
              <Form.Item name="contact" label="联系人">
                <Input />
              </Form.Item>
              <Form.Item name="phone" label="电话">
                <Input />
              </Form.Item>
            </>
          )}
          {kind === 'products' && (
            <>
              <Form.Item name="spec" label="规格">
                <Input />
              </Form.Item>
              <Form.Item name="unit" label="单位" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="default_price" label="默认单价">
                <InputNumber min={0} precision={2} />
              </Form.Item>
            </>
          )}
          {kind === 'personnel' && (
            <Form.Item name="role_type" label="署名角色">
              <Select
                options={[
                  ['general', '通用'],
                  ['maker', '制单'],
                  ['warehouse', '仓管'],
                  ['sales', '业务'],
                  ['deliverer', '送货'],
                ].map(([value, label]) => ({ value, label }))}
              />
            </Form.Item>
          )}
          {['customers', 'products'].includes(kind) && (
            <Form.Item name="active" label="启用状态">
              <Select
                options={[
                  { value: 1, label: '启用' },
                  { value: 0, label: '停用' },
                ]}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
      <Modal
        open={!!departure}
        title={`登记 ${departure?.name ?? ''} 离职`}
        onCancel={() => !departing && setDeparture(null)}
        onOk={() => void depart()}
        confirmLoading={departing}
        okText="登记离职"
        okButtonProps={{ disabled: !departureDate }}
      >
        <p>离职当天起不能用于单据和新排班；此前的单据仍可使用，历史排班及余额保留。</p>
        <Input
          aria-label="离职日期"
          type="date"
          value={departureDate}
          onChange={(e) => setDepartureDate(e.target.value)}
        />
      </Modal>
    </>
  );
}
