import test from "node:test";
import assert from "node:assert/strict";
import { validateAnalysis, generateAnalysis, type EvidencePacket } from "../src/server/deep-dive";
import { analyzePullRequest } from "../src/server/intelligence";

const packet: EvidencePacket = {
  repo: "owner/repo", number: 1, title: "Fix offset arithmetic", headSha: "a".repeat(40), baseSha: "b".repeat(40),
  evidence: [{id: "D1", kind: "diff", label: "kernel.cu", url: "https://github.com/owner/repo/pull/1/files", content: "+const int64_t row = blockIdx.x;\n+out[row * width] = value;"},
    {id: "P1", kind: "description", label: "Author", url: "https://github.com/owner/repo/pull/1", content: "Test plan only"}],
  coverage: {filesTotal: 1, filesReviewed: 1, notes: ["No local GPU execution"]}
};
const draft = () => Object.fromEntries([
  ...["summary", "problem", "before", "after", "tradeoff", "validation"].map(key => [key, {
    text: "The offset multiplication uses the operand types, so widening the result alone cannot undo arithmetic overflow. The cast has to occur before multiplication.", evidenceIds: ["D1"]
  }]),
  ["walkthrough", {evidenceId: "D1", excerpt: packet.evidence[0].content, explanation: "The row index is widened before multiplication, preserving the intended address for large row counts."}]
]);
test("published analysis has trusted revision, sources and no raw evidence payload", () => {
  const value = {...draft(), headSha: "forged", evidence: [{url: "javascript:alert(1)"}]};
  const result = validateAnalysis(value, packet, "test");
  assert.equal(result.headSha, packet.headSha);
  assert.equal(result.evidence[0].url, packet.evidence[0].url);
  assert.ok(!("content" in result.evidence[0]));
});
test("unknown references and prose without code evidence cannot masquerade as a deep dive", () => {
  for (const ids of [["missing"], ["P1"], []]) {
    const value = draft() as any; value.before.evidenceIds = ids;
    assert.throws(() => validateAnalysis(value, packet, "test"));
  }
});
test("invented code and keyword boilerplate are rejected", () => {
  const value = draft() as any; value.walkthrough.excerpt = "code that was never in the diff";
  assert.throws(() => validateAnalysis(value, packet, "test"), /actual supplied code/);
  const prose = draft() as any; prose.after.text += " 命中性能关键词，所以值得关注。";
  assert.throws(() => validateAnalysis(prose, packet, "test"), /boilerplate/);
});
test("heuristic classification no longer fabricates implementation or experiment claims", () => {
  const result = analyzePullRequest({title: "Fix CUDA scheduler performance", body: "", labels: []}, {
    id: 1, fullName: "owner/repo", owner: "owner", name: "repo", displayName: "repo", homepageUrl: "", description: "", importanceWeight: 3, enabled: true
  });
  assert.equal(result.learningComment, "");
  assert.ok(Object.values(result.evaluation).every(value => value === ""));
});
test("missing provider fails explicitly without publishing fallback prose", async () => {
  const old = process.env.DEEP_DIVE_API_KEY;
  delete process.env.DEEP_DIVE_API_KEY;
  try { await assert.rejects(generateAnalysis(packet), /DEEP_DIVE_API_KEY/); }
  finally { if (old !== undefined) process.env.DEEP_DIVE_API_KEY = old; }
});
