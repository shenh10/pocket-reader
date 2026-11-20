import { test, expect } from "@playwright/test";
import { date, day, summary, snapshot } from "./fixtures.mjs";
const base = "/pocket-reader/";
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
async function dataRoutes(page) {
  await page.route("**/pocket-reader/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      endpoint = url.pathname.split("/").pop();
    const value =
      endpoint === "summary" ? summary : endpoint === "days" ? [snapshot] : day;
    await route.fulfill({
      json: value,
      headers: { "access-control-allow-origin": "*" },
    });
  });
}
test("phone navigation, reading size and safe notification routing", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await dataRoutes(page);
  await page.goto(base);
  await expect(page.locator("#digest-count")).toHaveText(
    String(day.prs.length),
  );
  await expect(
    page.getByRole("navigation", { name: "主要导航" }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/mobile-home.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByLabel("教程文字大小").selectOption("large");
  await expect(page.locator("html")).toHaveClass(/pr-font-large/);
  await expect(page.locator("#push-enable")).toBeDisabled();
  await noOverflow(page);
  await page.goto(base + "nvidia-docs/kernels/execution-path.html");
  await expect(page.locator("html")).toHaveClass(/pr-font-large/);
  await noOverflow(page);
  await page.screenshot({ path: "test-results/mobile-tutorial.png" });
  await page.evaluate(() =>
    window.PocketReader.handleNotification({ date: "2026-11-20" }),
  );
  await expect(page).toHaveURL(/ai-infra-board\/\?date=2026-11-20/);
  const current = page.url();
  await page.evaluate(() =>
    window.PocketReader.handleNotification({ url: "https://evil.example/" }),
  );
  expect(page.url()).toBe(current);
  expect(errors).toEqual([]);
});
test("cached daily remains readable offline with favorites preserved", async ({
  page,
}) => {
  await dataRoutes(page);
  await page.goto(base + "ai-infra-board/?date=" + date);
  await expect(page.locator(".prCard").first()).toBeVisible();
  await noOverflow(page);
  await page
    .locator(".prCard")
    .first()
    .getByTitle("收藏", { exact: true })
    .click();
  await expect(
    page.locator(".prCard").first().getByTitle("取消收藏", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-daily.png" });
  await page.unroute("**/pocket-reader/v1/**");
  await page.route("**/pocket-reader/v1/**", (route) => route.abort());
  await page.reload();
  await expect(page.locator(".prCard").first()).toBeVisible();
  await expect(page.locator(".pr-status")).toContainText("离线缓存");
  await expect(
    page.locator(".prCard").first().getByTitle("取消收藏", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.locator("#clear-content").click();
  await expect(page.locator(".pr-toast")).toContainText("已读和收藏已保留");
  expect(
    await page.evaluate(
      () =>
        Object.keys(
          JSON.parse(localStorage.getItem("ai-infra-pr-radar-state-v1")),
        ).length,
    ),
  ).toBeGreaterThan(0);
});
test("first offline launch contains no bundled daily content", async ({
  page,
}) => {
  await page.route("**/pocket-reader/v1/**", (route) => route.abort());
  await page.goto("/native/");
  await expect(page.locator("#home-error")).toContainText("没有离线缓存");
  await expect(page.locator("#digest-count")).toHaveText("—");
  await page.getByRole("link", { name: "学习", exact: true }).click();
  await expect(page.locator("body")).toContainText("NVIDIA");
});
test("service updates appear without rebuilding or reinstalling the client", async ({
  page,
}) => {
  await dataRoutes(page);
  await page.goto("/native/");
  await expect(page.locator("#digest-count")).toHaveText("1");
  await page.route("**/pocket-reader/v1/summary", (route) =>
    route.fulfill({
      json: { ...summary, latest: { ...snapshot, prCount: 2 } },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.reload();
  await expect(page.locator("#digest-count")).toHaveText("2");
});
test("desktop keeps the reading layout without phone navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dataRoutes(page);
  await page.goto(base);
  await expect(page.locator("#digest-count")).toHaveText(
    String(day.prs.length),
  );
  await expect(page.getByRole("navigation", { name: "主要导航" })).toBeHidden();
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/desktop-home.png",
    fullPage: true,
  });
});
test("web shell survives a fully offline reload at the Pages subpath", async ({
  page,
  context,
}) => {
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "今天，读懂一点。" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await expect(page.locator("#reading-size")).toBeVisible();
});
