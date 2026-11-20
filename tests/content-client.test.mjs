import test from "node:test";
import assert from "node:assert/strict";
import {
  readContent,
  cacheKey,
  isManifest,
  isDashboard,
} from "../shared/content-client.js";
const url =
  "https://shenhan.cc/pocket-reader/ai-infra-board/data/days/2026-11-20.json?v=one";
const day = { date: "2026-11-20", prs: [], stats: { total: 0 } };
const memory = () => {
  const values = new Map();
  return {
    get: async (key) => values.get(key),
    set: async (key, value) => values.set(key, value),
  };
};
const json = (value) => async () => ({ ok: true, json: async () => value });
const offline = async () => {
  throw new Error("offline");
};
test("online content refreshes cache; a later revision URL reads it offline", async () => {
  const cache = memory(),
    statuses = [];
  assert.deepEqual(
    await readContent(url, {
      cache,
      fetcher: json(day),
      validate: isDashboard,
      onStatus: (s) => statuses.push(s),
    }),
    day,
  );
  assert.deepEqual(
    await readContent(url.replace("one", "two"), {
      cache,
      fetcher: offline,
      validate: isDashboard,
      onStatus: (s) => statuses.push(s),
    }),
    day,
  );
  assert.deepEqual(statuses, ["online", "cached"]);
});
test("invalid network data cannot overwrite a valid cached day", async () => {
  const cache = memory();
  await cache.set(cacheKey(url), day);
  assert.deepEqual(
    await readContent(url, {
      cache,
      fetcher: json({ error: "unavailable" }),
      validate: isDashboard,
    }),
    day,
  );
});
test("unavailable cache never discards a successful network response", async () => {
  const broken = {
    get: async () => {
      throw Error("disabled");
    },
    set: async () => {
      throw Error("quota");
    },
  };
  assert.deepEqual(
    await readContent(url, {
      cache: broken,
      fetcher: json(day),
      validate: isDashboard,
    }),
    day,
  );
  await assert.rejects(
    readContent(url, { cache: broken, fetcher: offline }),
    /没有离线缓存/,
  );
});
test("a slow request aborts and falls back to a cached day", async () => {
  const cache = memory();
  await cache.set(cacheKey(url), day);
  assert.deepEqual(
    await readContent(url, {
      cache,
      timeout: 10,
      fetcher: (_url, { signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(Error("timeout"))),
        ),
    }),
    day,
  );
});
test("missing and malformed data report failure rather than an empty successful day", async () => {
  await assert.rejects(
    readContent(url, {
      cache: memory(),
      fetcher: json({}),
      validate: isDashboard,
    }),
    /没有离线缓存/,
  );
  assert.equal(isManifest({ defaultDate: "oops", days: [] }), false);
});
