# Tail retention: required reads versus actual allocation units

This research is integrated into article section 3; this directory provides
the reproducible arithmetic and exact implementation-reading boundary.

Run from this directory with `python3 model.py`. The checked output is
`results.json`. Python standard library only; no model, GPU, server or network
is required. The script exhaustively checks 4,428 (target, W, K, F) cases and
three page sizes per case, then checks distinguishing event examples.

## Fixed-source facts verified before modeling

Existing cached file (not edited):
`../sources/20990/vllm/v1/core/single_type_kv_cache_manager.py`

Repo: `vllm-project/vllm`; revision:
`af5bac91c21b9f5daf0afc3ada99e2c590ac597c`.

SHA-256:
`e81c90611e0c5fc248ad0a821af204e0120d205cccc00d5f002631ad9394941d`.

- Lines 1412–1445: context KV is per-position target-hidden projection;
  draft attention runs past the last target token. `tail_tokens = W + K*F`
  includes drafts counted before acceptance. Class comments say frees and
  hits see no drafts in flight and use the ordinary window.
- Lines 1450–1476: max admission is the minimum of the inherited sliding
  window bound and `(F+1) * tail_blocks`. Tail blocks include extra retained
  tokens, lookahead and a page-alignment allowance. This is a conservative
  request capacity bound, not the exact instantaneous union of read pages.
- Lines 1512–1530: `_num_unbacked_leading_blocks` rounds the null prefix down;
  reservation counts non-null held blocks rather than table length.
- Lines 837–873: removal receives fully processed and committed tokens,
  explicitly described as safe to free. The DFlash removal at 1486–1507
  traverses null gaps rather than stopping at the first null; old chunk tails
  may lie above those gaps.
- Lines 1131–1159: the inherited bound includes processed-window retention,
  outstanding tokens, max model length and block-alignment slack.

These points establish the distinction between new-allocation tails,
request-held units and the safe release frontier. They do not establish an
arbitrary feasible scheduler trace. No `BlockPool` implementation was added
or audited in this subtask, and no exact upstream reader-reference policy is
inferred from these facts.

## Abstract assumptions and alternatives

Each named execution instance has a saved target frontier T. Until it is
resolved, any integer frontier in `[max(0,T-K*F),T]` is allowed; that frontier
reads `[max(0,f-W),f)`. This deliberately reproduces the conservative tail
identity as an abstract allowed-state set. It does not assert that every
state or pair of target frontiers is scheduler-reachable in vLLM.

Three alternatives are compared on those exact same read requirements:
latest-tail only, union of outstanding readers' page covers, and contiguous
envelope of that union. The first can be unsafe, the union is minimal within
this page model, and the envelope can contain holes with no consumers.

The event model separates consumer completion from a deferred reclamation
sweep. A second example implements *hypothetical* per-reader page ownership:
shared page 7 survives reader A's completion because B still owns it. This is
an alternative design, not a statement that vLLM tracks each GPU reader this
way. Current-source release reasoning instead uses the processed/committed
frontier and its safety contract. Cost or complexity of those alternatives
is qualitative; no timing, throughput, admission workload or hardware-memory
measurement is claimed.

The model counts active allocation pages under a fixed coordinate/page
mapping. It excludes prefix-cache residency after pages become evictable,
cross-request deduplication, transfers/recomputation, and group-dependent
page sizes. Those require a richer model and physical-ID ownership mapping.
