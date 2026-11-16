import type { PrintTemplate } from '../electron/print-template-model';
// Match the original delivery app: the newest saved template remains usable
// even when an older database did not persist the is_default column correctly.
export function defaultPrintTemplate(templates: PrintTemplate[]): PrintTemplate | null {
  const ordered = [...templates].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
  return ordered.find((template) => template.isDefault) ?? ordered[0] ?? null;
}
