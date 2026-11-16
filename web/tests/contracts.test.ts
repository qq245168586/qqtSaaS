import { describe, expect, it } from "vitest";
import { emptyTask, nextStatuses, taskFields, userSchema } from "../src/models";
describe("任务约束", () => {
  it("已发货必须在已交付之前；已取消不能重开", () => {
    expect(nextStatuses("waiting_ship")).toEqual(["shipped", "canceled"]);
    expect(nextStatuses("shipped")).toEqual(["delivered", "canceled"]);
    expect(nextStatuses("canceled")).toEqual([]);
  });
  it("拒绝仅日期和未选部门员工；接受精确分钟", () => {
    const input = {
      ...emptyTask(),
      title: "订单",
      department_id: "1",
      assignee_employee_id: "2",
    };
    expect(
      taskFields.safeParse({ ...input, expected_delivery_at: "2026-09-22" })
        .success,
    ).toBe(false);
    expect(
      taskFields.safeParse({
        ...input,
        expected_delivery_at: "2026-09-22 15:30",
      }).success,
    ).toBe(true);
    expect(
      taskFields.safeParse({ ...input, assignee_employee_id: "" }).success,
    ).toBe(false);
    expect(
      taskFields.safeParse({
        ...input,
        expected_delivery_at: "2026-02-30 25:70",
      }).success,
    ).toBe(false);
  });
  it("BIGINT主键必须字符串，初始密码标记数值规范化", () => {
    const user = {
      id: "9007199254740999",
      company_id: "1",
      company_code: "tri",
      username: "user",
      real_name: "测试",
      role: "boss",
      must_change_password: 1,
    };
    expect(userSchema.parse(user).must_change_password).toBe(true);
    expect(userSchema.safeParse({ ...user, id: 123 }).success).toBe(false);
  });
});

describe("AI公司建议与关联送货单合同", () => {
  it("接收匹配依据，保存仅保留最终公司而不发送学习元数据", async () => {
    const { draftSchema, taskFields, emptyTask } =
      await import("../src/models");
    const draft = draftSchema.parse({
      ...emptyTask(),
      title: "茶歇",
      company_code: "tri",
      department_id: "1",
      assignee_employee_id: "2",
      company_match: {
        source: "learned",
        reason: "历史人工纠正记录",
        confidence: 0.9,
        keyword: "茶歇",
        sample_count: 4,
        agreement: 1,
      },
    });
    const payload = taskFields.parse({
      ...draft,
      company_code: "tmy",
      department_id: "1",
      assignee_employee_id: "2",
      status: "todo",
    });
    expect(draft.company_code).toBe("tri");
    expect(draft.assignee_employee_id).toBe("2");
    expect(payload.company_code).toBe("tmy");
    expect("company_match" in payload).toBe(false);
  });
  it("拒绝损坏的匹配置信度", async () => {
    const { companyMatchSchema } = await import("../src/models");
    expect(
      companyMatchSchema.safeParse({
        source: "learned",
        reason: "原因",
        confidence: 2,
        keyword: null,
        sample_count: 1,
        agreement: 1,
      }).success,
    ).toBe(false);
  });
  it("送货单摘要保留大整数ID和草稿，旧任务兼容无摘要", async () => {
    const { taskSchema, emptyTask } = await import("../src/models");
    const base = {
      ...emptyTask(),
      id: "1",
      title: "测试",
      department_id: "1",
      assignee_employee_id: "2",
    };
    expect(taskSchema.parse(base).delivery_notes).toEqual([]);
    const parsed = taskSchema.parse({
      ...base,
      delivery_note_count: 1,
      delivery_notes: [
        {
          id: "9007199254740993",
          source_task_id: "1",
          note_number: null,
          delivery_date: "2026-09-23",
          is_draft: 1,
          company_code: "tri",
          company_name: "趣趣特",
        },
      ],
    });
    expect(parsed.delivery_notes[0]?.id).toBe("9007199254740993");
    expect(parsed.delivery_notes[0]?.is_draft).toBe(1);
  });
});
