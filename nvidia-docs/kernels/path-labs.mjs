// Teaching models for explicitly pinned source snapshots, not GPU capability probes.
export function sgTensorCore({dtype, gqa, override = 'unset', legacy = 'absent'}) {
  if (override !== 'unset') return override.toLowerCase() === 'true';
  if (legacy !== 'absent') return legacy === 'unsupported';
  return dtype === 'fp8' || (['fp16', 'bf16'].includes(dtype) && gqa >= 4);
}
export function decodeRoute({framework, dtype='bf16', gqa=8, override='unset', legacy='absent', tc=true, trt=false, dcp=1}) {
  if (framework === 'vllm') return trt && dcp <= 1
    ? ['vLLM · 非 cascade decode', 'TRTLLMDecode 元数据', 'trtllm_batch_decode_with_kv_cache']
    : ['vLLM · 非 cascade decode', 'FIDecode / use_tensor_cores=True', 'fast_plan_decode → wrapper.run', dcp > 1 ? 'DCP all_gather + LSE combine' : '框架 wrapper 路径；具体模块看安装的 FlashInfer'];
  const enabled = framework === 'sglang' ? sgTensorCore({dtype,gqa,override,legacy}) : tc;
  return [framework === 'sglang' ? 'SGLang · FlashInferAttnBackend' : 'FlashInfer · 2025-11-19 / auto', enabled ? 'use_tensor_cores = True' : 'use_tensor_cores = False', ...(framework === 'sglang' ? ['wrapper.forward；下一层需核对安装版本'] : [enabled ? 'plan → get_batch_prefill_module("fa2")' : 'plan → get_batch_decode_module', enabled ? 'run → paged_run' : 'run → cached_module.run'])];
}
export function rankCosts({da,ha,db,hb,graph}) {
  if (![da,ha,db,hb,graph].every(x=>Number.isFinite(x)&&x>=0) || da<=0 || db<=0) throw new Error('时间必须为非负数，device 时间必须大于 0。');
  return [['device',da,db],['eager',da+ha,db+hb],['graph',da+graph,db+graph]].map(([mode,a,b])=>({mode,a,b,winner:a===b?'持平':a<b?'A':'B',regretA:(a/Math.min(a,b)-1)*100}));
}
export function pingPongGate({head=128,seq=8192,splits=1,page=128,two=false,mod=false,disabled=false}) {
  const blocks = Math.ceil(Math.ceil(seq/128)/splits), threshold=head===64?16:64;
  const reasons=[];
  if (![64,128].includes(head)) reasons.push('head_dim 不属于 64/128');
  if (![0,128].includes(page)) reasons.push('paged KV 的 page_size 必须为 128');
  if (two) reasons.push('2-CTA 路径不启用');
  if (mod) reasons.push('score/mask mod、block sparse、learnable sink 必须为空');
  if (disabled) reasons.push('禁用开关已开启');
  if (splits>1 && blocks<threshold) reasons.push(`每 split 估计 ${blocks} 个 KV block，低于 ${threshold}`);
  return {blocks,threshold,enabled:!reasons.length,reasons};
}
export function slotHistory(n,start=0) {
  return Array.from({length:n},(_,i)=>({count:i+start,slot:(i+start)&1,phase:((i+start)>>1)&1}));
}
const byId = id=>document.getElementById(id);
function mount() {
  const route=byId('route-lab');
  if(route) {
    const draw=()=>{
      const framework=byId('framework').value;
      route.querySelectorAll('[data-for]').forEach(el=>el.hidden=!el.dataset.for.split(' ').includes(framework));
      const path=decodeRoute({framework,dtype:byId('dtype').value,gqa:+byId('gqa').value,override:byId('override').value,legacy:byId('legacy').value,tc:byId('tc').value==='yes',trt:byId('trt').value==='yes',dcp:+byId('dcp').value});
      byId('route-output').replaceChildren(...path.map((t,i)=>{const s=document.createElement('span');const e=document.createElement('em');e.textContent=String(i+1).padStart(2,'0');s.append(e,document.createTextNode(t));return s;}));
    };route.addEventListener('change',draw);draw();
  }
  const rank=byId('ranking-lab');
  if(rank) {
    const draw=()=>{try{
      const v=Object.fromEntries(['da','ha','db','hb','graph'].map(k=>[k,Number(byId(k).value||NaN)]));
      const rows=rankCosts(v);byId('rank-output').innerHTML='<div class="scroller"><table><thead><tr><th>边界</th><th>A / μs</th><th>B / μs</th><th>更小者</th><th>选 A 的 regret</th></tr></thead><tbody>'+rows.map(r=>`<tr><th>${r.mode}</th><td>${r.a.toFixed(1)}</td><td>${r.b.toFixed(1)}</td><td>${r.winner}</td><td>${r.regretA.toFixed(1)}%</td></tr>`).join('')+'</tbody></table></div>';
    }catch(e){byId('rank-output').textContent=e.message;}};rank.addEventListener('input',draw);draw();
  }
  const gate=byId('gate-lab');
  if(gate){const draw=()=>{
    const g=pingPongGate({head:+byId('head').value,seq:+byId('seq').value,splits:+byId('splits').value,page:+byId('page').value,two:byId('two').checked,mod:byId('mod').checked,disabled:byId('disabled').checked});
    byId('gate-output').textContent=(g.enabled?'满足本实验列出的门槛。':'不启用：'+g.reasons.join('；'))+` 每 split 估计 ${g.blocks} 个 KV block。`;
    byId('gate-output').className='result '+(g.enabled?'ok':'bad');
  };gate.addEventListener('input',draw);draw();}
  const slots=byId('slot-lab');
  if(slots){const draw=()=>{
    const start=+byId('count-start').value;
    byId('slot-output').innerHTML='<div class="scroller"><table><thead><tr><th>全局计数</th><th>TMEM slot</th><th>barrier phase</th><th>S/P 列区间</th></tr></thead><tbody>'+slotHistory(6,start).map(x=>`<tr><td>${x.count}</td><td>${x.slot}</td><td>${x.phase}</td><td>${x.slot*128}–${x.slot*128+127}</td></tr>`).join('')+'</tbody></table></div>';
  };slots.addEventListener('input',draw);draw();}
}
if (typeof document !== 'undefined') mount();
