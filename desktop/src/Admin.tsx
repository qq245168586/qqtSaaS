import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Space, Table, Upload, message } from 'antd';
import { z } from 'zod';
import { allResources, api, errorText, ipc } from './api';
import { pageSchema, type Resource } from './contracts';
import { clearCache, setCacheScope } from './cache';
const accountSchema = z.object({
  id: z.string(),
  username: z.string(),
  real_name: z.string(),
  role: z.enum(['boss', 'admin', 'employee']),
  employee_id: z.string().nullish(),
  status: z.enum(['active', 'disabled']),
});
type Account = z.infer<typeof accountSchema>;
type AccountInput = Omit<Account, 'id'> & { password?: string };
export function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [employees, setEmployees] = useState<Resource[]>([]);
  const [editing, setEditing] = useState<Account | false | null>(null);
  const [revision, setRevision] = useState(0);
  const [form] = Form.useForm<AccountInput>();
  useEffect(() => {
    void api('GET', '/users', pageSchema(accountSchema))
      .then((x) => setAccounts(x.items))
      .catch((e) => message.error(errorText(e)));
    void allResources('/employees')
      .then(setEmployees)
      .catch((e) => message.error(errorText(e)));
  }, [revision]);
  function edit(account: Account | false) {
    form.resetFields();
    form.setFieldsValue(account || { role: 'employee', status: 'active', employee_id: null });
    setEditing(account);
  }
  async function save() {
    const value = await form.validateFields();
    const payload = {
      username: value.username,
      real_name: value.real_name,
      role: value.role,
      status: value.status,
      employee_id: value.employee_id ?? null,
      ...(!editing ? { password: value.password } : {}),
    };
    try {
      await api(
        editing ? 'PUT' : 'POST',
        editing ? `/users/${editing.id}` : '/users',
        z.unknown(),
        payload,
      );
      setEditing(null);
      setRevision((x) => x + 1);
      void message.success('账号已保存');
    } catch (e) {
      void message.error(errorText(e));
    }
  }
  return (
    <>
      <h1>公司账号管理</h1>
      <Alert message="仅老板可维护。员工账号必须关联业务员工；新账号首次登录强制改密。修改权限后，已有刷新会话将撤销。" />
      <Button type="primary" onClick={() => edit(false)}>
        创建账号
      </Button>
      <Table<Account>
        rowKey="id"
        dataSource={accounts}
        columns={[
          { title: '账号', dataIndex: 'username' },
          { title: '姓名', dataIndex: 'real_name' },
          {
            title: '角色',
            dataIndex: 'role',
            render: (value) =>
              ({ boss: '老板', admin: '管理员', employee: '员工' })[value as Account['role']],
          },
          {
            title: '状态',
            dataIndex: 'status',
            render: (value) => (value === 'active' ? '启用' : '停用'),
          },
          {
            title: '操作',
            render: (_, account) => <Button onClick={() => edit(account)}>编辑权限</Button>,
          },
        ]}
      />
      <Modal
        open={editing !== null}
        title="账号资料"
        onCancel={() => setEditing(null)}
        onOk={() => void save()}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="账号" rules={[{ required: true, max: 50 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="real_name" label="姓名" rules={[{ required: true, max: 50 }]}>
            <Input />
          </Form.Item>
          {editing === false && (
            <Form.Item
              name="password"
              label="临时密码"
              rules={[
                { required: true, min: 12 },
                {
                  validator: (_, value: unknown) =>
                    typeof value === 'string' && new TextEncoder().encode(value).length <= 72
                      ? Promise.resolve()
                      : Promise.reject(new Error('密码不得超过72字节')),
                },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}
          <Form.Item name="role" label="角色">
            <Select
              options={[
                { value: 'boss', label: '老板' },
                { value: 'admin', label: '管理员' },
                { value: 'employee', label: '员工' },
              ]}
            />
          </Form.Item>
          <Form.Item name="employee_id" label="关联业务员工">
            <Select allowClear options={employees.map((x) => ({ value: x.id, label: x.name }))} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '停用' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
export function Backup({
  companyId,
  companyCode,
  userId,
  allowRestore = true,
}: {
  companyId: string;
  companyCode: string;
  userId: string;
  allowRestore?: boolean;
}) {
  const [backup, setBackup] = useState<unknown>(null);
  const [filename, setFilename] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  async function exportBackup() {
    setBusy(true);
    try {
      const data = await api('GET', '/backup/export', z.unknown());
      const saved = await ipc(
        window.desktop.saveFile(
          `${companyCode}-云端备份-${new Date().toISOString().slice(0, 10)}.json`,
          new TextEncoder().encode(JSON.stringify(data, null, 2)),
        ),
        z.boolean(),
      );
      if (saved) void message.success('备份已导出');
    } catch (e) {
      void message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    setBusy(true);
    try {
      const result = await api(
        'POST',
        '/backup/restore',
        z.object({ restored: z.literal(true), safety_backup: z.string() }),
        { backup, confirm_company_code: confirm },
      );
      await clearCache();
      setCacheScope(companyId, userId, 'boss');
      setBackup(null);
      setFilename('');
      setConfirm('');
      Modal.success({
        title: '恢复完成',
        content: `服务器已保留恢复前备份：${result.safety_backup}。请刷新业务页面查看数据。`,
      });
    } catch (e) {
      void message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>{allowRestore ? '云端备份与恢复' : '云端备份导出'}</h1>
      <Alert
        type="warning"
        showIcon
        message={
          allowRestore
            ? '恢复会替换当前公司的业务数据。账号与密码不在业务备份中；图片文件保存在服务器附件目录，JSON 不包含图片本体，请同时备份服务器附件目录。服务器恢复前必须生成安全备份。'
            : '导出当前公司业务数据。附件图片另存于服务器目录，完整备份需同时保留附件目录。'
        }
      />
      <Space direction="vertical" style={{ marginTop: 24, width: 650 }}>
        <Button loading={busy} onClick={() => void exportBackup()}>
          导出当前公司备份
        </Button>
        {allowRestore && (
          <Upload
            accept=".json,application/json"
            showUploadList={false}
            beforeUpload={(file) => {
              if (file.size > 10 * 1024 * 1024) {
                void message.error('备份文件超过10MiB，请联系运维执行离线恢复');
                return false;
              }
              void file
                .text()
                .then((text) => {
                  const value: unknown = JSON.parse(text);
                  setBackup(value);
                  setFilename(file.name);
                  setConfirm('');
                })
                .catch((e) => message.error(errorText(e)));
              return false;
            }}
          >
            <Button disabled={busy}>选择备份 JSON</Button>
          </Upload>
        )}
        {allowRestore && filename && (
          <>
            <p>待恢复：{filename}</p>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={`请输入当前公司代码 ${companyCode} 确认`}
            />
            <Button
              danger
              type="primary"
              loading={busy}
              disabled={confirm !== companyCode || !backup}
              onClick={() =>
                Modal.confirm({
                  title: `确认替换 ${companyCode} 公司的业务数据？`,
                  content: '操作将覆盖已有任务、送货单与基础资料，请确认已导出当前备份。',
                  okText: '确认恢复',
                  okButtonProps: { danger: true },
                  onOk: restore,
                })
              }
            >
              恢复此备份
            </Button>
          </>
        )}
      </Space>
    </>
  );
}
