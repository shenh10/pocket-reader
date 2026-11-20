/** Shared network-first JSON reader for the website and the installed app. */
const DB_NAME = "pocket-reader-content-v1";
let database;
function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (!database)
    database = new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("entries", { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  return database;
}
export const contentCache = {
  async get(key) {
    const db = await openDatabase();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction("entries", "readonly"),
        req = tx.objectStore("entries").get(key);
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => resolve(null);
    });
  },
  async set(key, value) {
    const db = await openDatabase();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction("entries", "readwrite"),
        store = tx.objectStore("entries");
      store.put({ key, value, updated: Date.now() });
      const all = store.getAll();
      all.onsuccess = () => {
        const entries = all.result.sort((a, b) => b.updated - a.updated);
        for (const entry of entries.slice(64)) store.delete(entry.key);
      };
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    });
  },
  async clear() {
    const db = await openDatabase();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction("entries", "readwrite");
      tx.objectStore("entries").clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  },
};
export function cacheKey(url) {
  const u = new URL(url, "https://pocket.invalid");
  u.search = "";
  u.hash = "";
  return u.href;
}
export async function readContent(
  url,
  {
    cache = contentCache,
    fetcher = globalThis.fetch,
    validate = () => true,
    timeout = 10000,
    onStatus = () => {},
  } = {},
) {
  const key = cacheKey(url);
  async function get(target) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetcher(target, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json();
      if (!validate(value)) throw new Error("数据格式不正确");
      return value;
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    const value = await get(url);
    await Promise.resolve()
      .then(() => cache.set(key, value))
      .catch(() => {});
    onStatus("online");
    return value;
  } catch (error) {
    const saved = await Promise.resolve()
      .then(() => cache.get(key))
      .catch(() => null);
    if (saved && validate(saved)) {
      onStatus("cached");
      return saved;
    }
    throw new Error("暂时无法读取内容，且此页还没有离线缓存。请联网后重试。", {
      cause: error,
    });
  }
}
export function isManifest(value) {
  return (
    !!value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.defaultDate) &&
    Array.isArray(value.days) &&
    !!value.dashboards &&
    !!value.timeline &&
    !!value.highlights
  );
}
export function isDashboard(value) {
  return (
    !!value &&
    typeof value.date === "string" &&
    Array.isArray(value.prs) &&
    !!value.stats
  );
}
