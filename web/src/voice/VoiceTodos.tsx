import { useRef, useState } from "react";
import { z } from "zod";
import { request } from "../api";
import { VoiceInput } from "./VoiceInput";
const valueSchema = z.object({
  title: z.string(),
  note: z.string(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  recurrence: z.enum(["once", "monthly"]).default("once"),
});
type Draft = z.infer<typeof valueSchema> & {
  key: string;
  saved: boolean;
  warnings: string[];
};
export function VoiceTodos() {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((items) =>
      items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  async function parse() {
    if (lock.current || !text.trim()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await request(
        "/ai/assistant/parse",
        z.object({
          clarification: z.string(),
          items: z.array(
            z.object({
              module: z.literal("todo"),
              value: valueSchema,
              warnings: z.array(z.string()),
            }),
          ),
        }),
        "POST",
        { text, module: "todo", supported_modules: ["todo"] },
      );
      setDrafts((items) => [
        ...items,
        ...result.items.map((item) => ({
          ...item.value,
          key: crypto.randomUUID(),
          saved: false,
          warnings: item.warnings,
        })),
      ]);
      setError(result.clarification);
      if (result.items.length) setText("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "识别失败");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(draft: Draft) {
    if (lock.current || draft.saved) return;
    if (!draft.title.trim() || !draft.starts_at || !draft.ends_at) {
      setError("请补齐事项、开始和结束时间");
      return;
    }
    if (draft.ends_at < draft.starts_at) {
      setError("结束时间不能早于开始时间");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await request("/todos", z.object({ id: z.string() }), "POST", {
        title: draft.title,
        note: draft.note,
        starts_at: draft.starts_at,
        ends_at: draft.ends_at,
        progress: 0,
        recurrence: draft.recurrence,
      });
      update(draft.key, { saved: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="voice-document">
      <h2>AI 待办事项</h2>
      <VoiceInput
        disabled={busy}
        onText={(value) =>
          setText((current) => [current, value].filter(Boolean).join("\n"))
        }
      />
      <textarea
        aria-label="待办原文"
        value={text}
        maxLength={30000}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
        placeholder="例如：添加待办，下周五前完成二楼盘点，备注铁塔奶油已盘点。"
      />
      <button
        type="button"
        disabled={busy || !text.trim()}
        onClick={() => void parse()}
      >
        识别待办草稿
      </button>
      {error && <p role="alert">{error}</p>}
      {drafts.map((draft) => (
        <fieldset key={draft.key} disabled={busy || draft.saved}>
          <legend>{draft.saved ? "已创建" : "待核对 · 未完成"}</legend>
          <label>
            事项
            <input
              value={draft.title}
              maxLength={200}
              onChange={(event) =>
                update(draft.key, { title: event.target.value })
              }
            />
          </label>
          <label>
            开始时间
            <input
              type="datetime-local"
              value={draft.starts_at?.replace(" ", "T") ?? ""}
              onChange={(event) =>
                update(draft.key, {
                  starts_at: event.target.value.replace("T", " "),
                })
              }
            />
          </label>
          <label>
            结束时间（必填）
            <input
              type="datetime-local"
              value={draft.ends_at?.replace(" ", "T") ?? ""}
              onChange={(event) =>
                update(draft.key, {
                  ends_at: event.target.value.replace("T", " "),
                })
              }
            />
          </label>
          <label>
            类型
            <select
              value={draft.recurrence}
              onChange={(event) =>
                update(draft.key, {
                  recurrence: event.target.value as "once" | "monthly",
                })
              }
            >
              <option value="once">一次性</option>
              <option value="monthly">月度</option>
            </select>
          </label>
          <label>
            备注
            <textarea
              value={draft.note}
              maxLength={2000}
              onChange={(event) =>
                update(draft.key, { note: event.target.value })
              }
            />
          </label>
          {draft.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
          <button type="button" onClick={() => void save(draft)}>
            确认创建
          </button>
        </fieldset>
      ))}
    </section>
  );
}
