import { readContent, contentCache } from "./content-client.js";
let configuredUrl = null;
export function setServiceBase(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw Error("日报服务需要 HTTPS 地址");
  if (url.username || url.password) throw Error("服务地址不能包含凭据");
  configuredUrl = url.href.replace(/\/$/, "") + "/";
  return configuredUrl;
}
export async function serviceBase() {
  if (configuredUrl) return configuredUrl;
  const base = document.querySelector('meta[name="pocket-api"]')?.content;
  if (!base) throw Error("日报服务尚未配置，请等待服务上线。");
  return setServiceBase(base);
}
export async function readService(route, { onStatus = () => {} } = {}) {
  if (!/^(summary|days|dashboard|timeline|highlights)(\?|$)/.test(route))
    throw Error("不支持的日报接口");
  const url = new URL(route, await serviceBase()).href;
  // Query parameters identify different dates and timeline pages; never strip them here.
  const cache = {
    get: () => contentCache.get(url),
    set: (_key, value) => contentCache.set(url, value),
  };
  const endpoint = route.split("?")[0];
  const validate = (value) =>
    endpoint === "days"
      ? Array.isArray(value)
      : endpoint === "summary"
        ? value && "latestDate" in value
        : value && Array.isArray(value.prs);
  return readContent(url, { cache, onStatus, validate });
}
