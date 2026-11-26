import test from "node:test";
import assert from "node:assert/strict";
import {selectArchiveCandidate as select} from "../src/server/archive-selection";
const source=[{path:"src/kernel.py"}];
test("repository words and body templates cannot turn maintenance into a mechanism",()=>{
  assert.equal(select({title:"[CI][ROCm] Fix FP8 MoE pipeline job",files:source,changedFiles:1}).keep,false);
  assert.equal(select({title:"[Perf] tune attention",files:[{path:"docs/attention.md"}],changedFiles:1}).keep,false);
});
test("protect personal state and completed analyses, including low-scored completed ones",()=>{
  for(const state of [{favorite:true},{watch_later:true},{note:"my notes"},{completed:true}])
    assert.equal(select({title:"[Docs] typo",...state}).keep,true);
});
test("retain subtle core fixes irrespective of old importance or title tags",()=>{
  for(const title of ["[Bugfix][DCP] Handle sparse MLA metadata after DCP Manager refactor",
    "[Fix] mamba: Use the intermediate state buffer stride during Triton verify",
    "feat(cake_mla): NVFP4 paged latent cache", "[Perf] share CUDA graph pool"])
    assert.equal(select({title,files:source,changedFiles:1}).keep,true,title);
});
test("do not infer docs-only from an incomplete file listing",()=>{
  assert.equal(select({title:"Unclear change",files:[{path:"docs/readme.md"}],changedFiles:3}).keep,true);
  assert.equal(select({title:"Unclear change",files:null}).keep,true);
});
test("ordinary model adaptation without a mechanism is filtered",()=>{
  assert.equal(select({title:"[Model] Add support for Qwen model config",files:source,changedFiles:1}).keep,false);
});
test("a reviewed learning assessment overrides the intake heuristic",()=>{
  const focus={kind:"mechanism",architecture:4,performance:1,learning:4,evidence:3};
  assert.equal(select({title:"Unclear",focus}).keep,true);
  assert.equal(select({title:"[Perf] CUDA graph",focus:{...focus,kind:"maintenance"}}).keep,false);
});
test("tutorial content survives documentation triage and local-fix titles for review",()=>{
  for (const candidate of [
    {title:"[Docs] Rewrite router architecture guide",files:[{path:"ARCHITECTURE.md",additions:240}],changedFiles:1},
    {title:"[Docs] Add decode context parallelism",files:[{path:"docs/docs/advanced_features/dcp.mdx",additions:180}],changedFiles:1},
    {title:"[Doc] Document hybrid cache checkpoint levels",files:[{path:"docs/docs/advanced_features/hybrid_cache_checkpoints.mdx",additions:38}],changedFiles:1},
    {title:"[Fix] Adjust one synchronization point",files:source,changedFiles:1,
      body:"## How it works\n"+"The producer publishes data before signaling the reader. ".repeat(10)
        +"\n## Tradeoffs\n"+"A shared queue reduces memory at the cost of additional synchronization. ".repeat(10)},
  ]) assert.deepEqual(select(candidate),{keep:true,reason:"tutorial-content-review"});
});
test("a long template, recipe or cosmetic docs patch is not sufficient tutorial evidence",()=>{
  assert.equal(select({title:"[Docs] Fix typo in tutorial",files:[{path:"docs/tutorial.md",additions:1}],changedFiles:1}).keep,false);
  assert.equal(select({title:"[Docs] Add Qwen cookbook recipe",files:[{path:"docs/cookbook/qwen.mdx",additions:300}],changedFiles:1}).keep,false);
  assert.equal(select({title:"[Docs] Refresh flags",body:"## Summary\n"+"| field | value |\n".repeat(150),files:[{path:"docs/flags.md",additions:150}],changedFiles:1}).keep,false);
});
test("an explicitly reviewed tutorial can qualify on learning without a novel mechanism",()=>{
  assert.deepEqual(select({title:"[Docs] Guide",focus:{kind:"tutorial",learning:4,evidence:3,architecture:2,performance:1}}),
    {keep:true,reason:"evidence-reviewed-tutorial"});
});
