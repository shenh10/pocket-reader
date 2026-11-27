import assert from 'node:assert/strict';
import fs from 'node:fs';
// Finite abstract ownership model; no cache, proxy, PTX, warp scheduling or timing.
// p: write/publish; c: start/source-read-complete/return. Each actor is ordered.
function explore(stages, tiles, requireEmpty) {
  const initial = {p:0, ps:0, c:0, cs:0, version:Array(stages).fill(-1), full:Array(stages).fill(-1), returned:Array(stages).fill(-1)};
  const queue = [{s:initial, trace:[]}], seen = new Set();
  let transitions=0, terminal=0, violationObservations=0, activeOverwrite=null, overlap=null;
  for(let h=0;h<queue.length;h++) {
    const {s,trace}=queue[h], key=JSON.stringify(s);
    if(seen.has(key)) continue;
    seen.add(key);
    if(s.p===tiles && s.c===tiles) terminal++;
    const next=[];
    if(s.p<tiles) {
      const slot=s.p%stages, previous=s.p-stages;
      if(s.ps===0 && (!requireEmpty || previous<0 || s.returned[slot]===previous)) {
        const n=structuredClone(s); n.version[slot]=s.p; n.ps=1;
        const e=`W${s.p}[slot${slot}]`;
        if(previous>=0 && s.returned[slot]!==previous) {
          violationObservations++;
          if(s.cs===1 && s.c%stages===slot && !activeOverwrite) activeOverwrite=[...trace,e];
        }
        if(s.p===1 && s.c===0 && s.cs===1 && !overlap) overlap=[...trace,e];
        next.push([n,e]);
      } else if(s.ps===1) {
        const n=structuredClone(s); n.full[slot]=s.p; n.p++; n.ps=0;
        next.push([n,`full${s.p}`]);
      }
    }
    if(s.c<tiles) {
      const slot=s.c%stages;
      if(s.cs===0 && s.full[slot]===s.c) {
        const n=structuredClone(s); n.cs=1; next.push([n,`beginRead${s.c}`]);
      } else if(s.cs===1) {
        if(s.version[slot]!==s.c) violationObservations++;
        const n=structuredClone(s); n.cs=2; next.push([n,`sourceReadDone${s.c}`]);
      } else if(s.cs===2) {
        const n=structuredClone(s); n.returned[slot]=s.c; n.c++; n.cs=0;
        next.push([n,`empty${s.c}`]);
      }
    }
    transitions+=next.length;
    for(const [n,e] of next) queue.push({s:n,trace:[...trace,e]});
  }
  return {stages,tiles,requireEmpty,states:seen.size,transitions,terminal,violationObservations,activeOverwrite,overlap};
}
const serial=explore(1,4,true), double=explore(2,4,true), missingReverse=explore(2,4,false);
assert.equal(serial.violationObservations,0); assert.equal(double.violationObservations,0);
assert.ok(serial.terminal>0 && double.terminal>0); assert.ok(double.overlap);
assert.ok(missingReverse.activeOverwrite);
// Scheduling toy model: capacity 2, 2 consumers spin without yielding residency,
// one producer not admitted yet. Enumerate admissions, not real CUDA scheduling.
const capacity=2;
function residencySearch() {
  const q=[{resident:[],queued:['consumer0','consumer1','producer'],done:false,trace:[]}];
  const seen=new Set(); let witness=null;
  for(let h=0;h<q.length;h++) {
    const s=q[h], key=JSON.stringify([s.resident,s.queued,s.done]);
    if(seen.has(key)) continue; seen.add(key);
    const next=[];
    if(s.resident.length<capacity) for(const id of s.queued) next.push({resident:[...s.resident,id].sort(),queued:s.queued.filter(x=>x!==id),done:s.done,trace:[...s.trace,`admit ${id}`]});
    for(const id of s.resident) if(id==='producer' || s.done) next.push({resident:s.resident.filter(x=>x!==id),queued:s.queued,done:s.done || id==='producer',trace:[...s.trace,`complete ${id}`]});
    if(next.length===0 && s.queued.includes('producer')) witness ??= {...s,enabledTransitions:[]};
    q.push(...next);
  }
  assert.ok(witness);
  return {capacity,states:seen.size,assumptions:['CTA residency held until completion','waiting consumers busy-wait and cannot complete before producer','no preemption/residency guarantee'],...witness};
}
const residencyWitness=residencySearch();
const result={kind:'bounded CPU finite-state/event model',bounds:'4 tiles; 1 ordered producer; 1 ordered consumer; 1 or 2 slots; whole-tile write/read abstract events',assumptions:['full(g) implies correct visibility for generation g (assumed, not proved)','empty(g) follows asynchronous source read completion','generation labels abstract hardware phase protocol','enabled events may be interleaved arbitrarily; no latency model'],serial,double,missingReverse,residencyWitness,limitations:['not a GPU simulator or memory-model proof','no failure probabilities','safety checked only for listed finite state bounds','reachability of completion is not universal scheduler liveness']};
fs.writeFileSync(new URL('./model-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
