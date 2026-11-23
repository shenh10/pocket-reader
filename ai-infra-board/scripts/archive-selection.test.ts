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
