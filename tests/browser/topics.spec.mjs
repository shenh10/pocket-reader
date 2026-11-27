import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const publication = JSON.parse(readFileSync(new URL("../../content/topics/publication.json", import.meta.url), "utf8"));
const summaries = publication.topics.map(({ body, contentHash, ...summary }) => summary);
async function setup(page) {
  await page.route("**/pocket-reader/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.slice(url.pathname.lastIndexOf("/v1/") + 4);
    const slug = endpoint.startsWith("topics/") ? endpoint.slice("topics/".length) : "";
    if (endpoint === "topics") return route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: { topics: summaries } });
    const topic = publication.topics.find((item) => item.id === slug);
    if (topic) return route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: { topic } });
    return route.fulfill({ headers: { "access-control-allow-origin": "*" }, status: 503, json: { error: "daily deliberately unavailable" } });
  });
}
test("mobile real eight-article reading is independent of daily and safely renders math, tables, diagrams", async ({ page }) => {
  await setup(page);
  await page.goto("/pocket-reader/ai-infra-board/?view=topics");
  await expect(page.locator(".topicIndexEntry")).toHaveCount(8);
  await page.getByRole("link", { name: /Kimi-K3 文本主干/ }).click();
  await expect(page.locator(".topicProse h1")).toContainText("Kimi-K3");
  await expect(page.locator(".katex-display").first()).toBeVisible();
  await expect(page.locator(".topicDiagram svg").first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".topicTableScroll").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  const toc = page.locator(".topicContents a").first(); await toc.click();
  expect(new URL(page.url()).hash).toBeTruthy();
  await expect(page.locator(".topicProse .katex-error")).toHaveCount(0);
  await page.screenshot({ path: "test-results/topics-mobile.png", fullPage: true });
  await page.locator(".topicDiagram").first().screenshot({ path: "test-results/topic-diagram-mobile.png" });
  for (const topic of publication.topics) {
    await page.goto(`/pocket-reader/ai-infra-board/?view=topics&topic=${topic.id}`);
    await expect(page.locator(".topicProse h1")).toHaveText(topic.title);
    await expect(page.locator(".topicProse .katex-error")).toHaveCount(0);
    const diagrams = (topic.body.match(/```mermaid/g) ?? []).length;
    if (diagrams) { await expect(page.locator(".topicDiagram svg")).toHaveCount(diagrams, { timeout: 20000 }); expect(await page.locator(".topicDiagram svg text").count()).toBeGreaterThan(0); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    expect(await page.locator(".topicDiagram script,.topicDiagram foreignObject,.topicProse script").count()).toBe(0);
  }
});
test("directory/article back, related navigation and browser history", async ({ page }) => {
  await setup(page); await page.goto("/pocket-reader/ai-infra-board/?view=topics");
  await page.locator(".topicIndexEntry").first().click();
  await expect(page.locator(".topicProse h1")).toBeVisible();
  const relatedTitle = await page.locator(".topicRelated>a").first().innerText();
  await page.locator(".topicRelated>a").first().click();
  await expect(page.locator(".topicProse h1")).toHaveText(relatedTitle);
  await page.goBack(); await expect(page.locator(".topicProse h1")).toContainText("Kimi-K3");
  await page.getByRole("link", { name: "专题目录", exact: true }).click();
  await expect(page.locator(".topicIndexEntry")).toHaveCount(8);
  await page.getByRole("button", { name: "日报", exact: true }).first().click();
  await expect(page.locator(".topicSurface")).toHaveCount(0);
  await page.goBack(); await expect(page.locator(".topicIndexEntry")).toHaveCount(8);
});
test("independent loading and retryable errors", async ({ page }) => {
  await setup(page);
  await page.route("**/pocket-reader/v1/topics", async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: { topics: summaries } }); });
  await page.goto("/pocket-reader/ai-infra-board/?view=topics");
  await expect(page.getByRole("status")).toContainText("正在读取专题目录");
  await expect(page.locator(".topicIndexEntry")).toHaveCount(8);
  await page.route("**/pocket-reader/v1/topics/not-found", route => route.fulfill({ headers: { "access-control-allow-origin": "*" }, status: 404, json: {} }));
  await page.goto("/pocket-reader/ai-infra-board/?view=topics&topic=not-found");
  await expect(page.getByRole("alert")).toContainText("暂时无法打开这篇专题");
  await expect(page.getByRole("button", { name: "重试", exact: true })).toBeVisible();
});
test("dark mobile article remains readable", async ({ page }) => {
  await setup(page); await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/pocket-reader/ai-infra-board/?view=topics&topic=residual-mixing");
  await expect(page.locator(".topicProse h1")).toBeVisible();
  await expect(page.locator(".topicDiagram svg").first()).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: "test-results/topics-dark-mobile.png", fullPage: true });
});

test("visited articles use validated offline cache and reject raw HTML/script links", async ({ page }) => {
  await setup(page);
  await page.goto("/pocket-reader/ai-infra-board/?view=topics&topic=moe-working-set");
  await expect(page.locator(".topicProse h1")).toBeVisible();
  await page.route("**/pocket-reader/v1/topics/**", route => route.abort());
  await page.reload();
  await expect(page.locator(".topicArticleMeta")).toContainText("离线缓存");
  await expect(page.locator(".topicProse h1")).toHaveText("MoE 的复用粒度：从不同专家数到真正的 GEMM 分组");
  const sample = publication.topics[0];
  await page.route("**/pocket-reader/v1/topics/security-fixture", route => route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: { topic: { ...sample, id: "security-fixture", body: '# 安全正文\n<script>window.topicInjected=true</script>\n[unsafe](javascript:alert(1))\n[bad](http://[)\n\n```mermaid\nflowchart LR\n A[可读标签] --> B[安全图]\n```' } } }));
  await page.goto("/pocket-reader/ai-infra-board/?view=topics&topic=security-fixture");
  await expect(page.locator(".topicProse h1")).toHaveText("安全正文");
  expect(await page.evaluate(() => window.topicInjected)).toBeUndefined();
  expect(await page.locator('.topicProse a[href^="javascript:"]').count()).toBe(0);
  await expect(page.locator(".topicDiagram svg text").first()).toBeVisible();
});
