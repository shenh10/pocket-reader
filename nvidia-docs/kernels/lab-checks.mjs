// Run with: node nvidia-docs/kernels/lab-checks.mjs
// CPU references verify numerical/indexing models, not GPU implementations.
import assert from 'node:assert/strict';
import {attentionState, mergeState, splitAttention, pagedOffset, blackwellBudget, makeRoutes, alignRoutes, rankTraffic} from './labs.mjs';

let checks=0, moeConfigs=0;
function near(a,b,tol=1e-10){assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);checks++;}
const scores=[2,-1,3,0,4,-2],values=[1,4,-2,3,5,-1];
const direct=attentionState(scores,values).o;
for(const s of [scores,scores.map(v=>v+1000),scores.map((v,i)=>i>3?-Infinity:v),scores.map(()=>-Infinity)]){
  for(const size of [1,2,3,4,6,10]){
    const r=splitAttention(s,values,size);
    near(r.output,r.direct);near(r.running.at(-1).o,r.direct);
    near(r.weights.reduce((a,b)=>a+b,0),s.every(v=>v===-Infinity)?0:1);
  }
}
near(attentionState(scores.map(v=>v+1000),values).o,direct);
assert.ok(Math.abs(splitAttention(scores,values,2).states.reduce((s,p)=>s+p.o,0)/3-direct)>0.1);checks++;
// Test arbitrary partitions with extreme logit range and masked partitions.
for(let n=1;n<=39;n++){
  const ss=Array.from({length:n},(_,i)=>i%7===0?-Infinity:Math.sin(i*13+n)*800);
  const vv=ss.map((_,i)=>Math.cos(i*7)*3);
  for(const size of [1,3,7,16])near(splitAttention(ss,vv,size).output,attentionState(ss,vv).o);
  const m=mergeState(attentionState(ss.slice(0,5),vv.slice(0,5)),attentionState(ss.slice(5),vv.slice(5)));
  near(m.o,attentionState(ss,vv).o);
}
assert.equal(pagedOffset(18,3,'NHD').offset,35209);
assert.equal(pagedOffset(18,3,'HND').offset,39177);
assert.equal(pagedOffset(36,7).entry,4);
assert.throws(()=>pagedOffset(37,0));checks+=4;
// Build independent physical cache indexing, verify every valid logical position.
for(const layout of ['NHD','HND'])for(let t=0;t<37;t++)for(let h=0;h<8;h++){
  const p=[7,2,11][Math.floor(t/16)],r=t%16;
  const expected=layout==='NHD'?((p*16+r)*8+h)*128+9:((p*8+h)*16+r)*128+9;
  assert.equal(pagedOffset(t,h,layout).offset,expected);checks++;
}
assert.deepEqual(blackwellBudget(128,2,1),{qBytes:65536,oBytes:65536,kvBytes:32768,stages:3,columns:512,dataBytes:229376});checks++;

// MoE: independent naive per-token reference vs expert-block gather/scatter.
const dot=(x,w)=>x.reduce((s,a,i)=>s+a*w[i],0),silu=x=>x/(1+Math.exp(-x));
for(const T of [1,4,7,16])for(const E of [4,8])for(const k of [1,2,4])for(const block of [4,16])for(const pattern of ['balanced','hot']){
  moeConfigs++;
  const H=3,I=2,routes=makeRoutes(T,E,k,pattern),r=alignRoutes(routes,E,block);
  const x=Array.from({length:T},(_,t)=>Array.from({length:H},(_,h)=>Math.sin(t*H+h+1)));
  const w1=Array.from({length:E},(_,e)=>Array.from({length:2*I},(_,i)=>Array.from({length:H},(_,h)=>Math.cos(e*23+i*5+h)/3)));
  const w2=Array.from({length:E},(_,e)=>Array.from({length:H},(_,h)=>Array.from({length:I},(_,i)=>Math.sin(e*17+h*3+i)/3)));
  const weight=Array.from({length:T*k},(_,a)=>(a%k+1)/(k*(k+1)/2));
  const ref=x.map((row,t)=>Array.from({length:H},(_,h)=>routes[t].reduce((sum,e,j)=>{
    const gate=Array.from({length:I},(_,i)=>silu(dot(row,w1[e][i]))*dot(row,w1[e][i+I]));
    return sum+weight[t*k+j]*dot(gate,w2[e][h]);
  },0)));
  const first=Array.from({length:T*k},()=>Array(2*I).fill(0));
  r.sorted.forEach((a,index)=>{if(a>=T*k)return;const e=r.expertIds[Math.floor(index/block)];first[a]=w1[e].map(w=>dot(x[Math.floor(a/k)],w));});
  const activated=first.map(g=>Array.from({length:I},(_,i)=>silu(g[i])*g[i+I]));
  const second=Array.from({length:T*k},()=>Array(H).fill(0));
  r.sorted.forEach((a,index)=>{if(a>=T*k)return;const e=r.expertIds[Math.floor(index/block)];second[a]=w2[e].map(w=>dot(activated[a],w)*weight[a]);});
  for(let t=0;t<T;t++)for(let h=0;h<H;h++)near(second.slice(t*k,(t+1)*k).reduce((s,v)=>s+v[h],0),ref[t][h]);
  assert.equal(r.sorted.filter(a=>a<T*k).length,T*k);
  assert.equal(new Set(r.sorted.filter(a=>a<T*k)).size,T*k);checks+=2;
}
const aligned=alignRoutes([[0,2],[1,2],[0,3],[2,3]],4,4);
assert.deepEqual(aligned.sorted,[0,4,8,8,2,8,8,8,1,3,6,8,5,7,8,8]);checks++;
const packed=rankTraffic([0,1,4,5],7168,2);
assert.deepEqual(packed.distinct,[0,2]);assert.equal(packed.remoteBytes,14336);checks+=2;
const spread=rankTraffic([0,2,4,6],7168,2);
assert.equal(spread.remoteBytes,3*14336);checks++;
console.log(`PASS: ${checks} CPU numerical/indexing checks; ${moeConfigs} MoE shape/distribution configurations. No GPU benchmarks executed.`);
