import { z } from 'zod';
import { api } from '../api';
export const documentSchema = z.object({
  title: z.string(),
  sections: z.array(z.object({ heading: z.string(), text: z.string() })),
});
export type DocumentDraft = z.infer<typeof documentSchema>;
export const speechStatus = () =>
  api('GET', '/ai/voice/status', z.object({ available: z.boolean(), message: z.string() }));
export const transcribe = (blob: Blob) => {
  const body = new FormData();
  body.append('file', blob, 'voice.wav');
  return api('POST', '/ai/voice/transcribe', z.object({ text: z.string() }), body);
};
export const prepareDocument = (text: string, style: 'memo' | 'document') =>
  api('POST', '/ai/voice/document', documentSchema, { text, style });
