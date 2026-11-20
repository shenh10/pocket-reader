import assert from 'node:assert/strict';
import {sgTensorCore,decodeRoute,rankCosts,pingPongGate,slotHistory} from './path-labs.mjs';
assert.equal(sgTensorCore({dtype:'bf16',gqa:2}),false);
assert.equal(sgTensorCore({dtype:'bf16',gqa:4}),true);
assert.equal(sgTensorCore({dtype:'fp8',gqa:1}),true);
assert.equal(sgTensorCore({dtype:'fp8',gqa:8,override:'1'}),false);
assert.equal(sgTensorCore({dtype:'fp16',gqa:1,override:'TRUE'}),true);
assert.equal(sgTensorCore({dtype:'fp8',gqa:8,legacy:'supported'}),false);
assert.equal(sgTensorCore({dtype:'bf16',gqa:1,legacy:'unsupported'}),true);
assert.equal(decodeRoute({framework:'vllm',trt:true,dcp:1}).at(-1),'trtllm_batch_decode_with_kv_cache');
assert.match(decodeRoute({framework:'vllm',trt:true,dcp:2}).at(-1),/DCP/);
const ranks=rankCosts({da:8,ha:30,db:12,hb:2,graph:3});
assert.deepEqual(ranks.map(r=>r.winner),['A','B','A']);
assert.ok(Math.abs(ranks[1].regretA-171.42857142857142)<1e-10);
assert.throws(()=>rankCosts({da:0,ha:0,db:1,hb:0,graph:0}));
for(const head of [64,128]){
 const threshold=head===64?16:64;
 assert.equal(pingPongGate({head,seq:(2*threshold-2)*128,splits:2}).enabled,false);
 assert.equal(pingPongGate({head,seq:(2*threshold-1)*128,splits:2}).enabled,true);
 assert.equal(pingPongGate({head,seq:1,splits:1}).enabled,true);
}
assert.equal(pingPongGate({head:256}).enabled,false);
assert.equal(pingPongGate({page:64}).enabled,false);
assert.equal(pingPongGate({two:true}).enabled,false);
assert.equal(pingPongGate({disabled:true}).enabled,false);
assert.deepEqual(slotHistory(6).map(x=>[x.slot,x.phase]),[[0,0],[1,0],[0,1],[1,1],[0,0],[1,0]]);
assert.deepEqual(slotHistory(2,3).map(x=>[x.slot,x.phase]),[[1,1],[0,0]]);
console.log('PASS: routing, overrides, ranking, split thresholds, slot/phase wraparound');
