import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Preferences } from "@capacitor/preferences";
import { Share } from "@capacitor/share";
import { StatusBar, Style } from "@capacitor/status-bar";
import { contentCache } from "./content-client.js";
import { readService } from "./service-client.js";
import { routeFromLink, publishedUrl, PUBLIC_SITE } from "./routes.js";
const script = document.currentScript;
const base = new URL("../", script.src);
const native = Capacitor.isNativePlatform();
const path = location.pathname.slice(base.pathname.length);
const home = path === "" || path === "index.html";
const settings = path === "settings.html";
const icons = {
  home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
  daily:
    '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h4"/>',
  learn:
    '<path d="M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z"/><path d="M12 5v16"/>',
  settings:
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  share: '<path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/>',
};
const svg = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const html = document.documentElement;
html.classList.add("pr-mobile");
if (native) html.classList.add("pr-native");
if (home) html.classList.add("pr-home");
const toast = document.createElement("div");
toast.className = "pr-toast";
toast.setAttribute("role", "status");
document.body.append(toast);
let toastTimer;
function message(text) {
  toast.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.textContent = ""), 4000);
}
const banner = document.createElement("div");
banner.className = "pr-status";
banner.hidden = true;
banner.setAttribute("role", "status");
document.body.prepend(banner);
function status(value) {
  banner.hidden = value === "online";
  banner.textContent = "正在阅读离线缓存，联网后可刷新。";
}
window.addEventListener("pocket-content-status", (event) =>
  status(event.detail),
);
if (html.dataset.pocketContentStatus) status(html.dataset.pocketContentStatus);
const top = document.createElement("nav");
top.className = "pr-topbar";
top.setAttribute("aria-label", "阅读导航");
top.innerHTML = `<button type="button" aria-label="返回" id="pr-back">${svg("back")}</button><strong>Pocket Reader</strong><button type="button" aria-label="分享当前页面" id="pr-share">${svg("share")}</button>`;
document.body.prepend(top);
const tabs = [
  ["home", "", "首页"],
  ["daily", "ai-infra-board/", "日报"],
  ["learn", "nvidia-docs/", "学习"],
  ["settings", "settings.html", "设置"],
];
const nav = document.createElement("nav");
nav.className = "pr-nav";
nav.setAttribute("aria-label", "主要导航");
for (const [key, route, title] of tabs) {
  const a = document.createElement("a");
  a.href = new URL(route, base);
  a.innerHTML = svg(key) + `<span>${title}</span>`;
  if (
    (key === "home" && home) ||
    (key === "settings" && settings) ||
    (route.endsWith("/") && route && path.startsWith(route))
  )
    a.setAttribute("aria-current", "page");
  nav.append(a);
}
document.body.append(nav);
async function share(
  url = publishedUrl(location.href, base.href),
  title = document.title,
) {
  try {
    if (native) await Share.share({ title, url, dialogTitle: "分享阅读内容" });
    else if (navigator.share) await navigator.share({ title, url });
    else {
      await navigator.clipboard.writeText(url);
      message("链接已复制");
    }
  } catch (error) {
    if (error?.name !== "AbortError") message("分享未完成，请重试。");
  }
}
function back() {
  if (history.length > 1) history.back();
  else location.href = base.href;
}
document.getElementById("pr-back").addEventListener("click", back);
document.getElementById("pr-share").addEventListener("click", () => share());
function getLocal(key) {
  try {
    return localStorage.getItem("pocket-" + key);
  } catch {
    return null;
  }
}
function putLocal(key, value) {
  try {
    localStorage.setItem("pocket-" + key, value);
  } catch {}
}
async function save(key, value) {
  putLocal(key, value);
  if (native) await Preferences.set({ key: "pocket-" + key, value });
}
function applySize(size) {
  html.classList.toggle("pr-font-large", size === "large");
  const select = document.getElementById("reading-size");
  if (select) select.value = size === "large" ? "large" : "standard";
}
applySize(getLocal("reading-size"));
if (
  path.startsWith("nvidia-docs/") &&
  !path.endsWith("/index.html") &&
  !path.endsWith("/")
)
  save(
    "continue",
    JSON.stringify({
      path: path + location.hash,
      title: document.title.split("·")[0].trim(),
    }),
  ).catch(() => {});
