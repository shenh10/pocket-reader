import test from "node:test";
import assert from "node:assert/strict";
import { dailyLearningPicks } from "../src/shared/curation";
import { validateFocus } from "../src/server/deep-dive";
import type { PullRequestRecord, DeepDive } from "../src/shared/types";
const pr=(id:number, focus?:Partial<NonNullable<DeepDive["focus"]>>) => ({
  id, importance:5, mergedAt:"2026-11-22T00:00:00Z", deepDive: focus ? {focus:{architecture:4,performance:4,learning:4,evidence:4,kind:"mechanism",topic:`topic-${id}`,...focus}} : null
}) as PullRequestRecord;
test("no keyword importance or missing review can create a daily pick",()=>{
  assert.deepEqual(dailyLearningPicks([pr(1),pr(2,{kind:"maintenance"}),pr(3,{kind:"local-fix"}),pr(4,{evidence:2}),pr(5,{learning:3}),pr(6,{architecture:3,performance:3})]),[]);
});
test("maximum three mechanisms, deduplicated across repositories and ranked by learning",()=>{
  const result=dailyLearningPicks([pr(1,{topic:"stream-lifetime"}),pr(2,{topic:"stream-lifetime",learning:5}),pr(3,{}),pr(4,{}),pr(5,{})]);
  assert.equal(result.length,3);assert.equal(result[0].id,2);assert.ok(!result.some(p=>p.id===1));
});
test("sparse days stay sparse; no quota filling",()=>{
  assert.equal(dailyLearningPicks([pr(1,{performance:5,architecture:1}),pr(2,{learning:2})]).length,1);
});
test("curation rejects malformed scores and noncanonical topic identifiers",()=>{
  assert.throws(()=>validateFocus({architecture:6,performance:4,learning:4,evidence:4,kind:"mechanism",topic:"kv-cache"}));
  assert.throws(()=>validateFocus({architecture:4,performance:4,learning:4,evidence:4,kind:"mechanism",topic:"http://example.com"}));
});
