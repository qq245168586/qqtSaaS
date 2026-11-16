import type { PrintTemplate } from '../electron/print-template-model';

/** Use the calibrated 210 mm Windows driver page when all template content fits. */
export function printPageWidth(template: PrintTemplate | null): number {
  if (!template) return 210;
  const contentRight = Math.max(
    0,
    ...Object.values(template.elements).map(
      (element) => template.margins.left + element.x + element.width,
    ),
  );
  const needed = Math.ceil((contentRight + template.margins.right) * 100) / 100;
  return Math.min(template.paper.width, Math.max(210, needed));
}
