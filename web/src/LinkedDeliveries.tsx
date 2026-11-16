import { Button, Dialog, Tag } from "antd-mobile";
import type { Task } from "./models";
/** H5 only displays linked summaries; it has no delivery editing/printing route. */
export function LinkedDeliveries({ task }: { task: Task }) {
  const count = Math.max(task.delivery_note_count, task.delivery_notes.length);
  if (!count) return null;
  return (
    <div className="linked-deliveries">
      <Button
        size="mini"
        color="primary"
        fill="outline"
        onClick={(event) => {
          event.stopPropagation();
          void Dialog.alert({
            title: `已关联送货单（${count}）`,
            confirmText: "关闭",
            content: (
              <div className="delivery-summaries">
                {task.delivery_notes.length ? (
                  task.delivery_notes.map((note) => (
                    <section key={note.id}>
                      <strong>{note.note_number || "未编号"}</strong>
                      <p>
                        {note.delivery_date} · {note.company_name}
                      </p>
                      <Tag color={note.is_draft ? "warning" : "success"}>
                        {note.is_draft ? "草稿" : "正式单"}
                      </Tag>
                    </section>
                  ))
                ) : (
                  <p>送货单摘要暂不可用，请刷新任务后重试。</p>
                )}
                <p className="hint">
                  网页仅查看摘要，开单与打印请在 App 中操作。
                </p>
              </div>
            ),
          });
        }}
      >
        已关联送货单（{count}）
      </Button>
    </div>
  );
}
