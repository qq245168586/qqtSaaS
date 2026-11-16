import { expect, test } from "@playwright/test";
const user = {
  id: "1",
  company_id: "1",
  company_code: "tri",
  username: "test",
  real_name: "测试管理员",
  role: "boss",
  must_change_password: false,
};
const task = {
  id: "1",
  title: "手机茶歇任务",
  content: "准备茶歇",
  source_text: "准备茶歇",
  department_id: "1",
  assignee_employee_id: "1",
  category_id: "1",
  status: "waiting_ship",
  priority: "normal",
  expected_delivery_at: "2026-09-23 15:00",
  task_type: "order",
  note: "",
  department_name: "蛋糕部",
  assignee_name: "测试员工",
  category_name: "茶歇",
};
test("手机登录、全部分类、分钟详情、AI人工分配并保存", async ({ page }) => {
  let loggedIn = false;
  let created = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = null;
    let status = 200;
    if (path === "/api/auth/access-mode") data = { public_access: false };
    else if (path === "/api/auth/refresh") {
      if (loggedIn) data = { access_token: "test", user };
      else status = 401;
    } else if (path === "/api/auth/login") {
      loggedIn = true;
      data = { access_token: "test", user };
    } else if (path === "/api/departments")
      data = {
        items: [{ id: "1", name: "蛋糕部" }],
        total: 1,
        page: 1,
        page_size: 100,
      };
    else if (path === "/api/employees")
      data = {
        items: [
          { id: "1", name: "测试员工", department_id: "1", status: "active" },
        ],
        total: 1,
        page: 1,
        page_size: 100,
      };
    else if (path === "/api/categories")
      data = {
        items: [{ id: "1", name: "茶歇" }],
        total: 1,
        page: 1,
        page_size: 100,
      };
    else if (path === "/api/tasks" && route.request().method() === "POST") {
      created = true;
      data = { ...task, ...route.request().postDataJSON() };
    } else if (path === "/api/tasks") {
      const query = new URL(route.request().url()).searchParams;
      if (query.get("page_size") === "1") {
        const total =
          query.get("status") === "todo"
            ? 43
            : query.get("status") === "waiting_ship"
              ? 1
              : 0;
        data = { items: [], total, page: 1, page_size: 1 };
      } else data = { items: [task], total: 44, page: 1, page_size: 20 };
    } else if (path === "/api/tasks/1/images")
      data = { items: [], total: 0, page: 1, page_size: 12 };
    else if (path === "/api/ai/parse")
      data = {
        items: [
          {
            title: "AI茶歇",
            content: "下午茶歇",
            source_text: "明天下午",
            category_id: "1",
            department_id: "1",
            assignee_employee_id: "1",
            priority: "normal",
            expected_delivery_at: "2026-09-23 15:00",
            task_type: "order",
            note: "",
          },
        ],
      };
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({
        code: status === 200 ? 0 : 401,
        message: status === 200 ? "ok" : "未登录",
        data,
      }),
    });
  });
  await page.goto("/h5/");
  await page.getByLabel("账号", { exact: true }).fill("test");
  await page.getByLabel("密码", { exact: true }).fill("not-a-real-password");
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(page.getByRole("heading", { name: "任务汇总" })).toBeVisible();
  await expect(page.getByLabel("业务分类")).toHaveValue("");
  await expect(
    page.getByLabel("业务分类").locator("option").first(),
  ).toHaveText("全部");
  await page.getByRole("button", { name: "切换看板" }).click();
  await expect(
    page.getByRole("heading", { name: "未开始 · 43" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "每列总数来自当前筛选的全部任务；卡片按分页加载。已加载 1 / 44 项。",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "切换列表" }).click();
  await page.getByRole("heading", { name: "手机茶歇任务" }).click();
  await expect(
    page.getByText("2026-09-23 15:00", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "已发货", exact: true }),
  ).toBeVisible();
  await page.locator(".adm-nav-bar-back").click();
  await page.getByText("AI 录入", { exact: true }).click();
  await page.getByLabel("微信群订单文本").fill("明天下午准备茶歇");
  await page.getByRole("button", { name: "识别订单" }).click();
  await expect(page.getByLabel("部门", { exact: true })).toHaveValue("1");
  await expect(page.getByLabel("执行人", { exact: true })).toHaveValue("1");
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(page.getByText("任务已保存", { exact: true })).toBeVisible();
  expect(created).toBe(true);
  await expect(page.getByText("待确认 1", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "test-results/mobile-workspace.png",
    fullPage: true,
  });
});

