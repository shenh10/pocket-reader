import { test, expect } from "@playwright/test";
import { date, day, summary, snapshot, pr } from "./fixtures.mjs";
const base = "/pocket-reader/";
async function noOverflow(page) {
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    outliers: [...document.querySelectorAll("body *")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width && r.right > document.documentElement.clientWidth + 1;
      })
      .slice(0, 12)
      .map((e) => ({
        tag: e.tagName,
        class: e.className,
        width: e.getBoundingClientRect().width,
        text: e.textContent?.slice(0, 60),
      })),
  }));
  expect(layout.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(
    layout.width + 1,
  );
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
test("daily reading defaults to a short reviewed list, while the entire archive remains accessible", async ({page}) => {
  await dataRoutes(page);
  const claim={text:"共享专家的输出跨 stream 使用，回收前必须等待消费者完成。",evidenceIds:["D1"]};
  const analysis={version:1,generatedAt:"2026-11-22T00:00:00Z",generator:"gpt-6.1-sol",headSha:"a".repeat(40),baseSha:"b".repeat(40),
    summary:claim,problem:claim,before:claim,after:claim,tradeoff:claim,validation:claim,
    walkthrough:{evidenceId:"D1",excerpt:"stream.wait_stream(current_stream)",explanation:claim.text},
    evidence:[{id:"D1",kind:"diff",label:"model.py",url:pr.url+"/files"}],coverage:{filesTotal:1,filesReviewed:1,notes:[]}};
  const prs=Array.from({length:8},(_,i)=>({...pr,id:100+i,title:`Change ${i}`,deepDive:i===7?null:{...analysis,focus:{architecture:4,performance:4,learning:4,evidence:4,kind:i===6?"maintenance":"mechanism",topic:i<2?"stream-lifetime":`topic-${i}`}}}));
  await page.route("**/pocket-reader/v1/dashboard?*",route=>route.fulfill({json:{...day,prs}}));
  await page.goto(base+"ai-infra-board/?date="+date);
  await expect(page.locator(".learningStack .prCard")).toHaveCount(3);
  await expect(page.locator(".readingQueue .prCard")).toHaveCount(5);
  await expect(page.getByRole("button",{name:"每日阅读",exact:true})).toHaveClass(/selected/);
  await noOverflow(page);
  await page.screenshot({path:"test-results/mobile-daily-curation.png",fullPage:true});
  await page.getByRole("button",{name:"全部归档",exact:true}).click();
  await expect(page.locator(".prCard")).toHaveCount(8);
  await page.route("**/pocket-reader/v1/dashboard?*",route=>route.fulfill({json:{...day,prs:[{...pr,deepDive:null}]}}));
  await page.reload();
  await expect(page.locator(".learningStack .prCard")).toHaveCount(0);
  await expect(page.locator(".readingQueue .prCard")).toHaveCount(1);
  await expect(page.getByRole("link",{name:pr.title,exact:true})).toBeVisible();
  await expect(page.getByText("待深读",{exact:true})).toBeVisible();
});
test("a day with five unanalyzed entries is readable by default and remains searchable", async ({page}) => {
  await dataRoutes(page);
  const prs=Array.from({length:5},(_,i)=>({...pr,id:200+i,title:`Retained mechanism ${i}`,number:200+i,deepDive:null}));
  await page.route("**/pocket-reader/v1/dashboard?*",route=>route.fulfill({json:{...day,prs}}));
  await page.goto(base+"ai-infra-board/?date="+date);
  await expect(page.getByRole("heading",{name:"本期收录 5 个改动",exact:true})).toBeVisible();
  await expect(page.locator(".statusBand .stat").first()).toContainText("5");
  await expect(page.locator(".readingQueue .prCard")).toHaveCount(5);
  await expect(page.locator(".analysisStatus")).toHaveText(Array(5).fill("待深读"));
  await expect(page.locator(".reviewedReading")).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({path:"test-results/mobile-retained-awaiting-analysis.png",fullPage:true});
  await page.getByPlaceholder("搜索 #4401 / PR 号 / repo / 标题 / 解读").fill("mechanism 3");
  await expect(page.locator(".readingQueue .prCard")).toHaveCount(1);
  await expect(page.getByRole("link",{name:"Retained mechanism 3",exact:true})).toBeVisible();
  await page.getByPlaceholder("搜索 #4401 / PR 号 / repo / 标题 / 解读").fill("no matching entry");
  await expect(page.getByText("没有符合当前筛选的条目，试试调整搜索或筛选。",{exact:true})).toBeVisible();
});
test("code analysis renders cited prose and diff on a phone; legacy boilerplate stays hidden", async ({ page }) => {
  await dataRoutes(page);
  const claim = { text: "索引必须在乘法之前提升到 int64_t，否则乘法已经发生回绕，之后再扩大结果类型也无法恢复高位。", evidenceIds: ["D1"] };
  const analysis = {
    version: 1, generatedAt: "2026-11-21T00:00:00Z", generator: "fixture", headSha: "a".repeat(40), baseSha: "b".repeat(40),
    summary: claim, problem: claim, before: claim, after: claim, tradeoff: claim, validation: claim,
    walkthrough: { evidenceId: "D1", excerpt: "const int64_t row = blockIdx.x;\noutput[row * hidden_size] = value;\n// <img src=x onerror=alert(1)>", explanation: claim.text },
    evidence: [{ id: "D1", kind: "diff", label: "kernel.cu", url: pr.url + "/files" }],
    coverage: { filesTotal: 3, filesReviewed: 2, notes: ["未运行上游 GPU 测试。"] },
  };
  await page.route("**/pocket-reader/v1/dashboard?*", route => route.fulfill({ json: {
    ...day, prs: [{...pr, deepDive: analysis}, {...pr, id: 101, deepDive: null, importanceReason: "命中关键词", learningComment: "阅读建议：先看测试"}]
  }}));
  await page.goto(base + "ai-infra-board/?date=" + date);
  await page.getByRole("button", {name:"全部归档", exact:true}).click();
  await expect(page.locator(".analysisSummary")).toContainText("int64_t");
  await expect(page.getByText("尚未完成代码分析", {exact: true})).toBeVisible();
  await expect(page.getByText("命中关键词", {exact: true})).toHaveCount(0);
  await expect(page.getByText("阅读建议：先看测试", {exact: true})).toHaveCount(0);
  await page.getByText("代码深读 · 机制、证据与边界", {exact: true}).click();
  await expect(page.locator(".analysisSection pre")).toContainText("<img src=x");
  await expect(page.locator(".analysisSection pre img")).toHaveCount(0);
  await expect(page.locator(".analysisCitations a").first()).toHaveAttribute("href", pr.url + "/files");
  await expect(page.locator(".analysisCoverage")).toContainText("已读 2/3 个文件");
  await noOverflow(page);
  await page.screenshot({path: "test-results/mobile-code-analysis.png", fullPage: true});
});
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
  await expect(
    page.getByRole("navigation", { name: "主要导航" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "分享当前页面" }),
  ).toBeInViewport();
  await page.screenshot({ path: "test-results/mobile-tutorial.png" });
  await page.waitForFunction(() => typeof window.PocketReader?.handleNotification === "function");
  await page.evaluate(() =>
    window.PocketReader.handleNotification({ date: "2026-11-20" }),
  );
  await expect(page).toHaveURL(/ai-infra-board\/\?date=2026-11-20/);
  await page.waitForFunction(() => typeof window.PocketReader?.handleNotification === "function");
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
  await page.getByRole("button", {name:"全部归档", exact:true}).click();
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
  await page.getByRole("button", {name:"全部归档", exact:true}).click();
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

test("installed UI reads the deployed Supabase service", async ({ page }) => {
  const api =
    "https://rihzdwrefdjruzgdtasb.supabase.co/functions/v1/pocket-reader/v1/";
  const response = await page.request.get(api + "summary");
  expect(response.ok()).toBeTruthy();
  const live = await response.json();
  expect(live.latest.prCount).toBeGreaterThan(0);
  await page.goto("/native/");
  await expect(page.locator("#digest-count")).toHaveText(
    live.latest.prCount.toLocaleString(),
    { timeout: 20000 },
  );
  await page.screenshot({
    path: "test-results/mobile-live-home.png",
    fullPage: true,
  });
  await page.locator("#digest-link").click();
  await page.getByRole("button", {name:"全部归档", exact:true}).click();
  await expect(page.locator(".prCard").first()).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: "test-results/mobile-live-daily.png" });
});


