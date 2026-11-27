# Distinct-expert materialization: working-set research, not a published article

Scope: vLLM PR [#68086](https://github.com/vllm-project/vllm/pull/68086), inventory ID 21228, fixed head `3137a1eb0248e762347ae192fcd6d520db7807b2`, immediate base `a2915755bf1dcaf80623e36d079713bfb190c1e7`. Read the complete existing inventory deep_dive and archived PR body/files; fetched full immutable changed files and relevant downstream consumers. Only this research directory is owned. No database, existing article, or deployment changes. Model: GPT-6.1 Sol. GPU tests/benchmarks were not executed.

## Adoptable thesis

Graph capture does not require actual payload work to equal static buffer capacity. It requires the launch/allocation interface to remain valid for every replay. This implementation keeps capacity C fixed and moves the value-dependent work boundary U into GPU control flow. The necessary companion is an identity-preserving routing map and an end-to-end contract that no cross-row consumer observes unwritten state.

Define E local experts, N routed tokens, k top-k, M=N*k slots (including possible padding), U=number of distinct valid expert IDs, C=min(M,E). Always U<=C. These are not interchangeable:

- M governs routing entries and token-expert pairs; deduplication does **not** reduce the number of valid pairs or the useful mathematical GEMM FLOPs.
- U governs the useful expert weight working set to decode and materialize.
- C governs bf16 output shape, capacity allocation, and the expert dimension seen by GEMM configuration lookup. C is not measured U.

## Actual old baseline, not a straw man

`base/.../ocp_mx_emulation_moe.py:174-191,219-240` is the directly verified pre-change implementation (#68050 path): if 0<M<=E/4, sort all routed slots, gather one expert per slot, inverse-permute IDs, and dequantize those M slots. Repeated hits decode the same expert repeatedly. Above E/4, dequantize all E. Both branches avoid reading U on the host and have shape-only decisions. So immediate old work count is D_old=M if 0<M<=E/4, else E; it is **not always E**.

The PR author's additional “main” baseline used synced eager torch.unique for some large batches and allocates fewer experts when skewed; this is author-reported in archived body, not independently sourced here. Do not label the immediate base as torch.unique. The author reports an actual E256,k8,N16,U45 example with I256: main0.436ms / #68050 1.088ms / new0.285ms. Treat those as that author's MI355X measurements, not this research's reproduction or a general speed claim.

## How U is computed without shaping on U

Head `ocp_mx_routed_dequant.py:14-87`:

1. One Triton program iterates M IDs in BLOCK_N=1024 chunks, histogramming only IDs in [0,E). Its BLOCK_E is next_power_of_2(E). `present=counts>0`; cumsum(present)-1 gives rank; sum(present) gives device scalar num_used=U.
2. Store expert e at used[rank[e]], giving ascending valid prefix used[0:U]. Explicitly fill used[U:C]=-1. Also write rank[e] or -1 for all e<E.
3. A second launch reads the completed rank table, renumbers M entries in parallel, and maps negative/out-of-range IDs to -1. Launch ordering provides producer→consumer completion; there is no reliance on inter-program ordering within one kernel.
4. Host allocates used[C], rank[E], local_ids[M]. U is never copied to host and never used in a Python output shape. Actual IDs can change on replay while M/E/C stay fixed. This says nothing about replaying an arbitrary different shape in the same graph.

The `do_not_specialize=["num_ids"]` / `["num_slots"]` decorators are part of the actual implementation. The one-top1 edge case is explicitly tested. Do not casually remove these while presenting pseudocode as implementation equivalent.

## Correctness invariant is about identity, not sort order

For every valid route p, `used[local_ids[p]] == topk_ids[p]`, and local_ids[p] lies in [0,U). Invalid routes map to -1. Both W1 and W2 are materialized with the same used map; router weights retain their original token-slot positions. Thus replacing original expert e by local slot rank[e] leaves the selected expert function and weighted MoE sum intact. Duplicate routes now share a decoded weight slot, but retain all their token/weight contributions.

Example E32, IDs [[30,2],[2,17],[9,30],[17,4]]: M8,U5,C8; used=[2,4,9,17,30,-1,-1,-1], local=[[4,0],[0,3],[2,4],[3,1]]. Immediate baseline decodes eight slot experts; new decodes five; capacity still eight.

## Actual dispatch and loop: unused is cheap, not free

Head dequant file `110-196`: each expert consists of B32=Q/32 blocks of 32 quantized values. Output is allocated as [C,rows,cols] bf16 **before** kernel launch. For each of W1/W2, grid is `(ceil(B32/256), min(C,32))`, four warps/program. Let G=min(C,32). Slot-group g starts at g and advances g+G,g+2G,... while used[slot]>=0. Compaction means the first sentinel proves that all later slots of that group are unused. Exactly U experts undergo weight/scales loads, decode, and output stores.

Fixed grid programs and at least their sentinel reads still launch even if U is tiny; the payload work follows U, not the total launch count. “Unused slots cost nothing” in the PR body is stronger wording than the mechanism warrants. Say “skip weight decode and materialization for unused slots”. The single-program histogram still scans M, and metadata cost includes E plus another M-pass. The number of experts/slots at the interface remains C.

Compaction is a correctness condition of the strided early exit: at C40/G32, put used[0]=-1 but used[32]=5. Group0 stops at0 and never decodes32. This is a deliberately malformed producer output; it explains why arbitrary holes cannot replace a valid prefix, not a bug in the actual compact producer. For C<=32 each group owns one slot; the standalone decoder test used=[1,-1,0] is safe there and does not invalidate this condition for larger C.

## Consumers and the dynamic-scale trap

`apply:261-272` only enters routed materialization when expert_map is None, LoRA context None, and both biases absent. Thus do not generalize this to every EP mapping. `_dequantize_routed:194-228` requires nonempty IDs/scales; fused path additionally requires ROCm, bf16 activation input, w_mxfp4* scheme, byte weights/scales with contiguous per-expert layout and compatible block shape, and rejects `isinstance(quant_dtype,torch.dtype) and quant_config.a2_scale is None` (dynamic FP8 activation scale). Other cases retain per-slot/full dequant paths.

The no-read proof is not simply “-1 makes everything safe”:

- No valid local ID points into used[U:C], so the MoE GEMM should never select unwritten expert weights.
- Parent TritonExperts config sees w1.size(0)=C. Assignment aligns routes using this C, not U. The default alignment documents invalid expert markers, and fused_moe_kernel:462-479 zero-fills invalid-expert output and returns before loading expert weights. Some paths omit invalid alignment entries instead; do not confuse these mechanisms.
- Invalid **token-slot intermediate** rows and invalid **expert weight** slots are different axes. A later tensor-wide a2 scale can observe intermediate garbage even when weight selection is correct. For valid amplitudes [1,2], an unused stale row 1e6 changes max-based FP8 scale by 500000x; NaN may poison it entirely. This is a correctness issue, not merely extra work. Row-local MX block quantization does not let an unused row choose another row's scale.
- Nuance at this exact head: `triton_moe.py:680-697` already uses masked_amax_scale with `row_valid=topk_ids>=0` for tensor-wide scales, and EP invalid-slot handling has separate gates at398-415. Yet this PR's fused-dequant entry **still conservatively rejects dynamic FP8 a2 scale**. Report the gate as implemented. Do not assert the whole repository lacks masked global scales, nor claim all activation quantizers are proven safe by this patch. Opening that gate would require tracing every consumer and quantization-emulation branch, beyond this research.

## Cost model and regimes

Let Q=|W1|+|W2| decoded values per expert, b=2 bytes/value bf16. For a gated MLP W1=[2I,H], W2=[H,I], Q=3HI. These are logical materialization bytes, not measured HBM/PCIe/network traffic:

- Full: decode/write E experts, bf16 bytes E*bQ, capacity E*bQ.
- Immediate per-slot baseline where enabled: decode/write M experts, M*bQ, plus packed gather intermediates and sorting. Expert duplicates do not remove this work.
- New fused: decode/write U experts, U*bQ, but allocated weight output capacity remains C*bQ, plus histogram/renumber and fixed grid overhead.
- Hypothetical synced eager distinct allocation: write and capacity U*bQ but requires value-dependent sizing/host synchronization in this comparison; it is a real different tradeoff, not dominated for memory.

MXFP4 has nominal packed inputs Q/2 weight bytes +Q/32 scale bytes; useful new logical input is U*(17Q/32), output U*2Q. This omits caching, allocator effects, intermediates, metadata and GEMM traffic. Do not turn U/E into an end-to-end speedup. Kernel fusion also removes packed gather intermediates and changes decode implementation, so observed gains cannot all be attributed to deduplication.

At H7168,I2048,E256,N128,k8,M1024,U48,C256: new bf16 weight capacity is 21GiB (same as full), bytes written are precisely 48*88080384=3.9375GiB, versus21GiB full. The author's rounded “5GB vs21GB” includes its own configuration/accounting and is not this arithmetic. New **does not** make the21GiB capacity proportional to48 experts. At uniform U≈E, U savings collapse; fusion can still help but is a separate effect. At M<=E/4 with U=M, dedup saves no expert count versus per-slot baseline; two metadata launches remain. At high skew U<<min(M,E), the payload reduction is substantial while capacity can remain large.

Qualitative break-even against immediate baseline: `(D_old-U)*T_materialize_per_expert + gather/fusion benefit > T_histogram(M,E)+T_renumber(M)+extra launch/loop overhead`, with downstream GEMM configuration effects also possible. This is a reasoning inequality, not a calibrated runtime predictor.

## Distinguishing evidence to use in the topic

The useful diagnostic is the triplet(M,U,C), not N alone. Hold M/C fixed and vary routing diversity: U1 versus U128 at M128/E256 must preserve graph-visible shapes yet change decoded experts. Hold U fixed and grow M past E/4: immediate baseline flips to E work while new metadata scans more IDs but expert payload remains U. Hold M fixed and distribute IDs widely until U≈C: observe the lost benefit regime.

Checked upstream test contents, not execution:

- bf16 fused versus fp16 fallback, repeated routes and threshold crossing; NaN-poison unused expert outputs; compare torch.equal with forced full dequant.
- Capture one routing, replay another same shape with repeated last token; compare replay output to full dequant.
- Every packed byte under every e8m0 scale against default Quark HIP decoder; non-NaN bits equal, NaN positions equal. Scale0 preserves subnormal semantics, scale255 can produce inf/NaN; alternative Quark Triton flush-to-zero mode is outside claimed bit identity.
- Dedup int32/int64, one top1, -1 padding, out-of-range ID. This only proves the listed source tests intend these checks; no GPU run here.

The local CPU structural model exhausts small integer mappings and checks identity invariant, prefix scheduler coverage, a changed-U/same-C replay-shaped case, malformed-hole early-exit counterexample, and a stale global-scale counterexample. It does not validate Triton lowering, GPU memory ordering, bfloat16 numerical parity, graph capture, or timings.

## How to connect to another MoE case without conflating them

A grouped decode case may optimize the same M pairs differently by organizing token-expert locality/padding. This PR optimizes an earlier reusable object: per-expert decoded weight materialization. Deducing U from IDs is useful here because all routes selecting e reuse the same W_e. If the materialized object depended on token identity or route-specific adaptation, sharing solely by expert ID could be invalid; the explicit no-LoRA/no-bias/no-expert_map gate illustrates why storage identity must match consumer semantics. Keep this as a comparison of reusable working sets and consumer contracts, not a historical dependency unless independently sourced.
