import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrintTemplate, validatePrintTemplate } from '../electron/print-template-model';
import { defaultPrintTemplate } from '../src/default-print-template';

test('global template strips legacy company fields, accepts both historical table layouts and has one default', () => {
  const source = createPrintTemplate('global');
  const nine = validatePrintTemplate({ ...source, companyId: 'tri' });
  const eight = validatePrintTemplate({
    ...source,
    id: 'old-eight',
    companyId: 'tmy',
    table: { ...source.table, columnWeights: [5, 10, 23, 4, 7, 9, 11, 15] },
    updatedAt: '2026-09-09T12:00:00.000Z',
  });
  const newerNine = { ...nine, updatedAt: '2026-09-10T12:00:00.000Z' };
  assert.equal('companyId' in nine, false);
  assert.equal('companyId' in eight, false);
  assert.equal(
    defaultPrintTemplate([
      { ...nine, isDefault: false },
      { ...eight, isDefault: true },
    ])?.id,
    'old-eight',
  );
  assert.equal(eight.table.columnWeights.length, 8);
  assert.equal(nine.table.columnWeights.length, 9);
  assert.equal(
    defaultPrintTemplate([
      { ...newerNine, isDefault: false },
      { ...eight, isDefault: false },
    ])?.id,
    newerNine.id,
  );
});