test("员工账号只读自身任务，不加载管理资料", async ({ page }) => {
  const managementRequests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (
      ["/api/departments", "/api/employees", "/api/categories"].includes(path)
    )
      managementRequests.push(path);
    const data =
      path === "/api/auth/access-mode"
        ? { public_access: false }
        : path === "/api/auth/refresh"
          ? {
              access_token: "employee-test",
              user: { ...user, role: "employee" },
            }
          : path === "/api/tasks"
            ? { items: [], total: 0, page: 1, page_size: 20 }
            : { status: "ok" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, message: "ok", data }),
    });
  });
  await page.goto("/h5/");
  await expect(page.getByRole("heading", { name: "任务汇总" })).toBeVisible();
  await expect(
    page.getByText("没有符合条件的任务", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("资料", { exact: true })).toHaveCount(0);
  await expect(page.getByText("AI 录入", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "＋ 新建" })).toHaveCount(0);
  expect(managementRequests).toEqual([]);
});

test("公开共享工作台自动进入、两公司任务与单内公司选择", async ({ page }) => {
  let enters = 0;
  let refreshes = 0;
  let expire = false;
  let createdCompany = "";
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = null;
    let status = 200;
    if (path === "/api/auth/access-mode") data = { public_access: true };
    else if (path === "/api/auth/enter") {
      enters++;
      const body: unknown = route.request().postDataJSON();
      expect(body).toEqual({ client: "web" });
      data = {
        access_token: `public-${enters}`,
        user: { ...user, company_code: "tmy", public_access: true },
      };
    } else if (path === "/api/auth/refresh") {
      refreshes++;
      status = 401;
    } else if (path === "/api/companies")
      data = {
        items: [
          { id: "1", code: "tri", name: "趣趣特" },
          { id: "2", code: "tmy", name: "天美意" },
        ],
        total: 2,
        page: 1,
        page_size: 100,
      };
    else if (path === "/api/departments")
      data = {
        items: [
          { id: "1", name: "共享部门", company_id: "1", company_code: "tri" },
        ],
        total: 1,
        page: 1,
        page_size: 100,
      };
    else if (path === "/api/employees")
      data = {
        items: [
          {
            id: "1",
            name: "共享员工",
            company_id: "1",
            department_id: "1",
            status: "active",
          },
        ],
        total: 1,
        page: 1,
        page_size: 100,
      };
    else if (path === "/api/categories")
      data = { items: [], total: 0, page: 1, page_size: 100 };
    else if (path === "/api/tasks" && route.request().method() === "POST") {
      const body: unknown = route.request().postDataJSON();
      if (body && typeof body === "object" && "company_code" in body)
        createdCompany = String(body.company_code);
      data = { ...task, company_code: createdCompany };
    } else if (path === "/api/tasks" && expire) {
      expire = false;
      status = 401;
    } else if (path === "/api/tasks")
      data = {
        items: [
          { ...task, id: "1", title: "趣趣特订单", company_code: "tri" },
          { ...task, id: "2", title: "天美意订单", company_code: "tmy" },
        ],
        total: 2,
        page: 1,
        page_size: 20,
      };
    else data = { status: "ok" };
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({
        code: status === 200 ? 0 : 401,
        message: "ok",
        data,
      }),
    });
  });
  await page.goto("/h5/");
  await expect(page.getByRole("heading", { name: "任务汇总" })).toBeVisible();
  await expect(page.getByLabel("账号", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("所属公司", { exact: true })).toHaveCount(0);
  await expect(page.getByText("我的", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "趣趣特订单" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "天美意订单" })).toBeVisible();
  await page.getByRole("button", { name: "＋ 新建" }).click();
  await expect(page.getByLabel("订单所属公司")).toHaveValue("tmy");
  await page.getByLabel("订单所属公司").selectOption("tri");
  await page.getByLabel("任务标题", { exact: true }).fill("跨公司工作台测试");
  await page
    .locator(".sheet")
    .getByLabel("部门", { exact: true })
    .selectOption("1");
  await page
    .locator(".sheet")
    .getByLabel("执行人", { exact: true })
    .selectOption("1");
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(page.locator(".sheet")).toHaveCount(0);
  expect(createdCompany).toBe("tri");
  expire = true;
  await page.getByLabel("搜索任务").fill("测试刷新");
  await expect.poll(() => enters).toBe(2);
  expect(refreshes).toBe(0);
});

