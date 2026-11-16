import { useEffect, useState } from 'react';
import { Form, Select, message } from 'antd';
import { z } from 'zod';
import { api, errorText } from './api';
import { pageSchema } from './contracts';
import type { CompanyId } from './types';
const companySchema = z.object({ id: z.string(), code: z.enum(['tri', 'tmy']), name: z.string() });
export function CompanySelect({
  value,
  onChange,
  disabled,
}: {
  value?: CompanyId;
  onChange?: (value: CompanyId) => void;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<z.infer<typeof companySchema>[]>([]);
  useEffect(() => {
    void api('GET', '/companies?page_size=100', pageSchema(companySchema))
      .then((data) => setItems(data.items))
      .catch((error) => message.error(errorText(error)));
  }, []);
  return (
    <Select
      aria-label="单据公司"
      value={value}
      onChange={onChange}
      disabled={disabled}
      style={{ minWidth: 200 }}
      options={items.map((item) => ({ value: item.code, label: item.name }))}
    />
  );
}
export function CompanyField({ disabled = false }: { disabled?: boolean }) {
  return (
    <Form.Item name="company_code" label="单据公司" rules={[{ required: true }]}>
      <CompanySelect disabled={disabled} />
    </Form.Item>
  );
}