if (home) {
  try {
    const saved = JSON.parse(getLocal("continue"));
    const u = saved && new URL(saved.path, base);
    if (u && u.href.startsWith(new URL("nvidia-docs/", base).href)) {
      document.getElementById("continue-link").href = u;
      document.getElementById("continue-title").textContent = saved.title;
      document.getElementById("continue-description").textContent =
        "上次读到这里 · 继续阅读";
    }
  } catch {}
  readService("summary", { onStatus: status })
    .then((data) => {
      if (!data.latest) throw Error("暂无日报，等待服务端采集。");
      document.getElementById("edition-date").textContent =
        `${data.latestDate.replaceAll("-", " / ")} · 日报`;
      document.getElementById("digest-count").textContent =
        data.latest.prCount.toLocaleString();
      document.getElementById("digest-repos").textContent =
        data.latest.repoCount;
      document.getElementById("digest-description").textContent =
        `${data.latestDate} · 从每日合并记录中，找出值得理解的变化。`;
      document.getElementById("digest-link").href = new URL(
        "ai-infra-board/?date=" + data.latestDate,
        base,
      );
    })
    .catch(
      (error) =>
        (document.getElementById("home-error").textContent = error.message),
    );
}
if (settings) {
  document
    .getElementById("reading-size")
    .addEventListener("change", async (event) => {
      applySize(event.target.value);
      await save("reading-size", event.target.value);
      message("阅读字号已保存");
    });
  document
    .getElementById("clear-content")
    .addEventListener("click", async () => {
      await contentCache.clear();
      message("日报缓存已清理，已读和收藏已保留");
    });
  document
    .getElementById("refresh-content")
    .addEventListener("click", async (event) => {
      event.target.disabled = true;
      try {
        await readService("summary", { onStatus: status });
        message(banner.hidden ? "日报已更新" : "已加载离线缓存");
      } catch (error) {
        message(error.message);
      } finally {
        event.target.disabled = false;
      }
    });
  document
    .getElementById("share-reader")
    .addEventListener("click", () => share(PUBLIC_SITE, "Pocket Reader"));
}
async function handleLink(value) {
  const target = routeFromLink(value, base.href);
  if (target && target !== location.href) location.assign(target);
}
window.PocketReader = {
  handleNotification: (payload) => {
    if (typeof payload?.url === "string") return handleLink(payload.url);
    if (typeof payload?.date === "string")
      return handleLink(
        "pocketreader://daily?date=" + encodeURIComponent(payload.date),
      );
  },
  share,
};
if (native) {
  Preferences.get({ key: "pocket-reading-size" })
    .then(({ value }) => {
      if (value) {
        putLocal("reading-size", value);
        applySize(value);
      }
    })
    .catch(() => {});
  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  App.addListener("appUrlOpen", ({ url }) => handleLink(url));
  App.getLaunchUrl()
    .then((value) => {
      if (
        !value?.url ||
        sessionStorage.getItem("pocket-handled-launch") === value.url
      )
        return;
      sessionStorage.setItem("pocket-handled-launch", value.url);
      return handleLink(value.url);
    })
    .catch(() => {});
  App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) history.back();
    else if (!home) location.assign(base.href);
    else App.minimizeApp();
  });
  document.addEventListener("click", (event) => {
    const a = event.target.closest?.("a[href]");
    if (!a || event.defaultPrevented || a.hasAttribute("download")) return;
    const url = new URL(a.href);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      url.origin !== location.origin
    ) {
      event.preventDefault();
      Browser.open({ url: url.href }).catch(() => message("暂时无法打开链接"));
    }
  });
  // A vendor SDK implementation can supply this Capacitor plugin after app credentials are provisioned.
  if (Capacitor.isPluginAvailable("PocketPush")) {
    const push = registerPlugin("PocketPush");
    push.addListener("notificationOpened", (payload) =>
      window.PocketReader.handleNotification(payload),
    );
    if (settings) {
      const button = document.getElementById("push-enable");
      button.disabled = false;
      button.textContent = "开启";
      document.getElementById("push-state").textContent =
        "允许接收每日精选，点击通知直接打开当天日报。";
      button.addEventListener("click", async () => {
        try {
          await push.register();
          message("推送请求已提交，请完成系统授权。");
        } catch {
          message("推送尚未就绪，请稍后重试。");
        }
      });
    }
  }
} else if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register(new URL("sw.js", base), { scope: base.pathname })
    .catch(() => {});
}
