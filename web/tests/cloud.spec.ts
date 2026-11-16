import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { z } from "zod";
test.skip(process.env.CLOUD_E2E !== "1", "仅用户明确授权时运行只读云端验证");
async function openWorkspace(
  page: Page,
  company: "tri" | "tmy",
  verifyWrongPassword = false,
) {
  const response = await page.request.get("/api/auth/access-mode");
  const mode = z
    .object({
      data: z.object({
        public_access: z.boolean(),
        web_password_required: z.boolean().default(false),
      }),
    })
    .parse((await response.json()) as unknown).data;
  await page.goto("/h5/");
  if (!mode.public_access) {
    const secrets = z
      .object({
        app_username: z.string(),
        app_passwords: z.object({ tri: z.string(), tmy: z.string() }),
      })
      .parse(
        JSON.parse(
          await readFile(
            new URL("../../.local-secrets/cloud-handoff.json", import.meta.url),
            "utf8",
          ),
        ) as unknown,
      );
    await page.getByLabel("所属公司").selectOption(company);
    await page.getByLabel("账号", { exact: true }).fill(secrets.app_username);
    await page
      .getByLabel("密码", { exact: true })
      .fill(secrets.app_passwords[company]);
    await page.getByRole("button", { name: "登录工作台" }).click();
  }
  if (mode.public_access && mode.web_password_required) {
    await expect(page.getByLabel("访问密码", { exact: true })).toBeVisible();
    await expect(page.getByLabel("账号", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("所属公司", { exact: true })).toHaveCount(0);
    if (verifyWrongPassword) {
      await page
        .getByLabel("访问密码", { exact: true })
        .fill("deliberately-wrong-e2e-password");
      await page
        .getByRole("button", { name: "进入工作台", exact: true })
        .click();
      await expect(
        page.getByText("网页访问密码错误", { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("访问密码", { exact: true })).toHaveValue(
        "",
      );
    }
    const config = z
      .object({ password: z.string() })
      .parse(
        JSON.parse(
          await readFile(
            new URL("../../.local-secrets/web-access.json", import.meta.url),
            "utf8",
          ),
        ) as unknown,
      );
    await page.getByLabel("访问密码", { exact: true }).fill(config.password);
    await page.getByRole("button", { name: "进入工作台", exact: true }).click();
  }
  try {
    await page
      .getByRole("heading", { name: "任务汇总" })
      .waitFor({ timeout: 15000 });
  } finally {
    const field = page.getByLabel(mode.public_access ? "访问密码" : "密码", {
      exact: true,
    });
    if (await field.isVisible()) await field.fill("");
  }
  if (mode.public_access) {
    await expect(page.getByLabel("账号", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("所属公司", { exact: true })).toHaveCount(0);
    await expect(page.locator("header")).toContainText("共享任务工作台");
  }
}
test("真实指定实例：工作台及任务部门员工分类只读查看", async ({ page }) => {
  await openWorkspace(page, "tri", true);
  await expect(
    page.getByLabel("业务分类").locator("option").first(),
  ).toHaveText("全部");
  await page.getByRole("button", { name: "切换看板" }).click();
  await expect(page.getByRole("button", { name: "切换列表" })).toBeVisible();
  await page.getByRole("button", { name: "切换列表" }).click();
  await page.getByText("资料", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "基础资料" })).toBeVisible();
  await page.getByLabel("管理内容").selectOption("employees");
  await expect(page.getByRole("heading", { name: "新增资料" })).toBeVisible();
  await page.getByLabel("管理内容").selectOption("categories");
  await expect(
    page.getByText("定制蛋糕", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("茶歇", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("门店供应配送", { exact: true }).first(),
  ).toBeVisible();
  // Never submit create/edit/delete forms; no screenshots or token logging.
});

test("授权只读迁移附件：缩略图加载及详情原图放大", async ({ page }) => {
  try {
    await openWorkspace(page, "tmy");
    await expect(page.locator(".task-list .task-card").first()).toBeVisible();
    const count = await page.locator(".task-list .task-card").count();
    let verified = false;
    for (let index = 0; index < count; index++) {
      const responsePromise = page.waitForResponse((response) =>
        /\/api\/tasks\/\d+\/images(?:\?|$)/.test(response.url()),
      );
      await page.locator(".task-list .task-card").nth(index).click();
      const response = await responsePromise;
      if (!response.ok()) throw new Error("附件列表读取失败");
      const data = z
        .object({
          data: z.object({
            items: z.array(
              z.object({
                url: z.string().url(),
                thumbnail_url: z.string().url(),
              }),
            ),
          }),
        })
        .parse((await response.json()) as unknown);
      const item = data.data.items[0];
      if (!item) {
        await page.locator(".adm-nav-bar-back").click();
        continue;
      }
      const thumbnail = page.locator(".gallery img").first();
      await thumbnail.waitFor({ state: "visible" });
      await expect
        .poll(() =>
          thumbnail.evaluate(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0,
          ),
        )
        .toBe(true);
      const original = await page.request.get(item.url);
      if (!original.ok()) throw new Error("原图读取失败");
      expect(original.headers()["content-type"]).toContain("image/png");
      expect((await original.body()).byteLength).toBe(1669743);
      await page.locator(".gallery button").first().click();
      await expect(page.locator(".adm-image-viewer-content")).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator(".adm-image-viewer-content img")
            .evaluateAll((images) =>
              images.some(
                (image) =>
                  image instanceof HTMLImageElement &&
                  image.complete &&
                  image.naturalWidth > 0,
              ),
            ),
        )
        .toBe(true);
      verified = true;
      break;
    }
    expect(verified).toBe(true);
  } finally {
    await page.close();
  }
});

test("公开工作台单内公司：新建默认天美意、编辑保留归属（不保存）", async ({
  page,
}) => {
  let businessWrites = 0;
  page.on("request", (request) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
      !request.url().includes("/api/auth/")
    )
      businessWrites++;
  });
  try {
    await openWorkspace(page, "tmy");
    await expect(page.getByText("我的", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "切换公司" })).toHaveCount(0);
    await page.getByRole("button", { name: "＋ 新建" }).click();
    const company = page.getByLabel("订单所属公司", { exact: true });
    await expect(company).toHaveValue("tmy");
    await company.selectOption("tri");
    await expect(company).toHaveValue("tri");
    await page
      .locator(".sheet")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    const first = page.locator(".task-list .task-card").first();
    await expect(first).toBeVisible();
    const labels = await first.locator(".adm-tag").allTextContents();
    const expectedCompany = labels.includes("趣趣特")
      ? "tri"
      : labels.includes("天美意")
        ? "tmy"
        : null;
    expect(expectedCompany !== null).toBe(true);
    await first.click();
    await page
      .locator(".sheet")
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await expect(page.getByLabel("订单所属公司", { exact: true })).toHaveValue(
      expectedCompany ?? "",
    );
    await page
      .locator(".sheet")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    expect(businessWrites).toBe(0);
  } finally {
    await page.close();
  }
});
