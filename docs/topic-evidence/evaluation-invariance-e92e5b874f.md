# Logical K segments versus physical scheduling — bounded source research

Candidate: evaluation-invariance. PR [DeepGEMM #510](https://github.com/deepseek-ai/DeepGEMM/pull/510), inventory21262. Head `e737f91aafc57a5c63e4444f5a73a72a6fa4c1a3`; base `8c8a92076c4de39e5ed29459e55fea3eaca6256c`. Read archived full body/files and inventory deep_dive, full new test file, full selector/heuristic files, host Normal launch/reduction wiring, and targeted device producer/consumer/epilogue sections. Device file is ~100KB: this is not a claim to have exhaustively proved every MMA/layout branch. GPU tests and benchmarks were not executed. Model GPT-6.1 Sol. Only this new research directory was changed.

## Attribution: stacked means inherited code is not #510's invention

Title explicitly says stacked on #509. Archived #509 (inventory21261) is an upstream/nv_dev sync with SM120 operator-API adaptation and vendored SM120 v0.2.0. It already describes SM120 GEMM support and epilogue restrictions. Immediate #510 base source already has the split-K heuristic, FP32 workspace, reducer, producer partitioning and full SM120 kernel. #510 adds deterministic M-independent partition selection, execution-mode selection, emulated fixed splits, explicitly RN reducer add/multiply, and batch-invariance tests. The body attributes the two device files to DeepGEMM-sm120 v0.3.0. Do not attribute generic SM120 support, split-K, operator epilogues, grouped layout, or all padding machinery to this PR.

Read #509 full body and changed-file list to establish scope; did not audit its ~100 changed files. Its cached head is72e97d7, whereas #510 cached base is8c8a920; do not equate those hashes or infer direct Git parent ancestry from title alone. Immutable immediate base proves what #510 inherited, independent of stack topology.

## Substantive thesis

Determinism of one launch shape does not imply batch invariance: a scheduler may pick a different legal floating-point expression when M changes. Preserve a logical reduction program independently of where it runs. Here the numerical program fixes K segment boundaries, starts each partial accumulator from zero, left-folds FP32 partials in segment-index order, scales once, then adds C and casts once. Scheduling remains free to execute those same partials as parallel split-K CTAs or serial emulated segments within a CTA.

The numerical target is not necessarily unsplit GEMM's answer or an exact real-number dot product. It is one stable chosen segmented FP32 evaluation. This distinction matters when discussing numerical accuracy versus bitwise invariance.

## Where the old M dependence entered

Immediate base `csrc/jit_kernels/heuristics/sm120.hpp:get_split_k_factor` computes MN blocks from expected_m/expected_n and selected BLOCK_M/N. If MN blocks >= half available SMs, return1; otherwise target ~3/4 SMs, select S based on the number of MN blocks, constrain K/S to scaling-factor tile boundaries and cap FP32 workspace32MiB. Thus varying M can change S, cutpoints, or split-versus-unsplit. Launches can each be individually deterministic while their row answers differ because each partial starts from zero and later partial merging introduces different rounding points.

#510's first commit simply returned1 under deterministic mode, which fixes that source of variation but removes small-M K parallelism. Its final implementation restores physical split parallelism without restoring shape-dependent logical cuts. The 2–3x slowdown for disabling split-K alone is author-reported, not a measured fact from this research.

## Exactly what is fixed, and what still varies

`get_batch_invariant_num_splits(desc,weight_n):327-340` only applies to Normal and scale-factor kernels; non-Normal or KernelNoSF returns1. Within a fixed device/SM count, quantization granularity and weight dimensions, it ignores batch M and chosen layout:

- nb=ceil(weight_n/64), return1 if nb>=num_sms/2.
- unit=lcm(128,4*max_gran_k); return1 if K not divisible by unit.
- units=K/unit; S starts as min(ceil((num_sms*3/4)/nb),floor(units/2)); decrement until S divides units; return max(S,1).
- Each K segment length K/S is therefore a multiple of unit, covering both BLOCK_K candidates and packed scaling-factor tile. The path is conservative for unaligned K rather than inventing ragged deterministic segments.

The PR shorthand “depends on N,K only” means with the other configuration fixed: the actual formula also uses num_sms and max_gran_k. Do not claim cross-hardware, changed-SM-budget, changed-scale-granularity, compiler-version or arbitrary-tuning invariance. Under swap-AB the host passes `swap_ab ? m : n` as weight_n; desc.m can be original weight N. It is wrong to equate syntactic desc.m with batch M after transposition.

Host still calls best-config selection. Existing layout candidates depend on expected_m (e.g. different block M/K candidates for large batch), but the numerical partition unit is common to those candidates. This keeps ordinary tuning possible **if** the different microkernels retain the same per-output MMA K evaluation order. The body asserts that property for its SM120 implementation; this bounded audit checks fixed-cut alignment and new wiring, not every possible future MMA rewrite. A new reduction tree or precision change would need renewed proof/tests even if S stays fixed.

`uses_real_split_k:344-348` may depend on M and layout: S>1, ceil(m/BM)*ceil(n/BN)<SMs/2, and4*S*m*n<=32MiB. If true, set real split_k_factor=S, emulated=1; otherwise real=1, emulated=S. M determines execution/temporary-memory strategy, not logical split decomposition. At S=1 the real gate is always false, emulated remains1, and neither extra split workspace nor a split merge is introduced.

Illustrative selector arithmetic, not an observed tuned configuration: SMs144, weight N512,K4096,gran32 gives nb8,unit128,units32,S8,Ksegment512. At BM64/BN64, M1 uses8 MN blocks and16KiB workspace so can be real; M4096 has512 MN blocks and would need64MiB workspace, so is emulated. Both target eight same512-value K intervals. This is an easy interactive diagram: fixed horizontal K segments, switching placement across CTAs versus one tile consumer, with storage boundary shown explicitly.

## Consumer semantics and intermediate precision

Host `sm120_fp8_fp4_gemm_1d1d.hpp:302-306` allocates real-split workspace `[S,m,n]` using `torch::kFloat`, not BF16; it suppresses alpha in GEMM epilogue for real split and passes alpha/C to separate reducer. Device producer:305-311 chooses split-specific K range only for real split. For emulated split the producer still streams all K blocks in order; consumer divides its consumption into S ranges, preserving stage progression.

Device consumer:379-400 computes total K blocks, partitions by split count, zeroes float accum for each range. `split_sum` is float. At1349-1359, partial0 is assigned directly, later partials use `__fadd_rn` in increasing split order, then restored to accum for original normal epilogue. It does not fold in CTA completion order, apply alpha per segment, or round partials to BF16. Static assert confines emulation to unsplit Normal GEMM; don't extend this mechanism to all grouped APIs merely because tests exercise them.

Real path:1363-1386 writes float accum into float workspace at indexed split offset, bounded by logical row/column shape. Reducer starts with workspace[split0], left-folds split1..S-1 using `__fadd_rn`, `__fmul_rn(sum,alpha)` if present, adds C converted to float, and only then stores `cd_dtype_t(sum)`. Output type validation permits BF16 or FP32; the added dense tests use BF16 output. Normal emulated epilogue uses operator apply on accum, adds C in float, converts at final store; ScaleByAlpha uses explicit `__fmul2_rn`. This is why a float workspace store/load can preserve the representation relevant to equivalence, whereas BF16 partial storage would introduce extra rounding.

The reducer changed from plain sum+= and sum*= to explicit RN intrinsics. Besides canonical order, explicit rounded multiply prevents contracting alpha multiplication with subsequent C add. Fixing cutpoints alone without matching the epilogue is insufficient. Restriction to Identity/ScaleByAlpha and no stochastic output rounding is explicit in device comment; don't generalize to arbitrary custom epilogues.

## Padding is spatial, not a new K sum term

Distinguish three boundaries:

1. K segmentation alignment: K/S must be compatible with BLOCK_K and four-SF packing, handled above. Padding K with extra non-neutral values is not permission granted by fixed splits; current selected S simply returns1 for the misaligned K/unit case.
2. M/N tile padding: real workspace stores check row<shape_m and col<shape_n; reducer processes exactly shape_m*shape_n entries. Logical rows are the invariance target, not unspecified padded output rows.
3. Grouped psum padding: existing layout selector requires BLOCK_M to divide runtime alignment so a tile cannot straddle expert boundaries. Device producer and consumer both skip empty/padding m_indices==-1 tiles so barriers stay in sync. The grouped test builds aligned starts using zeros in input padding, passes ensure_zero_padding=False, and compares only real per-expert prefixes. This does **not** promise output padding bytes are invariant or prove arbitrary uninitialized input padding safe.

#510's new emulation is Normal-only. Grouped BF16/FP8xFP4, BF16 dense, einsum and HC prenorm tests broaden regression coverage but do not mean their old implementation was replaced by this new split scheme. For grouped gemm_type, get_batch_invariant_num_splits returns1.

## Cost model and alternatives worth comparing

Let S canonical segments, M,N,K shape. Useful GEMM FLOPs remain about2MNK.

- Disable split-K: simplest invariant order, no split workspace/reducer; small MN grids may underutilize SMs. Also selects a different numerical reference than canonical S>1 segmentation.
- Fixed real split: ~S times as many independently schedulable MN tiles, but workspace4SMN bytes plus4SMN logical partial writes and4SMN logical reducer reads and another kernel/launch. The Normal host allocation is exactly [S,m,n] without align/alloc_m, so4Smn is exact tensor capacity for these launch dimensions and logical write/read payload, not measured HBM transactions. If an outer caller already supplied padded dimensions, those dimensions must be used. Existing grouped_tma_output has separate aligned M/N output storage, not this Normal workspace; scaling and C/final-output costs remain.
- Fixed emulated split: no global split workspace/reduction kernel, and same canonical numerical boundaries; per output has accumulator resets and S-1 FP32 partial merges. It does not recover split-K's extra cross-CTA K parallelism, but at large MN that is less necessary. New float split_sum state may affect register lifetime/compiler allocation; author reports unchanged registers/no spills for tested kernels, not a universal guarantee.

32MiB is implementation's temporary-memory budget and the MN-block threshold is a scheduling heuristic, neither is a floating-point theorem. Never equate a latency ratio with just workspace bytes or S. Author reports deterministic/default0.82–1.28x time,1.00–1.06x at M>=2048 on selected DeepSeek-V4.1-Flash linear shapes/RTX PRO6000/CUDA13.2/torch2.13. Those are bounded author results and were not reproduced here.

## Concrete counterexamples and falsifiable checks

Local `segment-model.py` intentionally uses scalar FP32 arithmetic to illustrate nonassociativity, not SM120 tensor-core numerical simulation:

- Terms [2^24,1,-2^24,-1]. One sequential FP32 fold gives-1; two equal segments give float partials[2^24,-2^24], merge0. Final BF16 remains-1 versus0. A coarse final dtype does not guarantee earlier reordering differences disappear.
- Same indexed partials can complete in reverse physical order without changing a canonical indexed fold; reducing in completion order can differ. Hence fixed segment identity/order, not deterministic CTA scheduling, is the right abstraction.
- Rounding partial1.00390625 to BF16 before adding-1 gives0, while FP32 merge then BF16 gives0.00390625. Global FP32 workspace is a substantive contract.
- (1+2^-23)*(1-2^-23)+(-1): separate rounded FP32 mul/add gives0, one fused mul-add gives-2^-46. Matching only sum parenthesization while permitting different contraction still fails equivalence.

Verification read from actual new test file:23 parameter cases: dense FP8 five(N,K)×accumulateFalse/True=10; BF16 dense5; grouped two dtypes×two shapes=4; FP8 einsum2; HC prenorm split1/16=2. BATCH_SIZES includes1,2,3,4,7,8,16,31,32,64,100,128,256,512,1000,2048,4096. Compute largest reference then prefixes at every smaller M using torch.equal, not tolerance. Grouped changes each expert's row count and average-M tuning hint, verifies same expert prefixes; it does not compare padding. Quantization uses per-token UE8M0 gran32, so the test avoids a batch-global activation scale itself changing the same row's input representation.

Useful additional distinction for main topic: without row-local quantization or fixed input bit patterns, even perfectly preserved GEMM reduction cannot guarantee row invariance. The contract has to cover quantization and epilogue boundaries, not only kernel math. Test input construction is evidence for that boundary. No actual GPU tests, model end-to-end, register report or performance numbers were independently run here.