test("网页固定密码入口：无账号公司选择、错误提示与到期重输", async ({
  page,
}) => {
  let attempts = 0;
  let refreshes = 0;
  let expire = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = null;
    let status = 200;
    let message = "ok";
    if (path === "/api/auth/access-mode")
      data = { public_access: true, web_password_required: true };
    else if (path === "/api/auth/enter") {
      attempts++;
      const body: unknown = route.request().postDataJSON();
      if (
        !body ||
        typeof body !== "object" ||
        !("password" in body) ||
        body.password !== "only-test-password"
      ) {
        status = 401;
        message = "访问密码错误";
      } else
        data = {
          access_token: "fixed-password-test",
          user: { ...user, public_access: true },
        };
    } else if (path === "/api/auth/refresh") {
      refreshes++;
      status = 401;
    } else if (path === "/api/tasks" && expire) {
      status = 401;
      message = "过期";
    } else if (
      [
        "/api/tasks",
        "/api/companies",
        "/api/departments",
        "/api/employees",
        "/api/categories",
      ].includes(path)
    )
      data = { items: [], total: 0, page: 1, page_size: 20 };
    else data = { status: "ok" };
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ code: status === 200 ? 0 : 401, message, data }),
    });
  });
  await page.goto("/h5/");
  await expect(page.getByLabel("访问密码", { exact: true })).toBeVisible();
  expect(attempts).toBe(0);
  await expect(page.getByLabel("账号", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("所属公司", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("访问密码", { exact: true })
    .fill("wrong-test-password");
  await page.getByRole("button", { name: "进入工作台", exact: true }).click();
  await expect(page.getByText("访问密码错误", { exact: true })).toBeVisible();
  await expect(page.getByLabel("访问密码", { exact: true })).toHaveValue("");
  await page.getByLabel("访问密码", { exact: true }).fill("only-test-password");
  await page.getByRole("button", { name: "进入工作台", exact: true }).click();
  await expect(page.getByRole("heading", { name: "任务汇总" })).toBeVisible();
  expire = true;
  await page.getByLabel("搜索任务").fill("到期测试");
  await expect(page.getByLabel("访问密码", { exact: true })).toBeVisible();
  await expect(page.getByLabel("访问密码", { exact: true })).toHaveValue("");
  expect(attempts).toBe(2);
  expect(refreshes).toBe(0);
});

test("任务汇总关联送货单弹窗及AI公司建议人工修改", async ({ page }) => {
  let saved: unknown = null;
  let uploadedImages = 0;
  const linked = [
    {
      id: "10",
      source_task_id: "1",
      note_number: "TRI260923001",
      delivery_date: "2026-09-23",
      is_draft: 0,
      company_code: "tri",
      company_name: "趣趣特",
    },
    {
      id: "11",
      source_task_id: "1",
      note_number: null,
      delivery_date: "2026-09-24",
      is_draft: 1,
      company_code: "tri",
      company_name: "趣趣特",
    },
  ];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { status: "ok" };
    if (path === "/api/auth/access-mode") data = { public_access: true };
    else if (path === "/api/auth/enter")
      data = { access_token: "test", user: { ...user, public_access: true } };
    else if (path === "/api/companies")
      data = {
        items: [
          { id: "1", code: "tri", name: "趣趣特" },
          { id: "2", code: "tmy", name: "天美意" },
        ],
        total: 2,
        page: 1,
        page_size: 100,
      };
    else if (path === "/api/departments")
      data = {
        items: [
          { id: "1", name: "蛋糕部", company_code: "tri" },
          { id: "2", name: "蛋糕部门", company_code: "tmy" },
        ],
        total: 2,
        page: 1,
        page_size: 100,
      };
    else if (path === "/api/employees")
      data = {
        items: [
          {
            id: "1",
            name: "趣趣特执行员工",
            company_code: "tri",
            department_id: "1",
            status: "active",
          },
          {
            id: "2",
            name: "天美意执行员工",
            company_code: "tmy",
            department_id: "2",
            status: "active",
          },
        ],
        total: 2,
        page: 1,
        page_size: 100,
      };
    else if (path === "/api/categories")
      data = { items: [], total: 0, page: 1, page_size: 100 };
    else if (path === "/api/tasks" && route.request().method() === "POST") {
      saved = route.request().postDataJSON() as unknown;
      data = { ...task, id: "2", company_code: "tmy" };
    } else if (
      path === "/api/tasks/2/images" &&
      route.request().method() === "POST"
    ) {
      uploadedImages++;
      data = { id: "20" };
    } else if (path === "/api/tasks")
      data = {
        items: [
          {
            ...task,
            company_code: "tri",
            delivery_note_count: 2,
            delivery_notes: linked,
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      };
    else if (path === "/api/tasks/1/images")
      data = { items: [], total: 0, page: 1, page_size: 12 };
    else if (path === "/api/ai/parse")
      data = {
        items: [
          {
            title: "公司识别草稿",
            content: "共享茶歇订单",
            source_text: "原始订单文本",
            company_code: "tri",
            company_match: {
              source: "learned",
              reason: "命中此前人工确认的公司归属",
              confidence: 0.9,
              keyword: "茶歇",
              sample_count: 4,
              agreement: 1,
            },
            department_id: "1",
            assignee_employee_id: "1",
            category_id: null,
            priority: "normal",
            task_type: "order",
            expected_delivery_at: null,
            note: "",
          },
        ],
      };
    else if (path === "/api/assignee-suggestions") {
      const body = route.request().postDataJSON() as {
        department_id: string;
      };
      data = {
        employee_id: body.department_id === "2" ? "2" : "1",
        reason: "该业务历史任务默认执行人",
        source: "history",
        sample_count: 3,
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, message: "ok", data }),
    });
  });
  await page.goto("/h5/");
  await expect(page.getByRole("heading", { name: "任务汇总" })).toBeVisible();
  await page.getByRole("button", { name: "已关联送货单（2）" }).click();
  await expect(page.getByText("TRI260923001", { exact: true })).toBeVisible();
  await expect(
    page.getByText("2026-09-24 · 趣趣特", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("草稿", { exact: true })).toBeVisible();
  await expect(page.locator(".sheet")).toHaveCount(0);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("heading", { name: "手机茶歇任务" }).click();
  await page
    .locator(".sheet")
    .getByRole("button", { name: "已关联送货单（2）" })
    .click();
  await expect(page.getByText("正式单", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator(".adm-nav-bar-back").click();
  await page.getByText("AI 录入", { exact: true }).click();
  await page.getByLabel("微信群订单文本").fill("共享茶歇订单");
  await page.getByRole("button", { name: "识别订单" }).click();
  await expect(page.getByRole("note")).toContainText(
    "命中此前人工确认的公司归属",
  );
  await expect(page.getByLabel("订单所属公司")).toHaveValue("tri");
  await expect(page.getByLabel("执行人", { exact: true })).toHaveValue("1");
  await page.getByLabel("订单所属公司").selectOption("tmy");
  await page.getByLabel("部门", { exact: true }).selectOption("2");
  await expect(page.getByLabel("执行人", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(
    page.getByText("AI任务必须填写预计交付日期和时间", { exact: true }),
  ).toBeVisible();
  expect(saved).toBeNull();
  await page
    .getByLabel("预计交付时间（必填，精确到分钟）")
    .fill("2026-09-28T09:00");
  await page.getByLabel("添加图片附件").setInputFiles({
    name: "clipboard.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGOUTPFmYGBgYgADAAlYAMyUEbzgAAAAAElFTkSuQmCC",
      "base64",
    ),
  });
  await expect(page.getByAltText("clipboard.png")).toBeVisible();
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(page.getByText("任务已保存", { exact: true })).toBeVisible();
  expect(uploadedImages).toBe(1);
  expect(
    saved !== null &&
      typeof saved === "object" &&
      "company_code" in saved &&
      saved.company_code === "tmy",
  ).toBe(true);
  expect(
    saved !== null && typeof saved === "object" && "company_match" in saved,
  ).toBe(false);
});
