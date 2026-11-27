import test from "node:test";
import assert from "node:assert/strict";
import { readService, setServiceBase } from "../../shared/service-client.js";
const summary = { id: "test-topic", title: "机制", description: "说明", category: "HPC", tags: ["CUDA"], version: 1, updatedAt: "2026-11-27T00:00:00Z", readingMinutes: 4, relatedTopicIds: [] };
test("topic routes are exact and response identity/schema validated", async () => {
  setServiceBase("https://topics.invalid/v1/");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ topics: [summary] }), { status: 200, headers: { "Content-Type": "application/json" } }); };
  try {
    assert.deepEqual(await readService("topics"), { topics: [summary] });
    for (const route of ["topics/../summary", "topics/test-topic?x=1", "topics//evil", "topics/test-topic#x", "topics/test-topic/child", "https://evil.invalid/topics"]) await assert.rejects(readService(route), /不支持/);
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response(JSON.stringify({ topic: { ...summary, body: "# 正文", contentHash: "a".repeat(64) } }));
    assert.equal((await readService<{ topic: { body: string } }>("topics/test-topic")).topic.body, "# 正文");
    globalThis.fetch = async () => new Response(JSON.stringify({ topic: { ...summary, id: "wrong", body: "# 正文", contentHash: "a".repeat(64) } }));
    await assert.rejects(readService("topics/test-topic"), /无法读取/);
    globalThis.fetch = async () => new Response(JSON.stringify({ topics: [{ ...summary, tags: "oops" }] }));
    await assert.rejects(readService("topics"), /无法读取/);
  } finally { globalThis.fetch = original; }
});
