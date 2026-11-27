# AttnRes candidate feasibility: preserving sources versus transporting a fixed stream

Decision: **promising case study, but not yet enough alone to force an eighth topic**. The existing Kimi support panorama already explains the formula, layer boundaries, and state axes. A new residual-mixing topic earns its place only if another independently sourced mechanism gives a meaningful contrast in what information is retained and what can later be selected. Do not simply expand that same panorama section. This directory is bounded feasibility research; no article, metadata, database, or deployment change.

Fixed checkpoint `moonshotai/Kimi-K3@c7945ea0e737dcaddd22c68ddb7639b1407c081c`; fixed vLLM `24c72a76b96bf8d73190a4bb66d47dc8c3eb2134`. Existing immutable model/Triton/reference-test/config caches were copied only after matching their manifest hashes. Newly fetched same-revision native C++ CUDA operator and benchmark harness. Model GPT-6.1 Sol. No GPU tests/benchmark execution.

## Narrow technical proposition with peer learning value

A residual design must decide not just how to transport a vector, but **which past information remains independently addressable by future layers**. AttnRes retains block source vectors and lets every later sublayer select them with new scores. A representation that has already collapsed those sources into one old weighted sum can lose precisely the degrees of freedom required by a later selector. The right comparison with fixed-stream schemes is the retained source basis, mixing constraints and lifetime, not simply “both mix residuals”. No full mHC equivalence, superiority or implementation relationship is established here.

Specific falsifiable counterexample: history A has sources [(1,0),(-1,0),P=(0,0)]; B has [(0,1),(0,-1),P=(0,0)]. Old query q0=(0,0) mixes either to(0,0). At q1=(1,0), RMS-scored source attention gives nonzero x output for A and zero for B. Thus **that particular old sum/mixed-vector representation is insufficient** to reproduce arbitrary later selection. It is not a theorem that every clever fixed-width nonlinear encoding is impossible, nor that a fixed-stream architecture trained for another function should emulate AttnRes. Keeping enough independent streams to preserve all sources avoids this specific information loss, with its own capacity cost.

## Actual row-local semantic program

For one current execution token row, let history vectors R0…R(b-1), current block prefix P, optional newly produced delta Δ. Update P with Δ before it participates as a source. S=b+1 sources v=[R...,P]. Learned score norm weight w and learned q are distinct per attention/MLP location; q is the stored D→1 replicated projection row, **not a token-generated query**. Scores vary by token because source vectors vary:

`r_s = 1/sqrt(sum_d(v_sd^2)/D + eps)`
`score_s = sum_d(v_sd * w_d * q_d) * r_s`
`alpha = softmax_over_sources(score)`
`mixed_d = sum_s(alpha_s * v_sd)`.

RMS normalization affects the score, not the mixed values. Learned w may vary across layers, and is already fused into q*w in actual kernels. No QK product across different tokens is formed; complexity is linear in S*D per row, not token-attention M²*D.

A simple raw-value counterexample uses q0=0 and v0=(100,0),v1=(0,1). Both weights equal1/2; correct mixed=(50,0.5). Mixing normalized keys instead yields approximately(0.7071,0.7071). RMS scoring reduces amplitude sensitivity of scores (only approximately scale-invariant with nonzero epsilon); raw value amplitude is still retained. A normalized-key cache cannot silently replace the original values. Negative rescaling also flips direction, so no unrestricted scale-invariance claim.

Optionally next-sublayer output RMSNorm is fused into the same kernel, with a different learned weight. The final model AttnRes passes no output norm; final model norm is delayed to compute_logits. “Everything is normalized” is false both for values and final returned stream.

## Block accumulation/reset and source cardinality

Checkpoint config: D7168,93 decoder layers,attn_res_block_size12, dtypeBF16. The12 counts decoder layers, not attention/MLP sublayers or sequence tokens. For zero-based layer l:

- boundary=l mod12==0; write_index=floor(l/12); previous valid history b=ceil(l/12).
- pre-attention first commits prior layer MLP output as Δ into P. On boundary, copy that updated P into R[write_index], but score only b old blocks plus P; freshly saved duplicate is **not** added as a second source here.
- post-attention on boundary **rebinds P to attention output**, Δ=None. Else Δ=attention output and add into current P. Now b+boundary history blocks plus P are available to the MLP scorer.
- MLP output is pending until next pre-attention or final model aggregation.
- final call commits the last MLP delta and mixes all8 history blocks plus P,9 sources.

At layer0 pre: save embedding in R0, attention sees only P=embedding. Post: P resets to attention result, MLP sees R0 plus P. At layer12 pre: save accumulated old block as R1, attention still sees R0 and P; post resets P and MLP now sees R0,R1,P. Failing to reset doubles historical contributions; counting the saved source both as Rnew and unchanged P gives an unintended extra softmax term. Distinct source multiplicity matters even when duplicated vectors are equal, because softmax mass changes relative to other sources.