test("Capacitor directory navigation opens the styled daily document", async ({page}) => {
  await dataRoutes(page);
  await page.goto("/native/");
  await expect(page.locator("#digest-count")).toHaveText("1");
  // This browser is not a native platform: the dynamic directory link exercises
  // the legacy-directory guard under the same root fallback as Capacitor.
  await page.locator("#digest-link").click();
  await expect(page).toHaveURL(/native\/ai-infra-board\/index\.html\?date=/);
  await expect(page).toHaveTitle("AI Infra Merge Board");
  await page.getByRole("button", {name:"全部归档", exact:true}).click();
  await expect(page.locator(".prCard").first()).toBeVisible();
  await expect(page.locator(".topBand")).toHaveCSS("display", "grid");
  expect(await page.evaluate(() => [...document.styleSheets].some(s => s.href?.includes('/ai-infra-board/assets/') && s.cssRules.length > 0))).toBe(true);
  await noOverflow(page);
  await page.screenshot({path:"test-results/native-daily-styled.png"});
  await page.goto("/native/ai-infra-board/?date=" + date);
  await expect(page).toHaveURL(/ai-infra-board\/index\.html\?date=/);
  await expect(page.locator(".topBand")).toHaveCSS("display", "grid");
  await page.goto("/native/nvidia-docs/kernels/");
  await expect(page).toHaveURL(/kernels\/index\.html/);
  await expect(page).not.toHaveTitle(/Pocket Reader/);
});
