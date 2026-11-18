import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVoiceWav, documentDraftInput, documentDraftOutput } from '../src/voice';
import { enforceWikiAccess } from '../src/public-access';
function wav(seconds = 1): Buffer {
  const value = Buffer.alloc(44 + 32000 * seconds);
  value.write('RIFF');
  value.writeUInt32LE(value.length - 8, 4);
  value.write('WAVE', 8);
  value.write('fmt ', 12);
  value.writeUInt32LE(16, 16);
  value.writeUInt16LE(1, 20);
  value.writeUInt16LE(1, 22);
  value.writeUInt32LE(16000, 24);
  value.writeUInt32LE(32000, 28);
  value.writeUInt16LE(2, 32);
  value.writeUInt16LE(16, 34);
  value.write('data', 36);
  value.writeUInt32LE(value.length - 44, 40);
  return value;
}
test('ASR accepts bounded 16k mono PCM only; rejects spoofed, truncated and long audio', () => {
  assert.doesNotThrow(() => validateVoiceWav(wav(120)));
  for (const sample of [Buffer.from('not audio'), wav(121), wav().subarray(0, 100)])
    assert.throws(() => validateVoiceWav(sample));
  const stereo = wav();
  stereo.writeUInt16LE(2, 22);
  assert.throws(() => validateVoiceWav(stereo));
});
test('Wiki can only use the three voice draft endpoints, not assistant/task writes', () => {
  for (const path of ['/api/ai/voice/status', '/api/ai/voice/transcribe', '/api/ai/voice/document'])
    assert.doesNotThrow(() => enforceWikiAccess(true, path));
  for (const path of [
    '/api/ai/assistant/parse',
    '/api/tasks',
    '/api/ai/voice/document/1',
    '/api/ai/config',
  ])
    assert.throws(() => enforceWikiAccess(true, path));
});
test('Document drafts reject empty input and unstructured model output', () => {
  assert.equal(documentDraftInput.safeParse({ text: ' ', style: 'memo' }).success, false);
  assert.equal(documentDraftOutput.safeParse({ title: '会议', sections: [] }).success, false);
  assert.equal(
    documentDraftOutput.safeParse({
      title: '会议',
      sections: [{ heading: '安排', text: '明天盘点' }],
    }).success,
    true,
  );
});
