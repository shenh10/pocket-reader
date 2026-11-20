// Deterministic CPU teaching models. These do not execute or time GPU kernels.
export function attentionState(scores, values) {
  if (scores.length !== values.length) throw new Error('shape mismatch');
  const valid = scores.map((s, i) => [s, values[i]]).filter(([s]) => s !== -Infinity);
  if (!valid.length) return {m: -Infinity, l: 0, u: 0, o: 0, lse: -Infinity};
  if (valid.some(([s, v]) => !Number.isFinite(s) || !Number.isFinite(v))) throw new Error('invalid value');
  const m = Math.max(...valid.map(([s]) => s));
  let l = 0, u = 0;
  for (const [s, v] of valid) { const p = Math.exp(s - m); l += p; u += p * v; }
  return {m, l, u, o: u / l, lse: m + Math.log(l)};
}

export function mergeState(a, b) {
  if (!a.l) return {...b};
  if (!b.l) return {...a};
  const m = Math.max(a.m, b.m), alpha = Math.exp(a.m - m), beta = Math.exp(b.m - m);
  const l = alpha * a.l + beta * b.l, u = alpha * a.u + beta * b.u;
  return {m, l, u, o: u / l, lse: m + Math.log(l)};
}

export function splitAttention(scores, values, chunk) {
  if (!Number.isInteger(chunk) || chunk < 1) throw new Error('invalid chunk');
  const states = [], running = [];
  let state = attentionState([], []);
  for (let i = 0; i < scores.length; i += chunk) {
    const part = attentionState(scores.slice(i, i + chunk), values.slice(i, i + chunk));
    states.push(part); state = mergeState(state, part); running.push(state);
  }
  const maxLSE = Math.max(-Infinity, ...states.map(s => s.lse));
  const mass = states.map(s => s.l ? Math.exp(s.lse - maxLSE) : 0);
  const sum = mass.reduce((a, b) => a + b, 0);
  const weights = mass.map(w => sum ? w / sum : 0);
  return {states, running, weights, output: states.reduce((s, part, i) => s + weights[i] * part.o, 0), direct: attentionState(scores, values).o};
}

export function pagedOffset(token, head, layout = 'NHD', feature = 9) {
  if (!Number.isInteger(token) || token < 0 || token >= 37 || !Number.isInteger(head) || head < 0 || head >= 8 || !['NHD','HND'].includes(layout) || !Number.isInteger(feature) || feature < 0 || feature >= 128) throw new Error('invalid cache index');
  const pageIter = Math.floor(token / 16), physicalPage = [7, 2, 11][pageIter], entry = token % 16;
  const strideH = layout === 'NHD' ? 128 : 2048, strideN = layout === 'NHD' ? 1024 : 128;
  const offset = physicalPage * 16384 + head * strideH + entry * strideN + feature;
  return {pageIter, physicalPage, entry, strideH, strideN, offset, bytes: offset * 2};
}

export function blackwellBudget(d, q, cta) {
  if (![64,128].includes(d) || ![1,2].includes(q) || ![1,2].includes(cta)) throw new Error('unsupported teaching configuration');
  const qBytes = q * 128 * d * 2, oBytes = qBytes, kvBytes = 128 * d * 2 / cta;
  const stages = Math.floor((224 * 1024 - qBytes - oBytes) / kvBytes);
  const columns = 256 + q * d;
  return {qBytes, oBytes, kvBytes, stages, columns, dataBytes: qBytes + oBytes + stages * kvBytes};
}

export function makeRoutes(tokens, experts, k, pattern = 'balanced') {
  if (![tokens, experts, k].every(Number.isInteger) || tokens < 1 || experts < 1 || k < 1 || k > experts) throw new Error('invalid routing shape');
  if (tokens === 4 && experts === 4 && k === 2 && pattern === 'balanced') return [[0,2],[1,2],[0,3],[2,3]];
  return Array.from({length: tokens}, (_, t) => Array.from({length: k}, (_, j) => pattern === 'hot' ? j : (t * k + j) % experts));
}

export function alignRoutes(routes, experts, block) {
  const k = routes[0]?.length || 0, assignments = routes.length * k;
  if (!Number.isInteger(experts) || experts < 1 || !Number.isInteger(block) || block < 1 || !k || routes.some(row => row.length !== k || row.some(e => !Number.isInteger(e) || e < 0 || e >= experts))) throw new Error('invalid alignment input');
  const groups = Array.from({length: experts}, () => []);
  routes.forEach((row,t) => row.forEach((e,j) => groups[e].push(t * k + j)));
  const padded = groups.map(g => [...g, ...Array((block - g.length % block) % block).fill(assignments)]);
  const sorted = padded.flat(), expertIds = padded.flatMap((g,e) => Array(g.length / block).fill(e));
  const counts = groups.map(g => g.length), total = sorted.length;
  return {k, assignments, groups, padded, sorted, expertIds, counts, total, padding: total ? (total - assignments) / total : 0};
}