History capacity B=ceil(93/12)=8, maximum S9. PP1 ordinary forward has2*93+1=187 AttnRes calls. Summing actual pre/post/final source counts yields1003 source-vector visits per execution row (816 historical plus187 current sources). This is a model/path count, not hardware load count or a claim all native/specialized/auxiliary executions perform exactly the same launches. Changing block size changes model semantics and trained parameterization, not a free runtime tuning knob.

## State lifetime is execution-row depth, not request KV history

History buffer allocated per forward is `[M,ceil(end_layer/12),D]` in hidden activation dtype. P and pending Δ are `[M,D]`. M is current local execution rows: multiple prefill rows or decode rows, with possible SP sharding. Nothing here indexes past sequence positions; next decode forward rebuilds this depth history. Existing KDA/MLA request caches have a different lifetime.

PP transports hidden_states containing committed P plus pending MLP output and residual history. Receiver allocates its local end-layer capacity and copies supplied history. The ordinary source uses explicit layer-index valid counts rather than all allocated buffer entries. These source buffers cannot generally be reconstructed from only the latest mixed hidden vector at a PP boundary, as the selector counterexample shows. Network payload is not quantified here: transport may carry buffer capacity and other model state, and the inspected code does not imply a minimal packed-valid-source protocol. SP+PP is explicitly unsupported in the inspected route.

## Exact dtype and fusion boundaries of the inspected operators

### Triton fallback

- BF16 checkpoint source P/Δ/R and score/output weights are loaded then converted to FP32.
- With Δ, FP32 addition is immediately cast back to prefix dtype and to FP32 again, then prefix is stored. That BF16 rounding occurs **before** score/source use. Stored block copy uses updated rounded prefix.
- q*w multiplication, per-source sum-of-squares/dot, rsqrt, logits, online softmax max/denominator and weighted mixed accumulator are FP32.
- Source vectors are raw BF16 values converted to FP32; online weighted accumulation is not over normalized keys.
- Fused output norm computes its FP32 square/reduction and weight application before final output store to prefix.new_empty dtype (BF16 here).
- With b0, softmax is exactly1 and mixed=P, bypassing score/source loop. Prefix can still update/write block and output norm still applies.

CPU BF16-rounding illustration: start P1 and add Δ1/256 twice. RNE after every add remains1; fuse the two additions and round only once yields1.0078125. This is not the exact GPU kernel result claim; it shows why a hypothetical “more FP32 accurate” fusion alters the documented prefix-source boundary.

### Native CUDA SM100 route (newly inspected)

Dispatcher requires hidden7168,dense prefix/delta,history count0..8,SM100 family and compiled native op (CUDA>=13 comment). It is a BF16 operator. It uses persistent token blocks with producer cp.async.bulk to shared;8 consumer warps; q*w held in float registers across rows; raw V rows converted once then cached FP32 in TMEM between scoring/mixing passes. BF16 prefix add uses `__hadd2` and writes BF16 prefix/block before float conversion. Norm/dot stats,exp2 softmax state and value accumulators are float. Final output uses BF16 conversion.

With output norm fused, native avoids explicitly dividing mixed by softmax denominator s before RMSNorm. If unnormalized weighted accumulator is a:

`(a/s)/sqrt(mean((a/s)^2)+eps) = a/sqrt(mean(a^2)+eps*s^2)` for positive s.

The `eps*s²` term is essential. Dropping it changes the operation. Native source implements this identity (lines763–765,834–835). It is an algebraic fusion with different floating-point organization from Triton/reference; no bitwise identity is claimed. Public tests compare output with atol8e-2/rtol3e-2, while prefix/block side effects require zero tolerance. This distinction is material for any new residual-mixing topic.

Read full native file but focused reasoning on loads/prefix update, norm/dot reductions, online softmax, TMEM reuse and output branches. Did not inspect emitted SASS, execute native operator, establish batch invariance, or audit specialized_decode/CuTe or AMD paths. No numerical equality across these uninspected routes is inferred.

## Cost model with separate useful work, lanes, capacity and traffic

Let M rows,D hidden,S=b+1 active sources, b_dtype bytes2 for BF16. Leading useful scalar/vector arithmetic per source includes sum-of-squares (~2D FLOPs), dot(~2D), weighted accumulation(~2D), hence ~6MSD plus online rescale/softmax, q*w setup, prefix updates and optional output RMSNorm O(MD). This is a useful leading-operation model, not an exact native instruction count: scalar exp/rsqrt, reductions, FMA organization, masked lanes and source tiling differ. No M² term.

