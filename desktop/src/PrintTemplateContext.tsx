import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { validatePrintTemplate, type PrintTemplate } from '../electron/print-template-model';
import { api, errorText } from './api';
import { pageSchema } from './contracts';
import { defaultPrintTemplate } from './default-print-template';
interface TemplateState {
  templates: PrintTemplate[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  save: (t: PrintTemplate) => Promise<PrintTemplate>;
  remove: (id: string) => Promise<void>;
}
const Context = createContext<TemplateState | null>(null);
const row = z.object({
  id: z.string(),
  name: z.string(),
  is_default: z.union([z.boolean(), z.number()]),
  config_json: z.unknown(),
});
export function PrintTemplateProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = async () => {
    if (!enabled) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const items: z.infer<typeof row>[] = [];
      for (let current = 1; ; current++) {
        const page = await api(
          'GET',
          `/print-templates?page=${current}&page_size=100`,
          pageSchema(row),
        );
        items.push(...page.items);
        if (!page.items.length || items.length >= page.total) break;
      }
      setTemplates(
        items.map((item) =>
          validatePrintTemplate({
            ...z.record(z.string(), z.unknown()).parse(item.config_json),
            id: item.id,
            name: item.name,
            isDefault: Boolean(item.is_default),
          }),
        ),
      );
      setError('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, [enabled]);
  return (
    <Context.Provider
      value={{
        templates,
        loading,
        error,
        refresh,
        save: async (t) => {
          const validated = validatePrintTemplate(t);
          const exists = templates.some((x) => x.id === t.id);
          const result = await api(
            exists ? 'PUT' : 'POST',
            exists ? `/print-templates/${t.id}` : '/print-templates',
            row,
            {
              name: t.name,
              is_default: t.isDefault,
              config_json: validated,
            },
          );
          const saved = { ...validated, id: result.id };
          await refresh();
          return saved;
        },
        remove: async (id) => {
          await api('DELETE', `/print-templates/${id}`, z.unknown());
          await refresh();
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function usePrintTemplates() {
  const value = useContext(Context);
  if (!value) throw new Error('Missing PrintTemplateProvider');
  return value;
}
export function useDefaultPrintTemplate() {
  return defaultPrintTemplate(usePrintTemplates().templates);
}