export function rankTraffic(experts, hidden, bytes, source = 0) {
  const ranks = experts.map(e => Math.floor(e / 2));
  const distinct = [...new Set(ranks)], remote = distinct.filter(r => r !== source);
  return {ranks, distinct, remote, assignmentBytes: experts.length * hidden * bytes, rankBytes: distinct.length * hidden * bytes, remoteBytes: remote.length * hidden * bytes};
}

const fmt = (n, places = 5) => n === -Infinity ? '−∞' : n.toFixed(places);
const kib = n => `${(n / 1024).toLocaleString('en-US', {maximumFractionDigits: 2})} KiB`;
const metric = (value, label) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
const table = (headers, rows) => `<div class="scroller"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
function mount() {
  const get = id => document.getElementById(id);
  function bind(ids, fn) { ids.forEach(id => get(id).addEventListener('input', fn)); fn(); }
  if (get('page-lab')) bind(['kv-token','kv-head','kv-layout'], () => {
    const t = +get('kv-token').value, h = +get('kv-head').value, layout = get('kv-layout').value, r = pagedOffset(t,h,layout);
    get('page-result').innerHTML = `<p>逻辑 token <b>${t}</b> → 页表索引 <b>${r.pageIter}</b> → 物理 page <b>${r.physicalPage}</b> → 页内位置 <b>${r.entry}</b>。</p><div class="equation">${r.physicalPage} × 16384 + ${h} × ${r.strideH} + ${r.entry} × ${r.strideN} + 9 = ${r.offset} 个元素</div><p>FP16 字节偏移 <b>${r.bytes}</b>；相对于各自 K / V 基地址。该位置有效，最后有效 token 是 36。</p>`;
  });
  if (get('softmax-lab')) bind(['soft-chunk','soft-case'], () => {
    const kind = get('soft-case').value, chunk = +get('soft-chunk').value, values = [1,4,-2,3,5,-1];
    let scores = [2,-1,3,0,4,-2];
    if (kind === 'large') scores = scores.map(s => s + 1000);
    if (kind === 'masked') scores = scores.map((s,i) => i >= 4 ? -Infinity : s);
    if (kind === 'empty') scores = scores.map(() => -Infinity);
    const r = splitAttention(scores,values,chunk), avg = r.states.reduce((s,p) => s + p.o,0) / r.states.length;
    get('softmax-result').innerHTML = `<p>V=[${values.join(', ')}]；本实验的 m/LSE 均使用自然对数单位。</p>` + table(['块 / token 范围','块 m / l','局部 O','累计 m / l','累计 O','合并权重'],r.states.map((p,i) => [`${i} / ${i*chunk}…${Math.min(scores.length-1,(i+1)*chunk-1)}`,`${fmt(p.m,2)} / ${fmt(p.l)}`,fmt(p.o),`${fmt(r.running[i].m,2)} / ${fmt(r.running[i].l)}`,fmt(r.running[i].o),fmt(r.weights[i])])) + `<div class="metrics">${metric(fmt(r.output),'LSE 加权合并')}${metric(fmt(r.direct),'直接 softmax reference')}${metric(fmt(avg),'局部 O 的简单平均')}</div><p class="result ok">合并绝对误差 ${Math.abs(r.output-r.direct).toExponential(2)}。${kind === 'empty' ? '全 masked：使用显式零质量约定，不计算 −∞−(−∞)。' : `简单平均误差 ${Math.abs(avg-r.direct).toExponential(2)}；质量不同的分区不能等权。`}</p>`;
  });
  if (get('budget-lab')) bind(['bw-d','bw-q','bw-cta'], () => {
    const d=+get('bw-d').value,q=+get('bw-q').value,cta=+get('bw-cta').value,r=blackwellBudget(d,q,cta);
    get('budget-result').innerHTML = `<div class="metrics">${metric(r.stages,'KV stage 数')}${metric(`${r.columns} / 512`,'TMEM 列数预算')}${metric(kib(r.dataBytes),'每 CTA 名义 SMEM 数据')}</div><p class="result">Q=${kib(r.qBytes)}，O=${kib(r.oBytes)}；每 KV stage=${kib(r.kvBytes)}。floor((224 KiB−Q−O)/KV)=${r.stages}。cluster MMA 的 M=${cta*128}；${cta===2 ? '这里字节数按每 CTA 计算。' : '单 CTA 配置。'} 不含额外元数据/对齐，不给出 occupancy 预测。</p>`;
  });
  if (get('dependency-lab')) {
    const steps = [
      ['Load → MMA','Q/K 当前 slot 已完成 TMA。之后才允许 QK 读取；此时不能覆盖 Q/K。'],
      ['QK → S ready','MMA 的完成协议通知 softmax。Q 在 KV 循环中仍会复用，不能随 K 一同释放。'],
      ['Softmax → stats / P 前段','S 读入寄存器，更新尺度，发布 P 前 96 列；correction 同时处理旧 O。'],
      ['Correction → O rescaled','O 重缩放写回并 fence。P 前段 + O 可用 + V ready 才允许启动相应 PV。'],
      ['P 尾段 → PV 完成','剩余 32 列 P 发布后，PV 可完成后续部分；必须遵守尾段 barrier。'],
      ['下一轮 / 最终 epilogue','后续依赖允许复用；末轮等待 O 完成、最终归一化、存储并释放资源。']
    ];
    let current=0;
    const render=()=>{
      get('dependency-steps').innerHTML=steps.map(([label],i)=>`<div class="${i===current?'active':i<current?'past':'pending'}" ${i===current?'aria-current="step"':''}>${label}</div>`).join('');
      get('dependency-result').textContent=steps[current][1];
      get('dependency-next').disabled=current===steps.length-1;
      get('dependency-next').textContent=current===steps.length-1?'本轮依赖已走完':'下一步';
    };
    get('dependency-next').addEventListener('click',()=>{current=Math.min(current+1,steps.length-1);render();});
    get('dependency-reset').addEventListener('click',()=>{current=0;render();});render();
  }
  if (get('moe-lab')) bind(['moe-t','moe-e','moe-k','moe-b','moe-pattern'],()=>{
    const t=+get('moe-t').value,e=+get('moe-e').value,k=+get('moe-k').value,b=+get('moe-b').value;
    const routes=makeRoutes(t,e,k,get('moe-pattern').value),r=alignRoutes(routes,e,b),h=4096,inter=14336;
    const realFlops=6*t*k*h*inter, writes=t*k*(3*inter+h)*2;
    let html=`<div class="metrics">${metric(`${r.assignments} → ${r.total}`,'真实 assignment → 补齐槽位')}${metric(`${(r.padding*100).toFixed(1)}%`,'padding 占总槽位')}${metric(Math.max(...r.counts),'最热 expert 的真实行数')}</div>`;
    html+=table(['token','top-k experts','assignment IDs'],routes.slice(0,8).map((row,i)=>[i,row.join(', '),row.map((_,j)=>i*k+j).join(', ')]));
    html+=`<p class="muted">显示前 ${Math.min(t,8)} 个 token；每个 expert 最多显示 32 个槽位。斜线「·」为 sentinel ${r.assignments}。</p>`;
    html+=r.padded.map((group,i)=>`<div class="row-label">E${i} · ${r.counts[i]} 有效 / ${group.length} 补齐 / ${group.length/b} blocks</div><div class="cells">${group.slice(0,32).map(a=>`<span class="cell ${a===r.assignments?'pad':''}">${a===r.assignments?'·':a}</span>`).join('')}${group.length>32?'<span>…</span>':''}${group.length===0?'<span class="muted">无 block</span>':''}</div>`).join('');
    html+=`<p class="result">有效 GEMM 工作量 ${(realFlops/1e9).toFixed(3)} GFLOP；按行补齐估算 ${(6*r.total*h*inter/1e9).toFixed(3)} GFLOP。三个中间结果的最低写入量 ${(writes/1048576).toFixed(3)} MiB（不计读回和权重）。这里展示 aligned 路径，不自动切换 naive / TMA / fused combine。</p>`;
    get('moe-result').innerHTML=html;
  });
  if (get('traffic-lab')) bind(['ep-route','ep-h','ep-bytes'],()=>{
    const routes={packed:[0,1,4,5],spread:[0,2,4,6],remote:[2,3,6,7]};
    const experts=routes[get('ep-route').value],h=+get('ep-h').value,bytes=+get('ep-bytes').value,r=rankTraffic(experts,h,bytes);
    get('traffic-result').innerHTML=`<p>源 rank=0；expert [${experts.join(',')}] → rank [${r.ranks.join(',')}] → 去重 {${r.distinct.join(',')}}。</p><div class="metrics">${metric(kib(r.assignmentBytes),'按 4 个 assignment 重复计算')}${metric(kib(r.rankBytes),'按目的 rank 去重，含本地')}${metric(kib(r.remoteBytes),'仅远端 dispatch 激活 payload')}</div><p class="result">expert GEMM 仍有 4 个 assignment；远端目的 rank 共 ${r.remote.length} 个。${bytes===1?'FP8 的 scales 和 metadata 尚未计入。':''} 展开布局和 combine 不在此流量模型内。</p>`;
  });
}
if (typeof document !== 'undefined') mount();
