import test from "node:test";
import assert from "node:assert/strict";
import {
  createReaderHandler,
  type ReaderStore,
} from "../src/server/public-api";
const privatePr = {
  id: 1,
  isFavorite: true,
  isRead: true,
  watchLater: true,
  userNote: "private",
  body: "raw",
  title: "public",
};
const snapshot = {
  date: "2026-11-20",
  status: "ok",
  error: "internal db detail",
  prCount: 1,
  repoCount: 9,
  fetchedAt: "2026-11-20T00:00:00Z",
};
const store: ReaderStore = {
  days: async () => [snapshot],
  dashboard: async () =>
    ({
      date: snapshot.date,
      prs: [privatePr],
      snapshot,
      stats: { total: 1 },
      repos: [],
    }) as any,
  timeline: async () => ({ prs: [privatePr], stats: { total: 1 } }) as any,
  highlights: async () => ({ prs: [privatePr] }) as any,
};
const handler = createReaderHandler(store);
const request = (route: string, method = "GET") =>
  handler(
    new Request(
      "https://reader.example/functions/v1/pocket-reader/v1/" + route,
      { method },
    ),
  );
test("public service strips personal state and raw body while preserving content", async () => {
  const r = await request("dashboard?date=2026-11-20"),
    body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.equal(body.prs[0].title, "public");
  assert.equal(body.prs[0].userNote, "");
  assert.equal(body.prs[0].isFavorite, false);
  assert.equal(body.prs[0].body, null);
  assert.equal(body.snapshot.error, null);
});
test("public service does not expose collection or mutable state operations", async () => {
  assert.equal((await request("fetch", "POST")).status, 405);
  assert.equal((await request("prs/1/state", "PATCH")).status, 405);
  assert.equal((await request("fetch")).status, 404);
});
test("invalid dates and unlimited ranges are rejected before querying storage", async () => {
  assert.equal((await request("dashboard?date=2026-02-30")).status, 400);
  assert.equal(
    (await request("timeline?start=2020-01-01&end=2026-11-20")).status,
    400,
  );
  assert.equal((await request("highlights?year=NaN")).status, 400);
});
test("summary reads live store on every call and paged timeline signals continuation", async () => {
  let count = 1;
  const live = createReaderHandler({
    ...store,
    days: async () => [{ ...snapshot, prCount: count }],
    timeline: async () =>
      ({
        prs: Array.from({ length: 500 }, () => privatePr),
        stats: { total: 500 },
      }) as any,
  });
  const req = () => new Request("https://reader.example/v1/summary");
  assert.equal((await (await live(req())).json()).latest.prCount, 1);
  count = 2;
  assert.equal((await (await live(req())).json()).latest.prCount, 2);
  const result = await live(
    new Request(
      "https://reader.example/v1/timeline?start=2026-11-01&end=2026-11-20&offset=500",
    ),
  );
  assert.equal((await result.json()).nextOffset, 1000);
});
test("database failures never return credential-bearing error text", async () => {
  const fail = createReaderHandler({
    ...store,
    days: async () => {
      throw Error("postgres://secret");
    },
  });
  const res = await fail(new Request("https://reader.example/v1/days"));
  assert.equal(res.status, 503);
  assert.doesNotMatch(await res.text(), /postgres|secret/);
});
