import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReaderHandler, type ReaderStore } from "../src/server/public-api";
import { createTopicsStore, type TopicsQuery } from "../src/server/topics-store";
import type { TopicArticle } from "../src/shared/topics";
import { main, upsertTopics, validateTopicBundle } from "./publish-topics";

const article: TopicArticle = {
  id: "gpu-handoff-order", title: "GPU 数据交接", description: "发布与复用的两个方向。",
  category: "GPU", tags: ["TMA"], version: 2, updatedAt: "2026-11-27T00:00:00Z",
  readingMinutes: 20, relatedTopicIds: [], body: "# GPU\n\nPublished Markdown.",
  contentHash: "",
};
article.contentHash = createHash("sha256").update(article.body).digest("hex");
const bundle = () => ({ topics: Array.from({ length: 8 }, (_, i) => ({ ...article, id: `topic-${i}` })) });
const base: ReaderStore = {
  days: async () => [], dashboard: async () => { throw new Error("unused"); },
  timeline: async () => { throw new Error("unused"); }, highlights: async () => { throw new Error("unused"); },
};
const request = (handler: ReturnType<typeof createReaderHandler>, path: string, method = "GET") =>
  handler(new Request(`https://reader.example/functions/v1/pocket-reader/v1/${path}`, { method }));

test("topics API returns live summaries and full articles with an explicit public whitelist", async () => {
  let version = 2;
  const privateFields = { localPath: "/Users/editor/work", notes: "private", published_at: "private" };
  const handler = createReaderHandler({ ...base,
    topics: async () => [{ ...article, ...privateFields, version }],
    topic: async id => id === article.id ? { ...article, ...privateFields } : null,
  });
  let result = await request(handler, "topics");
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("access-control-allow-origin"), "*");
  const summary = (await result.json()).topics[0];
  assert.equal(summary.version, 2);
  assert.equal(summary.body, undefined);
  assert.equal(summary.contentHash, undefined);
  assert.equal(summary.localPath, undefined);
  version = 3;
  assert.equal((await (await request(handler, "topics")).json()).topics[0].version, 3);
  result = await request(handler, `topics/${article.id}`);
  assert.deepEqual(await result.json(), { topic: article });
});

test("malformed slugs are 400 before storage and absent published articles are 404", async () => {
  let reads = 0;
  const handler = createReaderHandler({ ...base, topic: async () => { reads++; return null; } });
  for (const id of ["", "BAD", "a/b", "a%2Fb", "%ZZ", "x".repeat(81), "hello_world", "%2e%2e%2fsecret"]) {
    assert.equal((await request(handler, `topics/${id}`)).status, 400, id);
  }
  assert.equal(reads, 0);
  assert.equal((await request(handler, "topics/missing")).status, 404);
  assert.equal(reads, 1);
});

test("topics exposes no publication API and storage failures are generic 503 with no cache", async () => {
  const handler = createReaderHandler({ ...base,
    topics: async () => { throw Error("postgres://password@host/private/table"); },
    topic: async () => { throw Error("secret SQL parameter"); },
  });
  for (const route of ["topics", "topics/safe"]) {
    const r = await request(handler, route);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await r.text(), /postgres|password|parameter|private|SQL/);
    assert.equal((await request(handler, route, "POST")).status, 405);
  }
  assert.equal((await request(handler, "topics", "OPTIONS")).status, 204);
});

test("SQL store filters published rows and uses a bound id without loading list bodies", async () => {
  const queries: { sql: string; values?: string[] }[] = [];
  const db: TopicsQuery = { query: async (sql, values) => {
    queries.push({ sql, values });
    return { rows: [{ id: article.id, title: article.title, description: article.description,
      category: article.category, tags: article.tags, version: article.version,
      updated_at: new Date(article.updatedAt), reading_minutes: article.readingMinutes,
      related_topic_ids: [], body: article.body, content_hash: article.contentHash }] };
  } };
  const store = createTopicsStore(db);
  assert.equal((await store.topics())[0].id, article.id);
  assert.deepEqual(await store.topic(article.id), { ...article, updatedAt: "2026-11-27T00:00:00.000Z" });
  assert.equal(await store.topic("bad' OR true"), null);
  assert.equal(queries.length, 2);
  for (const q of queries) assert.match(q.sql, /published_at IS NOT NULL AND published_at <= now\(\)/);
  assert.doesNotMatch(queries[0].sql, /\bbody\b/);
  assert.match(queries[1].sql, /id = \$1/);
  assert.deepEqual(queries[1].values, [article.id]);
});

test("import validates the complete eight-topic release, schema and reference closure", () => {
  assert.equal(validateTopicBundle(bundle()).length, 8);
  assert.throws(() => validateTopicBundle({ topics: bundle().topics.slice(0, 7) }));
  const duplicate = bundle(); duplicate.topics[1].id = duplicate.topics[0].id;
  assert.throws(() => validateTopicBundle(duplicate), /duplicate topic id/);
  const invalid = bundle(); invalid.topics[0].relatedTopicIds = ["missing"];
  assert.throws(() => validateTopicBundle(invalid), /unknown related topic/);
  const privateBundle = bundle(); Object.assign(privateBundle.topics[0], { sourceUrl: "file:///private" });
  assert.throws(() => validateTopicBundle(privateBundle), /unexpected article field/);
  for (const patch of [{ version: 0 }, { tags: ["x", "x"] }, { updatedAt: "yesterday" },
    { id: "BAD" }, { readingMinutes: 0 }, { contentHash: "0".repeat(64) }]) {
    const changed = bundle(); Object.assign(changed.topics[0], patch);
    assert.throws(() => validateTopicBundle(changed));
  }
});

test("import rejects HTML, unsafe/local content, and changed bodies without matching SHA256", () => {
  for (const body of ["<script>alert(1)</script>", "[link](javascript:alert)",
    "local /Users/editor/work/article.md", "<!-- hidden -->", "[file](file:///private/work)"]) {
    const changed = bundle(); changed.topics[0].body = body;
    changed.topics[0].contentHash = createHash("sha256").update(body).digest("hex");
    assert.throws(() => validateTopicBundle(changed));
  }
  const changed = bundle(); changed.topics[0].body += "modified";
  assert.throws(() => validateTopicBundle(changed), /hash mismatch/);
  const code = bundle();
  code.topics[0].body = "0<M≤E/4; \\(i<t\\).\n\n```cpp\nvector<T> x;\nif (i<S_i) {}\n```\n\n`j<S_i`";
  code.topics[0].contentHash = createHash("sha256").update(code.topics[0].body).digest("hex");
  assert.equal(validateTopicBundle(code).length, 8);
});

test("import requires an explicit absolute input before any connection", async () => {
  await assert.rejects(main(["--input", "relative.json"]), /absolute/);
  await assert.rejects(main([]), /absolute/);
});

test("upsert targets selected topic ids only, uses content comparisons and reports unchanged rows", async () => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const client = { query: async (sql: string, values: unknown[]) => {
    calls.push({ sql, values }); return { rowCount: 0 };
  } };
  const changed = await upsertTopics(client as any, validateTopicBundle(bundle()));
  assert.equal(changed, 0);
  assert.equal(calls.length, 8);
  for (const c of calls) {
    assert.match(c.sql, /INSERT INTO public.reader_topics/);
    assert.match(c.sql, /IS DISTINCT FROM/);
    assert.doesNotMatch(c.sql, /DELETE|pull_requests|pr_user_state/i);
    assert.equal(c.values[10], article.contentHash);
  }
});
