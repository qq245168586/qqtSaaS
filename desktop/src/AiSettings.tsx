import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, message } from 'antd';
import { z } from 'zod';
import { api, errorText } from './api';
import { useAppState } from './store';

const aiConfigSchema = z.object({
  api_base_url: z.string(),
  model_name: z.string(),
  api_key_configured: z.boolean(),
  source: z.enum(['company', 'server']),
});

type AiConfig = z.infer<typeof aiConfigSchema>;
type AiForm = {
  api_base_url: string;
  api_key?: string;
  model_name: string;
  admin_password?: string;
};

export function AiSettings() {
  const [form] = Form.useForm<AiForm>();
  const publicAccess = Boolean(useAppState().session?.user.public_access);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<AiConfig | null>(null);

  async function load() {
    try {
      const current = await api('GET', '/ai/config', aiConfigSchema);
      setConfig(current);
      form.setFieldsValue({
        api_base_url: current.api_base_url,
        model_name: current.model_name,
        api_key: '',
      });
    } catch (error) {
      void message.error(errorText(error));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(test = false) {
    const values = await form.validateFields();
    setBusy(true);
    try {
      const updated = await api('PUT', '/ai/config', aiConfigSchema, {
        api_base_url: values.api_base_url,
        model_name: values.model_name,
        ...(values.api_key?.trim() ? { api_key: values.api_key.trim() } : {}),
        ...(publicAccess ? { admin_password: values.admin_password } : {}),
      });
      setConfig(updated);
      form.setFieldValue('api_key', '');
      if (test) {
        await api('POST', '/ai/config/test', z.object({ available: z.literal(true) }), {
          ...(publicAccess ? { admin_password: values.admin_password } : {}),
        });
        void message.success('连接成功，AI 服务可用');
      } else {
        void message.success('AI 配置已保存');
      }
    } catch (error) {
      void message.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE IT YOUR WORKSPACE</span>
          <h1>AI 模型设置</h1>
          <p>连接 AI 服务，用原来的配置方式解析订单。</p>
        </div>
      </div>
      <div className="settings-grid">
        <Card title="AI 服务配置">
          <p className="muted">支持 OpenAI 兼容接口。解析时，订单原文将发送到此服务。</p>
          <Form form={form} layout="vertical" onFinish={() => void save()}>
            <Form.Item
              name="api_base_url"
              label="API Base URL"
              rules={[
                { required: true, message: '请输入 API 地址' },
                { type: 'url', message: '请输入完整的 HTTPS 地址' },
              ]}
            >
              <Input placeholder="https://api.deepseek.com/v1" />
            </Form.Item>
            <Form.Item name="api_key" label="API Key">
              <Input.Password
                placeholder={config?.api_key_configured ? '已配置；留空表示不修改' : '输入服务密钥'}
                autoComplete="off"
              />
            </Form.Item>
            <Form.Item
              name="model_name"
              label="模型名称"
              rules={[{ required: true, whitespace: true, message: '请输入模型名称' }]}
            >
              <Input placeholder="deepseek-chat" />
            </Form.Item>
            {publicAccess && (
              <Form.Item
                name="admin_password"
                label="管理密码"
                extra="使用网页工作台的固定密码确认修改。"
                rules={[{ required: true, message: '请输入管理密码' }]}
              >
                <Input.Password autoComplete="off" />
              </Form.Item>
            )}
            <Space>
              <Button type="primary" htmlType="submit" loading={busy}>
                保存配置
              </Button>
              <Button loading={busy} onClick={() => void save(true)}>
                保存并测试连接
              </Button>
            </Space>
          </Form>
        </Card>
        <div>
          <Alert
            type="info"
            showIcon
            message="配置保存在服务器"
            description={`API Key 加密保存且不会回显。当前使用${config?.source === 'company' ? '已保存配置' : '服务器默认配置'}。`}
          />
          <Alert
            style={{ marginTop: 20 }}
            type="success"
            showIcon
            message="订单解析规则已优化"
            description="同一客户同一次交付的多行商品合并为一张任务单；布丁、蛋糕、糕点等默认匹配趣趣特。"
          />
        </div>
      </div>
    </>
  );
}
