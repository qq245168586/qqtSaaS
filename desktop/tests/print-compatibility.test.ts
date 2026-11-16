import test from 'node:test';
import assert from 'node:assert/strict';
import { submitPrintWithCompatibility, type SubmitPrint } from '../electron/print-job';
import { longestFittingPrefix } from '../src/print-input-limits';
test('legacy continuous paper retries 241mm only after explicit 210mm failure', async () => {
  const widths: number[] = [];
  await submitPrintWithCompatibility(
    (paper, done) => {
      widths.push(paper.width);
      done(widths.length === 2, 'unsupported');
    },
    { width: 210000, height: 140000 },
    false,
  );
  assert.deepEqual(widths, [210000, 241000]);
});
test('custom templates never retry and successful legacy jobs are not duplicated', async () => {
  let calls = 0;
  const fail: SubmitPrint = (_, done) => {
    calls++;
    done(false, 'unsupported');
  };
  await assert.rejects(
    submitPrintWithCompatibility(fail, { width: 210000, height: 140000 }, true),
    /unsupported/,
  );
  assert.equal(calls, 1);
  await submitPrintWithCompatibility(
    (_, done) => {
      calls++;
      done(true);
    },
    { width: 210000, height: 140000 },
    false,
  );
  assert.equal(calls, 2);
});
test('timed out print callback cannot submit a second job', async () => {
  let callback: ((success: boolean, reason?: string) => void) | undefined;
  let calls = 0;
  await assert.rejects(
    submitPrintWithCompatibility(
      (_, done) => {
        calls++;
        callback = done;
      },
      { width: 210000, height: 140000 },
      false,
      5,
    ),
    /超时/,
  );
  callback?.(false, 'late failure');
  assert.equal(calls, 1);
});
test('template prefix truncation preserves grapheme boundaries', () => {
  assert.equal(
    longestFittingPrefix(
      '蛋糕👨‍👩‍👧‍👦面包',
      (value) =>
        [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length <= 3,
    ),
    '蛋糕👨‍👩‍👧‍👦',
  );
});
