import { useEffect, useRef, useState } from 'react';
import { AutoComplete, Form, type FormInstance } from 'antd';
import { api, errorText } from './api';
import { channelSuggestionsSchema, type TaskInput } from './contracts';

export function OrderChannelField({
  form,
  existing,
}: {
  form: FormInstance<TaskInput>;
  existing: boolean;
}) {
  const [options, setOptions] = useState(['微信', '小程序', '小红书', '大众点评']);
  const [error, setError] = useState('');
  const touched = useRef(false);
  useEffect(() => {
    let active = true;
    void api('GET', '/tasks/order-channels', channelSuggestionsSchema)
      .then((result) => {
        if (!active) return;
        setOptions(result.items.map((item) => item.name));
        if (!existing && !touched.current && !form.getFieldValue('order_channel'))
          form.setFieldValue('order_channel', result.default_channel);
      })
      .catch((err) => {
        if (active) setError(`历史渠道加载失败，可手动填写：${errorText(err)}`);
      });
    return () => {
      active = false;
    };
  }, [form, existing]);
  return (
    <Form.Item
      name="order_channel"
      label="下单渠道"
      rules={[
        {
          required: !existing,
          whitespace: true,
          max: 50,
          message: '请选择或输入下单渠道（最多50字）',
        },
      ]}
      extra={error || undefined}
      normalize={(value: string) => value.trim() || null}
    >
      <AutoComplete
        aria-label="下单渠道"
        options={options.map((value) => ({ value }))}
        maxLength={50}
        placeholder="选择或输入，如微信、小程序"
        allowClear
        filterOption={(input, option) =>
          (option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())
        }
        onChange={() => {
          touched.current = true;
        }}
      />
    </Form.Item>
  );
}