Logical source payload for one mix is2MSD bytes of source values; all187 PP1 calls sum to2MD*1003 =14,379,008 bytes per row (~13.713MiB). This is a source-visit accounting sum, **not** HBM read measurement. Native TMEM reuse avoids reloading a raw source separately for score and weighted value pass; persistent q cache amortizes score-weight loads. The saved R values can also hit caches across calls, and outputs/prefix/delta/weights add other traffic.

Ordinary Triton fallback explicitly loads P once before loop, then for b>0 loads allS sources including P again; optional Δ read/prefix store/block-write and output store are additional. It also reads norm/q weights and optional output norm weights. Thus2MSD is not total fallback global load bytes. One-pass fusion reduces separate intermediate tensors, not the semantic need to preserve and inspect source values.

Triton BLOCK_D=next_power_of_2(D)=8192. Small M<256 with b>1 uses BLOCK_L4/8warps, otherwise BLOCK_L1/4warps. Masked source/hidden lanes may still execute vector arithmetic. S9/BLOCK_L4 uses12*8192 vector lanes versus9*7168 useful source-elements, ratio~1.524; this is a padded arithmetic-slot ratio, **not** time overhead, bandwidth waste or FLOPs measured by GPU. Native has different shape-specialized geometry and should not inherit that ratio.

History capacity only:2MBD=114,688M bytes,112KiB/row at B8,D7168; M4096 gives448MiB. Add P,pending outputs,workspace and module/model activations separately. Source history grows with depth count B, but is bounded93-layer configuration, not context length. Avoid calling this capacity an entire model forward peak or request-cache requirement.

Total source-vector visits across L layers with block sizeK scale O(L²/K+L), while retained depth vectors scale O(L/K). Fixed smallK and growing model depth therefore make source scanning and state capacity different growth axes. This is asymptotic only across hypothetical architectures; runtime K cannot be freely changed for an existing checkpoint.

## Substantive alternatives, and why they are different

1. **Collapse to one fixed accumulated/mixed stream.** O(MD) retained width; loses source information needed by later q as the collision counterexample proves for sum/mix. It represents a different function unless stronger sufficiency is established. Not a drop-in optimization.
2. **Retain all block sources and score when consumed** (actual). Preserves selector freedom; O(MBD) activation storage and O(MSD) scan each call. Fused/native implementation amortizes mechanics, not information requirements.
3. **Retain more independent fixed streams or an invertible transform of sources** (conceptual comparator). Can preserve addressability if enough information survives, but capacity and transformation costs must be counted. No theorem equating this to a particular mHC implementation, constrained mixing matrix or learned checkpoint.
4. **Cache scalar unweighted RMS statistics per immutable saved source** (new, hypothetical implementation idea). Score denominator depends only on raw source v, not learned layer w/q; save per-source reciprocal RMS upon block write when eps is fixed (or cache squared mean and apply the consumer eps if eps differs). Additional float cache is `4*M*B` bytes,32B/row at B8, versus112KiB source buffer. Can eliminate repeated source squared-norm reductions/rsqrt; each later scorer still needs new q*w dot and raw value reads, so no O(MSD) bandwidth disappearance. Cache must be computed from the same rounded BF16 source actually saved; current P changes and needs recomputation. Adding metadata lifetime/PP/SP/capture handling and numerical tests can outweigh saved arithmetic; neither native nor fallback inspected implements this cache.
5. **Cache normalized keys instead of raw values.** May assist scores under compatible w, but cannot replace raw values and w changes per sublayer. Keeping normalized and raw doubles vector storage unless recomputed; scalar RMS cache avoids this duplication. A fixed single key projection cannot serve arbitrary future q without retaining its required basis.

The most useful follow-up experiment would vary M,S and reuse depth, compare current fused operator to a scalar-RMS-cache variant, and separately report score arithmetic, source bytes, cache metadata and measured latency. It should validate BF16 prefix/block state exactly and output to the actual tolerance contract. This is an experiment proposal, not executed work or a recommendation that the extra cache is profitable.

## Can this support a new topic now?

Source-level feasibility: **yes**, there is enough mechanism to contrast history-source selection against fixed-width stream transport and to derive information-loss and cost counterexamples. Editorial independence: **conditional**. Existing Kimi article already contains the formula/lifecycle. Novel material here is the sufficiency question, collision counterexample, source-visit/capacity separation, exact rounding/fusion boundaries and the scalar-RMS-cache alternative. Without a second properly sourced residual mixing design and a concrete comparison of preserved information, writing a new long article now risks repeating the panorama. Keep candidate research; do not count as eighth approved content.

No training quality, convergence, model capability improvement, measured GPU speedup, universal fixed-width impossibility, or full mHC equivalence is established. Tests/bench harness presence is only source evidence; none executed on a GPU. The local source-model.py checks the stated illustrative counterexamples, boundary cardinality and byte arithmetic under explicit CPU simplifications.
