#!/usr/bin/env python3
"""Educational FlashInfer decode benchmark. Requires a compatible CUDA environment.
API based on FlashInfer 3a234053 (2025-11-19); no GPU run performed by the author.
Reports wrapper boundaries, NOT isolated kernel time or end-to-end serving latency.
"""
import argparse
import json
import math
import statistics
import time


def arguments():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--batch', type=int, default=4)
    p.add_argument('--kv-len', type=int, default=4096)
    p.add_argument('--page-size', type=int, default=16)
    p.add_argument('--heads', type=int, default=32)
    p.add_argument('--kv-heads', type=int, default=4)
    p.add_argument('--head-dim', type=int, default=128)
    p.add_argument('--dtype', choices=['float16', 'bfloat16'], default='float16')
    p.add_argument('--repeats', type=int, default=30)
    p.add_argument('--inner', type=int, default=20)
    p.add_argument('--seed', type=int, default=17)
    p.add_argument('--output', default='decode-boundaries.json')
    a = p.parse_args()
    for k in ['batch','kv_len','page_size','heads','kv_heads','head_dim','repeats','inner']:
        if getattr(a,k) <= 0: p.error(k+' must be positive')
    if a.heads % a.kv_heads: p.error('heads must be divisible by kv-heads')
    return a


def main():
    a = arguments()  # --help works without torch/FlashInfer.
    import torch
    import flashinfer
    if not torch.cuda.is_available(): raise SystemExit('CUDA GPU required; no synthetic measurements emitted.')
    torch.manual_seed(a.seed)
    dtype = getattr(torch,a.dtype)
    pages = math.ceil(a.kv_len/a.page_size)
    indptr_cpu = torch.arange(a.batch+1,dtype=torch.int32)*pages
    last_cpu = torch.full((a.batch,), (a.kv_len-1)%a.page_size+1,dtype=torch.int32)
    indices = torch.arange(a.batch*pages,dtype=torch.int32,device='cuda')
    indptr_gpu, last_gpu = indptr_cpu.cuda(), last_cpu.cuda()
    q = torch.randn(a.batch,a.heads,a.head_dim,device='cuda',dtype=dtype)
    kv = torch.randn(a.batch*pages,2,a.page_size,a.kv_heads,a.head_dim,device='cuda',dtype=dtype)
    # Independent dense FP32 reference; built outside timing.
    ref=[]
    for b in range(a.batch):
        k,v=(kv[b*pages:(b+1)*pages,j].reshape(-1,a.kv_heads,a.head_dim)[:a.kv_len].float().repeat_interleave(a.heads//a.kv_heads,dim=1) for j in [0,1])
        p=torch.softmax(torch.einsum('hd,thd->ht',q[b].float(),k)/math.sqrt(a.head_dim),dim=-1)
        ref.append(torch.einsum('ht,thd->hd',p,v))
    reference=torch.stack(ref)
    records=[]
    def summary(xs):
        ys=sorted(xs)
        return {'median_us':statistics.median(ys),'p95_us':ys[math.ceil(.95*len(ys))-1],'samples_us':xs}
    for tc in [False,True]:
        record={'tensor_cores':tc}
        try:
            workspace=torch.empty(128*1024*1024,dtype=torch.uint8,device='cuda')
            wrapper=flashinfer.BatchDecodeWithPagedKVCacheWrapper(workspace,'NHD',use_cuda_graph=True,
                use_tensor_cores=tc,paged_kv_indptr_buffer=indptr_gpu,
                paged_kv_indices_buffer=indices,paged_kv_last_page_len_buffer=last_gpu,backend='auto')
            def plan():
                wrapper.plan(indptr_cpu,indices,last_cpu,a.heads,a.kv_heads,a.head_dim,a.page_size,
                    q_data_type=dtype,kv_data_type=dtype)
            torch.cuda.synchronize(); start=time.perf_counter(); plan(); torch.cuda.synchronize()
            record['first_plan_ms']=(time.perf_counter()-start)*1e3
            plan_samples=[]
            for _ in range(5):
                torch.cuda.synchronize(); start=time.perf_counter(); plan(); torch.cuda.synchronize()
                plan_samples.append((time.perf_counter()-start)*1e6)
            record['warm_plan_sync_wall']=summary(plan_samples)
            out=torch.empty_like(q)
            def run(): return wrapper.run(q,kv,out=out)
            stream=torch.cuda.Stream(); stream.wait_stream(torch.cuda.current_stream())
            with torch.cuda.stream(stream):
                for _ in range(10): run()
            torch.cuda.current_stream().wait_stream(stream); torch.cuda.synchronize()
            torch.testing.assert_close(out.float(),reference,rtol=.02,atol=.02)
            record['max_abs_error']=(out.float()-reference).abs().max().item()
            # Capture one invocation with fixed buffers; warm first replay excluded.
            graph=torch.cuda.CUDAGraph()
            with torch.cuda.graph(graph): run()
            graph.replay(); torch.cuda.synchronize()
            torch.testing.assert_close(out.float(),reference,rtol=.02,atol=.02)
            samples={k:[] for k in ['eager_sync_wall','eager_stream_span','graph_replay_stream_span']}
            start_evt,end_evt=(torch.cuda.Event(enable_timing=True) for _ in range(2))
            # Interleave the three measurement boundaries. A/B backends remain sequential.
            for _ in range(a.repeats):
                torch.cuda.synchronize(); t=time.perf_counter(); run(); torch.cuda.synchronize()
                samples['eager_sync_wall'].append((time.perf_counter()-t)*1e6)
                for name,fn in [('eager_stream_span',run),('graph_replay_stream_span',graph.replay)]:
                    start_evt.record()
                    for _ in range(a.inner): fn()
                    end_evt.record(); end_evt.synchronize()
                    samples[name].append(start_evt.elapsed_time(end_evt)*1e3/a.inner)
            record['timings']={k:summary(v) for k,v in samples.items()}
            record['status']='passed'
        except Exception as e:
            record.update(status='failed',error=type(e).__name__+': '+str(e))
        records.append(record)
    result={'config':vars(a),'environment':{'torch':torch.__version__,'flashinfer':getattr(flashinfer,'__version__','unknown'),
        'cuda_runtime':torch.version.cuda,'gpu':torch.cuda.get_device_name(),'capability':torch.cuda.get_device_capability()},
        'method':{'cache':'reused input buffers, no explicit L2 flush','allocation':'preallocated out; plan/capture outside run samples',
        'limits':'event spans may include host enqueue gaps; sync-wall includes synchronization overhead; not serving latency; backend trials sequential; initial JIT caches may be warm',
        'wrapper':'use_cuda_graph=True in all three modes, for comparable planning'},'results':records}
    with open(a.output,'w') as f: json.dump(result,f,indent=2)
    print(json.dumps(result,indent=2))
    if any(r['status']!='passed' for r in records): raise SystemExit(1)

if __name__=='__main__': main()
