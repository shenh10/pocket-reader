/** Cheap intake triage, never an evidence-backed learning assessment. */
export const ARCHIVE_SELECTION_VERSION = "mechanisms-and-tutorials-v2";

export interface ArchiveCandidate {
  title: string;
  body?: string | null;
  files?: Array<{path: string; additions?: number | null}> | null;
  focus?: {
    kind: string;
    architecture: number;
    performance: number;
    learning: number;
    evidence: number;
  } | null;
  favorite?: boolean;
  watch_later?: boolean;
  note?: string;
  completed?: boolean;
  changedFiles?: number | null;
}

export interface ArchiveSelection { keep: boolean; reason: string }

const maintenancePath = /(^|\/)(docs?|tests?|test[s_][^/]*|benchmarks?|examples?|recipes?|cookbooks?|\.github|\.buildkite|\.agents|\.claude|skills|docker|dockerfiles|scripts\/ci)(\/|$)|(^|\/)(readme|changelog|license|contributing)(\.|$)|\.(md|mdx|rst|ipynb|lock|svg|png|jpg)$/i;
const maintenanceTitle = /\[(?:docs?|ci|tests?|chore|mypy|typing|skills|recipe|cookbook)(?:\]|\s)|^(?:docs?|ci|tests?|chore|build|deps?|style)(?:\([^)]*\))?\s*:|\b(?:bump (?:the )?(?:version|dependency|dependencies)|pin .*version|update .*recipe|fix (?:a )?typo|fix (?:the )?typos|fix (?:a )?broken link|release v?\d|nightly (?:image|recipe)|add .*cookbook|add .*recipe)\b/i;
const tidyTitle = /\b(?:rename|reorganize|reformat|dead code|unused (?:code|import|variable)|import cleanup|fix (?:mypy|typing|type hints)|move .* (?:file|folder|directory)|update .* (?:comment|docstring)|dedup(?:licate)? (?:tests?|comments?|imports?))\b/i;
// Explicit mechanisms, with word boundaries: "ci" in "precision" is not CI.
const core = /\b(?:schedul\w*|(?:kv|prefix|radix|ssm|state|weight|graph)\s*[-_ ]?cache|cache\s+(?:evict\w*|offload\w*|lifetime|coheren\w*|reuse|ownership)|(?:cuda|prefill|decode|breakable)\s+graphs?|stream\s+(?:order\w*|sync\w*|lifetime|wait\w*)|(?:all[-_ ]?reduce|all[-_ ]?gather|reduce[-_ ]?scatter|all[-_ ]?to[-_ ]?all|collective|rdma|nccl|nvlink)|(?:tensor|sequence|context|pipeline|expert|data)[-_ ]parallel\w*|(?:kv|weight)[-_ ]transfer|disaggregat\w*|(?:memory|buffer|tensor|state)\s+(?:pool\w*|lifetim\w*|ownership|reus\w*|offload\w*|alloc\w*|stride|capacity)|(?:deadlock|race condition|use[- ]after[- ]free|memory leak)|(?:fuse\w*|fusion|tiling|tile size|split[-_ ]k|split[-_ ]kv|persistent kernel|warp special\w*|tma|pipelined)|(?:determin\w*|batch[-_ ]invarian\w*|rounding|numerical|bit[-_ ]exact)|(?:sparse|mla|paged|linear|flash)[-_ ]attention|(?:jit|compil\w*)\s+(?:cache|specializ\w*|warmup|latency)|(?:speculative|draft|verify|acceptance)\s+(?:decod\w*|schedul\w*|cache|kv|tree|pipeline|prefill|window|prob\w*)|(?:moe|expert)\s+(?:rout\w*|dispatch\w*|parallel\w*|communicat\w*|all\w*|fuse\w*|kernel\w*)|(?:logits?|sampling)\s+(?:pipeline|stage|state|penalt\w*|grammar)|(?:prompt|prefix)\s+(?:cach\w*|reuse)|(?:quantiz\w*|fp8|fp4|mxfp8|mxfp4)\s+(?:gemm|kernel|layout|scale|cache|block)|(?:stride|capacity)\s+(?:during|for|in)\s+(?:triton|verify)|zero[-_ ](?:fill|copy)|overlap\w*|async(?:hronous)?|double[-_ ]buffer\w*)\b/i;
const action = /\b(?:add|implement|support|enable|introduce|replace|fuse\w*|split|paralleliz\w*|pipeline\w*|overlap\w*|optimi[sz]\w*|accelerat\w*|reduc\w*|avoid|remove|reuse|eliminat\w*|batch\w*|schedul\w*|fix|guard|preserv\w*|rebuild|correct|propagat\w*|prevent|use|share|unify|hoist|defer|refactor|cache|gather|shard|retun\w*)\b/i;
const perf = /\[(?:perf|performance)(?:\]|\s)|^perf(?:\([^)]*\))?\s*:|\b(?:speedup|throughput|latency|bandwidth|vectoriz\w*|occupancy|memory[- ]bound|compute[- ]bound)\b/i;
const adapter = /\[(?:model|models)\]|\b(?:add|support|enable|fix|load)\b.*\b(?:checkpoint|tokenizer|chat template|model support|model config)\b|^\s*(?:\[[^\]]+\]\s*)*(?:add (?:support for )?|support )(?:qwen|llama|gemma|glm|nemotron|kimi|deepseek|mistral|gpt|phi|minimax|embedding)\b/i;
const domain = /\b(?:mla|dsa|sdsa|kda|gdn|ssm|kv|hicache|kpool|mamba|nccl|deepep|allocator|vmm|tensorcast|moe|expert|speculative|dflash\w*|dspark|eagle\w*|tp\d*|ep\d*|dcp|cp|pd|p2p|cuda|triton|gemm|fp8|fp4|mxfp8|mxfp4|nvfp4|quantiz\w*|attn|attention|cache|nixl|mooncake|engram|cudnn|rdma|router|schedul\w*|compil\w*|jit|autotun\w*|kernel\w*|sampling|grammar|logits?)\b/i;
const technicalChange = /\b(?:metadata|stride|buffers?|cache|state|stream|layout|loop bounds|overflow|retract\w*|prefill|decode|dispatch\w*|sync\w*|pool\w*|host|index\w*|row\w*|specializ\w*|tiles?|protocol|lifecycle|fence|compress\w*|stor\w*|offload\w*|memory|deadlock|race|verif\w*|shard\w*|fusi\w*|fuse\w*|parallel\w*|communicat\w*|restripe|batch\w*|capacity|allocator|allocation|rout\w*|invocation|async\w*)\b/i;

