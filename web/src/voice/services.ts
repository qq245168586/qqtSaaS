import { z } from "zod";
import { request, upload } from "../api";
export const documentSchema = z.object({
  title: z.string(),
  sections: z.array(z.object({ heading: z.string(), text: z.string() })),
});
export type DocumentDraft = z.infer<typeof documentSchema>;
export const speechStatus = () =>
  request(
    "/ai/voice/status",
    z.object({ available: z.boolean(), message: z.string() }),
  );
export const transcribe = (blob: Blob) => {
  const body = new FormData();
  body.append("file", blob, "voice.wav");
  return upload("/ai/voice/transcribe", z.object({ text: z.string() }), body);
};
export const prepareDocument = (text: string, style: "memo" | "document") =>
  request("/ai/voice/document", documentSchema, "POST", { text, style });