// These signals defer a decision to content review; they do not certify a tutorial.
const tutorialTitle = /\b(?:tutorial|walkthrough|deep[- ]dive|architecture (?:guide|overview)|design (?:doc(?:ument)?|draft)|(?:explain|explaining) (?:how|why))\b/i;
const explanatoryPath = /(^|\/)(?:tutorials?|design|design_docs?)(\/|$)|(^|\/)architecture\.(?:md|mdx|rst)$|^docs\/(?:docs\/)?(?:advanced_features|features|training)\//i;
const cosmeticTitle = /\b(?:typos?|spelling|broken links?|formatting|math rendering|navigation)\b/i;
function needsTutorialReview(pr: ArchiveCandidate): boolean {
  if (cosmeticTitle.test(pr.title)) return false;
  if (tutorialTitle.test(pr.title)) return true;
  if (pr.files?.some(f => explanatoryPath.test(f.path) && (f.additions ?? 0) >= 32)) return true;
  const prose = (pr.body ?? "").replace(/```[\s\S]*?```/g, "")
    .split("\n").filter(line => !/^\s*(?:\||<!--|[-*]\s*\[[ x]\])/i.test(line)).join("\n");
  const explanations = prose.match(/^#{1,6}\s+(?:how (?:it|this) works|architecture|algorithm|design(?: rationale)?|trade[- ]?offs?|worked example)\b/gim);
  return prose.length >= 800 && (explanations?.length ?? 0) >= 2;
}

export function selectArchiveCandidate(pr: ArchiveCandidate): ArchiveSelection {
  if (pr.favorite || pr.watch_later || pr.note?.trim()) return {keep:true,reason:"user-saved"};
  if (pr.completed) return {keep:true,reason:"existing-completed-analysis"};
  if (pr.focus) {
    const f=pr.focus;
    if (f.kind === "tutorial" && f.learning >= 4 && f.evidence >= 3)
      return {keep:true,reason:"evidence-reviewed-tutorial"};
    return f.kind === "mechanism" && f.learning >= 4 && f.evidence >= 3
      && Math.max(f.architecture,f.performance) >= 4
      ? {keep:true,reason:"evidence-reviewed-mechanism"}
      : {keep:false,reason:"reviewed-below-learning-threshold"};
  }
  const paths=pr.files?.map(f=>f.path) ?? [];
  const title=pr.title.replace(/[_/]/g," ");
  if (needsTutorialReview(pr)) return {keep:true,reason:"tutorial-content-review"};
  if (paths.length && paths.length === pr.changedFiles && paths.every(path=>maintenancePath.test(path))) return {keep:false,reason:"maintenance-files-only"};
  if (maintenanceTitle.test(pr.title)) return {keep:false,reason:"maintenance-title"};
  if (/^\s*revert\b|^\s*\[revert\]/i.test(pr.title)) return {keep:false,reason:"revert-without-new-mechanism"};
  if (tidyTitle.test(pr.title)) return {keep:false,reason:"mechanical-cleanup"};
  if (core.test(title) && (action.test(title) || perf.test(title))) return {keep:true,reason:"mechanism-candidate"};
  if (domain.test(title) && technicalChange.test(title)) return {keep:true,reason:"core-path-candidate"};
  if (adapter.test(pr.title)) return {keep:false,reason:"model-or-format-adaptation"};
  if (perf.test(title) && paths.length && paths.some(p=>!maintenancePath.test(p))) return {keep:true,reason:"performance-candidate"};
  // Sparse or truncated metadata is insufficient grounds for deleting an item.
  if (!paths.length || pr.changedFiles == null || paths.length < pr.changedFiles) return {keep:true,reason:"incomplete-metadata-review"};
  return {keep:false,reason:"no-explicit-core-mechanism"};
}
