import {
  CategoryKey,
  ImportanceLevel,
  PullRequestEvaluation,
  RepositoryRecord
} from "../shared/types";
import { CATEGORY_LABELS, IMPORTANCE_LABELS } from "./config";

export interface AnalyzablePullRequest {
  title: string;
  body?: string | null;
  labels: string[];
  additions?: number | null;
  deletions?: number | null;
  changedFiles?: number | null;
  files?: PullRequestFileSummary[];
}

export interface PullRequestFileSummary {
  path: string;
  additions?: number | null;
  deletions?: number | null;
  changeType?: string | null;
}

export interface PullRequestAnalysis {
  category: CategoryKey;
  categoryLabel: string;
  importance: ImportanceLevel;
  importanceLabel: string;
  importanceReason: string;
  learningComment: string;
  evaluation: PullRequestEvaluation;
}

const categoryMatchers: Array<{ category: CategoryKey; words: string[] }> = [
  {
    category: "docs-ci",
    words: [
      "doc",
      "readme",
      "ci",
      "workflow",
      "lint",
      "format",
      "pre-commit",
      "ruff",
      "typo",
      "license",
      "build wheel"
    ]
  },
  {
    category: "kernels",
    words: [
      "kernel",
      "cuda",
      "triton",
      "cutlass",
      "gemm",
      "fp8",
      "bf16",
      "mla",
      "attention",
      "flash",
      "decode",
      "prefill",
      "fused",
      "quant",
      "benchmark"
    ]
  },
  {
    category: "distributed-moe",
    words: [
      "moe",
      "expert",
      "ep",
      "deepep",
      "allreduce",
      "all-to-all",
      "alltoall",
      "nccl",
      "rdma",
      "distributed",
      "rank",
      "shard",
      "parallel"
    ]
  },
  {
    category: "training-rl",
    words: [
      "train",
      "training",
      "rl",
      "ppo",
      "grpo",
      "reward",
      "rollout",
      "sft",
      "checkpoint",
      "dataset",
      "slime"
    ]
  },
  {
    category: "serving-runtime",
    words: [
      "serving",
      "runtime",
      "scheduler",
      "engine",
      "kv cache",
      "prefix cache",
      "speculative",
      "batch",
      "router",
      "api server",
      "openai",
      "tokenizer",
      "sampling",
      "throughput",
      "latency"
    ]
  },
  {
    category: "reliability",
    words: [
      "fix",
      "bug",
      "regression",
      "crash",
      "oom",
      "deadlock",
      "race",
      "flaky",
      "timeout",
      "error",
      "exception",
      "memory leak"
    ]
  }
];

const importantWords = [
  "breaking",
  "major",
  "architecture",
  "refactor",
  "rewrite",
  "scheduler",
  "engine",
  "kernel",
  "performance",
  "latency",
  "throughput",
  "memory",
  "fp8",
  "moe",
  "distributed",
  "allreduce",
  "cuda graph",
  "speculative",
  "prefix cache",
  "kv cache",
  "benchmark",
  "security"
];

const lowSignalWords = ["typo", "readme", "doc", "lint", "format", "comment"];

function includesAny(text: string, words: string[]): string[] {
  return words.filter((word) => text.includes(word));
}

function compactList(items: string[], limit = 3): string {
  return items.slice(0, limit).join(" / ");
}

function compactChineseList(items: string[], limit = 4): string {
  return items.slice(0, limit).join("、");
}

function keywordLabel(word: string): string {
  const labels: Record<string, string> = {
    breaking: "破坏性变更",
    major: "大改动",
    architecture: "架构",
    refactor: "重构",
    rewrite: "重写",
    scheduler: "调度器",
    engine: "执行引擎",
    kernel: "算子内核",
    performance: "性能",
    latency: "延迟",
    throughput: "吞吐",
    memory: "显存/内存",
    fp8: "FP8",
    moe: "MoE",
    distributed: "分布式",
    allreduce: "AllReduce",
    "cuda graph": "CUDA Graph",
    speculative: "推测解码",
    "prefix cache": "Prefix Cache",
    "kv cache": "KV Cache",
    benchmark: "基准测试",
    security: "安全"
  };
  return labels[word] ?? word;
}

function compactKeywordList(items: string[], limit = 4): string {
  return items.slice(0, limit).map(keywordLabel).join("、");
}

function clampImportance(value: number): ImportanceLevel {
  return Math.max(1, Math.min(5, Math.round(value))) as ImportanceLevel;
}

function pickCategory(text: string, repo: RepositoryRecord): CategoryKey {
  const repoName = repo.displayName.toLowerCase();
  if (repoName.includes("deepgemm") || repoName.includes("flash") || repoName === "fla") {
    if (!includesAny(text, ["doc", "ci", "readme", "test"]).length) {
      return "kernels";
    }
  }
  if (repoName.includes("deepep")) {
    return "distributed-moe";
  }
  if (repoName.includes("slime")) {
    return "training-rl";
  }

  let best: { category: CategoryKey; score: number } = {
    category: "project-meta",
    score: 0
  };
  for (const matcher of categoryMatchers) {
    const score = includesAny(text, matcher.words).length;
    if (score > best.score) {
      best = { category: matcher.category, score };
    }
  }
  return best.category;
}

function categoryLearningHint(category: CategoryKey): string {
  const hints: Record<CategoryKey, string> = {
    "serving-runtime":
      "先看请求生命周期、调度队列、KV cache 生命周期和基准测试；这类改动通常会改变吞吐与尾延迟的权衡。",
    kernels:
      "先看算子入口、tile/warp 布局、dtype 约束和基准测试；重点验证它解决的是带宽、访存还是算力瓶颈。",
    "distributed-moe":
      "先看通信路径、rank 拓扑、buffer 复用和计算通信重叠；MoE/EP 改动常常隐藏在吞吐和稳定性的边界处。",
    "training-rl":
      "先看 rollout、reward、checkpoint 与数据流；训练框架改动要特别留意可复现性和失败恢复路径。",
    reliability:
      "先复现触发条件，再看新增测试覆盖；这类 PR 的学习价值在于定位项目真实生产边界。",
    "docs-ci":
      "快速扫一眼即可，但文档和 CI 经常暴露项目官方推荐路径、依赖版本和即将稳定的接口。",
    "project-meta":
      "先判断它是否改变开发者工作流、依赖版本或发布节奏；必要时顺着关联 issue 看项目方向。"
  };
  return hints[category];
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```([\s\S]*?)```/g, " $1 ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max = 520): string {
  const cleaned = cleanMarkdown(text);
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, max - 1).trim()}...`;
}

function clipLiteral(text: string, max = 220): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, max - 1).trim()}...`;
}

function cleanTechnicalMarkdown(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, " ")
    .replace(/```([\s\S]*?)```/g, " $1 ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/~/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sameMeaning(a: string, b: string): boolean {
  return cleanMarkdown(a).toLowerCase() === cleanMarkdown(b).toLowerCase();
}

function headingMatches(line: string, aliases: string[]): boolean {
  const normalized = line
    .replace(/^#{1,6}\s*/, "")
    .replace(/[:：*_[\]()]/g, " ")
    .toLowerCase()
    .trim();
  return aliases.some((alias) => normalized.includes(alias));
}

function findSection(markdown: string | null | undefined, aliases: string[]): string | null {
  if (!markdown) {
    return null;
  }
  const lines = markdown.split(/\r?\n/);
  let collecting = false;
  const collected: string[] = [];
  for (const line of lines) {
    const isHeading = /^#{1,6}\s+/.test(line) || /^\s*(\*\*)?[\w\u4e00-\u9fa5 /-]+[:：](\*\*)?\s*$/.test(line);
    if (isHeading && headingMatches(line, aliases)) {
      collecting = true;
      continue;
    }
    if (collecting && isHeading && collected.length > 0) {
      break;
    }
    if (collecting && cleanMarkdown(line)) {
      collected.push(line);
    }
  }
  const joined = collected.join(" ");
  const clipped = joined ? clip(joined) : "";
  return clipped || null;
}

function findEvidenceLine(markdown: string | null | undefined, words: string[]): string | null {
  if (!markdown) {
    return null;
  }
  const lines = markdown
    .split(/\r?\n|(?<=[.!。！])\s+/)
    .map((line) => cleanTechnicalMarkdown(line))
    .filter((line) => line.length >= 24);
  const found = lines.find((line) => {
    const lower = line.toLowerCase();
    return words.some((word) => lower.includes(word));
  });
  const clipped = found ? clipLiteral(found, 520) : "";
  return clipped || null;
}

function normalizeHeading(text: string): string {
  return text
    .replace(/^#{1,6}\s*/, "")
    .replace(/[:：*_[\]()]/g, " ")
    .toLowerCase()
    .trim();
}

function findRawSection(markdown: string | null | undefined, aliases: string[]): string | null {
  if (!markdown) {
    return null;
  }
  const lines = markdown.split(/\r?\n/);
  let collecting = false;
  const collected: string[] = [];
  for (const line of lines) {
    const isHeading = /^#{1,6}\s+/.test(line) || /^\s*(\*\*)?[\w\u4e00-\u9fa5 /-]+[:：](\*\*)?\s*$/.test(line);
    if (isHeading && aliases.some((alias) => normalizeHeading(line).includes(alias))) {
      collecting = true;
      continue;
    }
    if (collecting && isHeading && collected.length > 0) {
      break;
    }
    if (collecting && cleanMarkdown(line)) {
      collected.push(line);
    }
  }
  return collected.length ? collected.join("\n") : null;
}

function firstBodyBlock(markdown: string | null | undefined): string | null {
  if (!markdown) {
    return null;
  }
  const body = markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/##\s+Reviewer Notes[\s\S]*$/i, " ")
    .replace(/##\s+Pull Request Checklist[\s\S]*$/i, " ")
    .replace(/##\s+🚀 Pull Request Checklist[\s\S]*$/i, " ");
  const blocks = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => !/^#{1,6}\s/.test(block))
    .filter((block) => !/^\s*[-*]\s+\[[ x]\]/i.test(block))
    .filter((block) => cleanMarkdown(block).length >= 30);
  return blocks[0] ?? null;
}

function translateTechnicalFragment(text: string, max = 420): string {
  let fragment = cleanTechnicalMarkdown(text)
    .replace(/The FA2 attention kernels masked logits with a finite sentinel/gi, "FA2 attention kernel 之前用有限哨兵值对 logits 做 mask")
    .replace(/Because the online-softmax running maximum is tracked over the raw QK dot product/gi, "因为 online-softmax 的 running maximum 跟踪的是原始 QK dot product")
    .replace(/a valid logit below\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi, "低于 $1 的有效 logit")
    .replace(/could never raise the initialized maximum/gi, "无法更新初始化的最大值")
    .replace(/every probability underflowed to zero and valid rows returned zero output/gi, "概率会全部下溢为 0，有效行也返回 0 输出")
    .replace(/Replacing the sentinel with IEEE\s+(-?inf)\s+is necessary but not sufficient/gi, "把哨兵值换成 IEEE $1 是必要但不充分")
    .replace(/The online-softmax updates evaluate/gi, "online-softmax 更新会计算")
    .replace(/a row whose every logit is masked computes/gi, "当一整行 logits 都被 mask 时会算出")
    .replace(/which reaches the output and LSE/gi, "这个 NaN 会进入输出和 LSE")
    .replace(/the existing final/gi, "已有的最终")
    .replace(/guard cannot recover from/gi, "guard 已经无法挽救")
    .replace(/Clamp every exponent difference at\s+(-?inf)\s+before exp2/gi, "在 exp2 之前把每个指数差值 clamp 到 $1")
    .replace(/max drops the NaN operand/gi, "max 会丢掉 NaN 操作数")
    .replace(/finite-input numerics are unchanged/gi, "有限输入的数值结果不变")
    .replace(/the only reachable NaN input maps to exp2\((-?inf)\) = 0/gi, "唯一可达的 NaN 输入会变成 exp2($1)=0")
    .replace(/a fully masked tile contributes nothing/gi, "全 mask tile 贡献 0")
    .replace(/A fully masked row now ends with/gi, "全 mask 行最后会保持")
    .replace(/normalizes to/gi, "归一化为")
    .replace(/matching the empty-row semantics/gi, "与空行语义一致")
    .replace(/The clamp is applied to every consumer of the sentinel/gi, "这个 clamp 被应用到所有消费该哨兵值的路径")
    .replace(/Since m is the running maximum, every clamped difference is already <= 0 for finite inputs, so/gi, "因为 m 是 running maximum，有限输入下所有 clamp 后的差值本来都 <=0，所以")
    .replace(/state_t::normalize skips (the )?division when d == 0/gi, "state_t::normalize 在 d==0 时跳过除法")
    .replace(/MLA kernels already use/gi, "MLA kernel 已经采用")
    .replace(/math::inf now uses/gi, "math::inf 现在改用")
    .replace(/Three surfaces hit this/gi, "触发面有三类")
    .replace(/of a bottom-right aligned causal prefill/gi, "来自 bottom-right 对齐的 causal prefill")
    .replace(/a kv-warp slice that owns no valid column/gi, "不拥有有效列的 kv-warp slice")
    .replace(/an empty split-KV chunk merged/gi, "在 merge 中出现的空 split-KV chunk")
    .replace(/All three deterministic fixtures from the linked issues reproduce locally and now pass/gi, "关联 issue 里的三个确定性复现用例本地都能复现，并且现在全部通过")
    .replace(/No regression beyond run-to-run noise/gi, "除了运行噪声外没有性能回归")
    .replace(/the router forwards requests to the engine/gi, "router 会把请求转发给 engine")
    .replace(/router 会把请求转发给 engine,\s*so sampling/gi, "router 会把请求转发给 engine，所以 sampling")
    .replace(/sampling defaults are normally the engine's job/gi, "sampling 默认值通常由 engine 负责")
    .replace(/which requires editing the checkpoint/gi, "这需要修改 checkpoint")
    .replace(/These flags let an operator set a fleet-wide default/gi, "这些 flag 允许运维设置 fleet-wide 默认")
    .replace(/at the router instead/gi, "改在 router 层设置")
    .replace(/Mirrors the existing ([^:]+) injection/gi, "复用已有的 $1 注入语义")
    .replace(/the value is injected into the forwarded ([^ ]+) body only when the request omits the field/gi, "只有请求没有该字段时，才把默认值注入转发的 $1 body")
    .replace(/absent or explicit null/gi, "字段缺失或显式为 null")
    .replace(/a client-supplied ([^ ]+) always wins/gi, "客户端传入的 $1 始终优先")
    .replace(/a client-supplied ([^.]+?) always wins/gi, "客户端传入的 $1 始终优先")
    .replace(/so 客户端传入的 ([^.]+?) 始终优先/gi, "因此客户端传入的 $1 始终优先")
    .replace(/Unset \(\s*default\s*\) forwards body untouched — no behavior change/gi, "未设置默认值时原样转发 body，不改变行为")
    .replace(/Per-model config/gi, "按模型配置")
    .replace(/Implemented in ([^;。]+?)(?=;|$)/gi, "实现在 $1")
    .replace(/RequestProbe peeks ([^ ]+) to decide fill-if-absent/gi, "RequestProbe 读取 $1 来判断是否补默认值")
    .replace(/forwards body untouched/gi, "原样转发 body")
    .replace(/validated at startup/gi, "启动时校验")
    .replace(/reject out-of-range values/gi, "拒绝越界值")
    .replace(/full cargo test green/gi, "完整 cargo test 通过")
    .replace(/new and updated tests are CPU-runnable/gi, "新增和更新的测试都可在 CPU 上运行")
    .replace(/MUSA and MCCL behavior is checked with monkeypatches/gi, "MUSA/MCCL 行为通过 monkeypatch 校验")
    .replace(/a fake torch\.musa namespace, and backend strings; no test imports torch_musa, initializes MCCL, or requires accelerator hardware/gi, "测试使用 fake torch.musa namespace 和 backend string，不导入 torch_musa、不初始化 MCCL，也不需要加速卡硬件")
    .replace(/checked with monkeypatches/gi, "通过 monkeypatch 校验")
    .replace(/requires accelerator hardware/gi, "需要加速卡硬件")
    .replace(/This PR introduces a backend-neutral accelerator layer/gi, "这个 PR 引入一层后端无关的 accelerator 抽象")
    .replace(/a backend-neutral accelerator layer for Slime/gi, "一层用于 Slime 的后端无关 accelerator 抽象")
    .replace(/accelerator 抽象 for Slime/gi, "用于 Slime 的 accelerator 抽象")
    .replace(/一层后端无关的 用于 Slime 的 accelerator 抽象/g, "一层用于 Slime 的后端无关 accelerator 抽象")
    .replace(/adds a MUSA implementation/gi, "新增 MUSA 实现")
    .replace(/while preserving the existing CUDA\/ROCm execution path/gi, "同时保留现有 CUDA/ROCm 执行路径")
    .replace(/\bThis PR introduces\b/gi, "这个 PR 引入")
    .replace(/\bThis PR adds\b/gi, "这个 PR 新增")
    .replace(/\bAdds\b/gi, "新增")
    .replace(/\bAdd\b/gi, "新增")
    .replace(/\bFixes\b/gi, "修复")
    .replace(/\bFix\b/gi, "修复")
    .replace(/\bImproves\b/gi, "改进")
    .replace(/\bImproved\b/gi, "改进了")
    .replace(/\bPreserves\b/gi, "保留")
    .replace(/\bPreserving\b/gi, "保留")
    .replace(/\bSupports\b/gi, "支持")
    .replace(/\bSupport\b/gi, "支持")
    .replace(/\bEnables\b/gi, "启用")
    .replace(/\bEnable\b/gi, "启用")
    .replace(/\bRemoves\b/gi, "移除")
    .replace(/\bRemove\b/gi, "移除")
    .replace(/\bRefactors\b/gi, "重构")
    .replace(/\bRefactor\b/gi, "重构")
    .replace(/\bPreviously\b/gi, "之前")
    .replace(/\bBefore\b/gi, "之前")
    .replace(/\bNow\b/gi, "现在")
    .replace(/\bAfter\b/gi, "之后")
    .replace(/\bbecause\b/gi, "因为")
    .replace(/\band\b/gi, "和")
    .replace(/\bor\b/gi, "或")
    .replace(/\bi\.e\.\b/gi, "也就是")
    .replace(/\ba finite\b/gi, "一个有限")
    .replace(/\busing a\b/gi, "使用一个")
    .replace(/\bwith a\b/gi, "带有一个")
    .replace(/\bwithout\b/gi, "不依赖")
    .replace(/\bwith\b/gi, "使用")
    .replace(/\brequires\b/gi, "需要")
    .replace(/\brequired\b/gi, "需要")
    .replace(/\bfallback\b/gi, "回退")
    .replace(/\bregression\b/gi, "回归")
    .replace(/\bbug\b/gi, "bug")
    .replace(/\bbenchmark\b/gi, "benchmark")
    .replace(/\bperformance\b/gi, "性能")
    .replace(/\bthroughput\b/gi, "吞吐")
    .replace(/\blatency\b/gi, "延迟")
    .replace(/\bmemory\b/gi, "内存/显存")
    .replace(/\bkernel\b/gi, "kernel")
    .replace(/\bdispatch\b/gi, "dispatch")
    .replace(/\battention\b/gi, "attention")
    .replace(/\bdecode\b/gi, "decode")
    .replace(/\bprefill\b/gi, "prefill")
    .replace(/\bmasked logits?\b/gi, "mask 后的 logits")
    .replace(/\bfully masked rows?\b/gi, "全 mask 行")
    .replace(/\bfully masked head[- ]rows?\b/gi, "全 mask head-row")
    .replace(/\bfully masked tile\b/gi, "全 mask tile")
    .replace(/\bempty rows?\b/gi, "空行")
    .replace(/\bempty chunks?\b/gi, "空 chunk")
    .replace(/\bvalid keys?\b/gi, "有效 key")
    .replace(/\bvalid rows?\b/gi, "有效行")
    .replace(/\bvalid logits?\b/gi, "有效 logit")
    .replace(/\brunning maximum\b/gi, "running maximum")
    .replace(/\bsentinel\b/gi, "哨兵值")
    .replace(/\bfinite\b/gi, "有限")
    .replace(/\bNaN\b/g, "NaN")
    .replace(/\s+/g, " ")
    .trim();
  fragment = fragment
    .replace(/\bthe\b/gi, "")
    .replace(/Unset \(\s*default\s*\) forwards body untouched — no behavior change/gi, "未设置默认值时原样转发 body，不改变行为")
    .replace(/,\s*so\s+/gi, "，所以 ")
    .replace(/\s+/g, " ")
    .trim();
  return clipLiteral(fragment, max);
}

function sectionOrFallback(markdown: string, aliases: string[], fallbackWords: string[]): string | null {
  const section = findRawSection(markdown, aliases);
  if (section) {
    return section;
  }
  const evidence = findEvidenceLine(markdown, fallbackWords);
  if (evidence) {
    return evidence;
  }
  return firstBodyBlock(markdown);
}

const technicalTermRules: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bonline[- ]softmax\b/i, label: "online softmax" },
  { pattern: /\bsoftmax\b/i, label: "softmax 数值稳定性" },
  { pattern: /\blogits?\b/i, label: "logits" },
  { pattern: /\bLSE\b|\blogsumexp\b/i, label: "LSE/logsumexp" },
  { pattern: /\bNaN\b/i, label: "NaN 传播" },
  { pattern: /-inf|infinity|numeric_limits/i, label: "-inf/Infinity 哨兵语义" },
  { pattern: /\bsplit[-_ ]?KV\b/i, label: "split-KV" },
  { pattern: /\bKV cache\b|\bkv_cache\b/i, label: "KV cache" },
  { pattern: /\bprefill\b/i, label: "prefill" },
  { pattern: /\bdecode\b/i, label: "decode" },
  { pattern: /\brouter\b/i, label: "router 转发层" },
  { pattern: /\bscheduler\b/i, label: "scheduler" },
  { pattern: /\bsampling\b|\btop[_-]?k\b|\btop[_-]?p\b/i, label: "sampling 默认值" },
  { pattern: /\bMoE\b|\bexpert\b|\bexperts\b/i, label: "MoE/expert 路径" },
  { pattern: /\ball[-_ ]?to[-_ ]?all\b|\ba2a\b/i, label: "all-to-all 通信" },
  { pattern: /\ball[-_ ]?reduce\b/i, label: "all-reduce 通信" },
  { pattern: /\bDeepEP\b/i, label: "DeepEP 后端" },
  { pattern: /\bGEMM\b|\bmatmul\b|\bmm_/i, label: "GEMM" },
  { pattern: /\bFP8\b|\bNVFP4\b|\bMXFP8\b|\bBF16\b|\bFP16\b/i, label: "低精度 dtype" },
  { pattern: /\bCUDA\b|\bTriton\b|\bCuTe\b|\bCUTLASS\b|\bROCm\b|\bMUSA\b/i, label: "硬件后端适配" },
  { pattern: /\bCUDA Graph\b|\bcudagraph\b/i, label: "CUDA Graph" },
  { pattern: /\bprefix cache\b|\bprefix caching\b/i, label: "Prefix Cache" },
  { pattern: /\boffload\b|\boffloading\b/i, label: "offload" },
  { pattern: /\bcheckpoint\b|\brollout\b|\breward\b|\bGRPO\b|\bPPO\b/i, label: "训练/RL 数据流" },
  { pattern: /\bdeadlock\b|\blivelock\b|\brace\b|\btimeout\b|\bOOM\b/i, label: "并发/资源边界" }
];

function collectTechnicalTerms(pr: AnalyzablePullRequest): string[] {
  const text = `${pr.title}\n${pr.body ?? ""}\n${(pr.files ?? []).map((file) => file.path).join("\n")}`;
  const terms = technicalTermRules
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.label);
  return Array.from(new Set(terms)).slice(0, 8);
}

function describePath(path: string): string {
  if (/attention|fmha|mla/i.test(path)) return "attention/MLA kernel";
  if (/moe|expert|deepep/i.test(path)) return "MoE/Expert 并行";
  if (/gemm|matmul|cutlass|cute/i.test(path)) return "GEMM/kernel";
  if (/router/i.test(path)) return "router/API 转发";
  if (/scheduler|engine|worker|runtime/i.test(path)) return "runtime/scheduler";
  if (/kv|cache|connector|offload/i.test(path)) return "KV/cache/offload";
  if (/test|bench|ci|workflow/i.test(path)) return "测试/CI";
  if (/doc|readme|md$/i.test(path)) return "文档";
  if (/musa|rocm|cuda|triton/i.test(path)) return "硬件后端";
  return "实现文件";
}

function fileHotspots(files: PullRequestFileSummary[] | undefined): string {
  if (!files?.length) {
    return "";
  }
  const topFiles = [...files]
    .sort((a, b) => ((b.additions ?? 0) + (b.deletions ?? 0)) - ((a.additions ?? 0) + (a.deletions ?? 0)))
    .slice(0, 5);
  const groups = Array.from(new Set(topFiles.map((file) => describePath(file.path)))).slice(0, 4);
  const fileText = topFiles
    .map((file) => {
      const delta = file.additions != null || file.deletions != null ? ` +${file.additions ?? 0}/-${file.deletions ?? 0}` : "";
      return `${file.path}${delta}`;
    })
    .join("；");
  return `主要触点是 ${groups.join("、")}，热点文件包括 ${fileText}。`;
}

function evidenceLines(markdown: string | null | undefined): string[] {
  if (!markdown) {
    return [];
  }
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^<!--|-->$/.test(line))
    .filter((line) => !/^\s*[-*]\s+\[[ x]\]/i.test(line));
  const nonGenerated = lines.filter((line) => !/generated (with|using)|claude code|coderabbit|latest pr test/i.test(line));
  const useful = nonGenerated.filter((line) => {
    const lower = line.toLowerCase();
    return (
      /\b(pass|passed|fail|failed|regression|benchmark|performance|latency|throughput|speedup|baseline|ms|us|tflops|tokens\/s|gb\/s|x)\b/.test(lower) ||
      /\|\s*[-\w ./%]+\s*\|/.test(line)
    );
  });
  return useful.map((line) => translateTechnicalFragment(line, 260)).filter(Boolean).slice(0, 5);
}

function issueText(markdown: string): string {
  const refs = issueRefs(markdown);
  return refs.length ? `关联 ${compactChineseList(refs)}，说明它来自已暴露的问题或 review 追踪。` : "";
}

function operationFromTitle(title: string): string {
  const lower = title.toLowerCase();
  if (/\bfix(e[sd])?\b|bug|regression|crash|oom|deadlock|flaky/.test(lower)) return "修复";
  if (/\brestore\b/.test(lower)) return "恢复";
  if (/\benable\b/.test(lower)) return "启用";
  if (/\b(add|support|introduce|implement)\b/.test(lower)) return "新增";
  if (/\b(optimi[sz]e|perf|speed|faster|latency|throughput)\b/.test(lower)) return "优化";
  if (/\b(remove|delete|prune|deprecate)\b/.test(lower)) return "移除";
  if (/\brefactor|rewrite|cleanup\b/.test(lower)) return "重构";
  if (/\btest|ci|workflow\b/.test(lower)) return "验证";
  if (/\bdoc|readme\b/.test(lower)) return "文档";
  return "调整";
}

function categoryName(category: CategoryKey): string {
  return CATEGORY_LABELS[category];
}

function operationPurpose(operation: string): string {
  const map: Record<string, string> = {
    修复: "消除特定边界下的失败、回归或不稳定行为",
    恢复: "把此前被收紧或偏移的默认策略恢复到更符合实际性能的位置",
    启用: "把已有能力或测试覆盖默认打开，让问题更早暴露",
    新增: "补齐项目之前缺少的能力、模型路径或硬件支持",
    优化: "降低核心路径的延迟、显存、通信或计算开销",
    移除: "清理旧实现、冗余测试或已经不推荐的路径，降低维护成本",
    重构: "降低实现耦合，为后续扩展、验证或性能优化留空间",
    验证: "扩大自动化测试、CI 和基准测试覆盖，减少人工回归成本",
    文档: "把使用路径、约束或推荐实践写清楚，减少读代码反推的成本",
    调整: "校准相关实现或默认行为，使项目状态更贴近当前需求"
  };
  return map[operation] ?? map.调整;
}

function titleToChineseTopic(title: string): string {
  let topic = cleanMarkdown(title)
    .replace(/^\[[^\]]+\]\s*/g, "")
    .replace(/^test\s*:\s*/i, "测试：")
    .replace(/\bfix(e[sd])?\b/gi, "修复")
    .replace(/\bsupport\b/gi, "支持")
    .replace(/\benable\b/gi, "启用")
    .replace(/\brestore\b/gi, "恢复")
    .replace(/\badd\b|\bintroduce\b|\bimplement\b/gi, "新增")
    .replace(/\boptimi[sz]e\b|\bperf\b/gi, "优化")
    .replace(/\bremove\b|\bdelete\b|\bprune\b/gi, "移除")
    .replace(/\bstabilize\b/gi, "稳定")
    .replace(/\bby\s+default\b/gi, "默认")
    .replace(/\band\b/gi, "并")
    .replace(/\bunified\b/gi, "统一")
    .replace(/\buts\b/gi, "单测")
    .replace(/\bdefault\b/gi, "默认")
    .replace(/\blegacy\b/gi, "旧")
    .replace(/\bthreshold\b/gi, "阈值")
    .replace(/\btokens\b/gi, "tokens")
    .replace(/\btokenizers\b/gi, "tokenizers")
    .replace(/\bbackend\b/gi, "后端")
    .replace(/\bfuzzer\b/gi, "fuzzer")
    .replace(/\bfixture\b/gi, "fixture")
    .replace(/\bnode ids\b/gi, "节点 ID")
    .replace(/\bthe\b/gi, "")
    .replace(/\bon\b/gi, "在")
    .replace(/\s+/g, " ")
    .trim();
  topic = topic.replace(/^恢复\s+(\d+)\s+token\s+(.+?)\s+阈值\s+在\s+(.+)$/i, "恢复 $3 上 $1-token $2 阈值");
  topic = topic.replace(/^测试：启用\s+(.+?)\s+默认\s+并\s+移除\s+旧\s+单测$/i, "测试：默认启用 $1，并移除旧单测");
  if (!topic) {
    topic = title;
  }
  return clipLiteral(topic, 180);
}

function diffSummary(pr: AnalyzablePullRequest): string {
  if (pr.changedFiles == null) {
    return "当前归档没有拿到完整 diff 统计";
  }
  return `${pr.changedFiles} 个文件，+${pr.additions ?? 0}/-${pr.deletions ?? 0}`;
}

function issueRefs(text: string): string[] {
  return Array.from(new Set((text.match(/#[0-9]+/g) ?? []).slice(0, 4)));
}

function extractCommands(markdown: string): string[] {
  const commands = new Set<string>();
  const commandStart = /^(python|python3|pytest|uv |pip |npm |pnpm |yarn |cmake|ninja|make|bash|sh |CUDA|TORCH)/i;
  const collectFromLines = (lines: string[]) => {
    for (let index = 0; index < lines.length; index += 1) {
      let line = lines[index].trim().replace(/^[-*]\s*/, "");
      if (!commandStart.test(line)) {
        continue;
      }
      while (/\\\s*$/.test(line) && index + 1 < lines.length) {
        index += 1;
        const next = lines[index].trim().replace(/^[-*]\s*/, "");
        line = `${line.replace(/\\\s*$/, "").trim()} ${next}`.trim();
      }
      commands.add(line);
    }
  };

  const fenced = markdown.match(/```[\s\S]*?```/g) ?? [];
  for (const block of fenced) {
    collectFromLines(
      block
        .replace(/```[a-zA-Z0-9_-]*/g, "")
        .replace(/```/g, "")
        .split(/\r?\n/)
    );
  }
  collectFromLines(markdown.split(/\r?\n/));
  return Array.from(commands).slice(0, 3);
}

function bodySignals(markdown: string | null | undefined): {
  hasBenchmark: boolean;
  hasTest: boolean;
  hasCi: boolean;
  hasSweep: boolean;
  hasNumbers: boolean;
  issues: string[];
  commands: string[];
} {
  const body = markdown ?? "";
  const lower = body.toLowerCase();
  return {
    hasBenchmark: /\bbenchmark|performance|throughput|latency|speedup|tokens\/s|gb\/s|tflops\b/.test(lower),
    hasTest: /\bpytest|unit test|test plan|tested|validation|reran|re-run|run test\b/.test(lower),
    hasCi: /\bci\b|workflow|github action/.test(lower),
    hasSweep: /\bsweep|ablation|matrix|compare|baseline|wins?\b/.test(lower),
    hasNumbers: /\b\d+(\.\d+)?\s*(%|x|ms|us|gb\/s|tflops|tokens?\/s|files?)\b/i.test(body),
    issues: issueRefs(body),
    commands: extractCommands(body)
  };
}

function beforeTemplate(operation: string, category: CategoryKey): string {
  const focus = categoryName(category);
  const map: Record<string, string> = {
    修复: `合并前，${focus} 路径在某些输入、平台或配置组合下会失败或表现不稳定。读这个 PR 时要先找触发条件：是 shape、dtype、并发、缓存状态，还是 CI 环境差异。`,
    恢复: `合并前，相关默认策略或阈值曾被调低/替换，可能让一部分原本更优的算子内核、调度或测试路径不再被覆盖。这个状态通常不是“功能坏了”，而是性能判断和覆盖边界发生了偏移。`,
    启用: `合并前，能力或测试已经存在，但不是默认路径，导致回归可能长期潜伏，只有手动运行或特定环境才会暴露。`,
    新增: `合并前，项目缺少这类模型、硬件、后端或运行路径支持，下游需要绕开、手写适配，或接受较差的 fallback 行为。`,
    优化: `合并前，${focus} 仍有可见瓶颈，可能体现在延迟、吞吐、显存、通信重叠或算子选择上。关键是确认它优化的是哪条热路径，而不是只看代码改动大小。`,
    移除: `合并前，仓库里保留了旧逻辑、旧测试或重复路径，会增加维护成本，也容易让新人误判哪个路径才是当前推荐实现。`,
    重构: `合并前，相关实现可能耦合较高，后续扩展、测试隔离或性能验证成本偏高。需要确认它是否保持行为等价。`,
    验证: `合并前，自动化验证覆盖不够完整，某些平台、scope 或边界只能靠人工检查或下游使用暴露。`,
    文档: `合并前，使用方法、约束条件或推荐路径表达不够清晰，读者需要从源码、issue 或 CI 配置里反推。`,
    调整: `合并前，${focus} 相关行为存在需要校准的地方；具体影响要结合 PR 正文、review 讨论和 diff 热点判断。`
  };
  return map[operation] ?? map.调整;
}

function afterTemplate(operation: string, category: CategoryKey, topic: string): string {
  const focus = categoryName(category);
  const map: Record<string, string> = {
    修复: `合并后，项目会在目标边界上走更稳定的实现或测试路径。主题可以概括为“${topic}”，所以验证重点是旧问题是否不再复现，同时不引入新的兼容性分支。`,
    恢复: `合并后，默认策略/阈值会回到更符合当前基准测试或硬件事实的位置。主题可以概括为“${topic}”，所以要关注是否重新覆盖了被遗漏的高收益路径。`,
    启用: `合并后，相关能力、测试或 fuzz 覆盖进入默认流程。主题可以概括为“${topic}”，价值在于让回归更早暴露，而不是等到下游用户踩到。`,
    新增: `合并后，${focus} 获得新的支持面。主题可以概括为“${topic}”，后续要看它是否成为主路径，还是只覆盖特定模型/硬件组合。`,
    优化: `合并后，目标热路径理论上会有更好的延迟、吞吐、显存或通信表现。主题可以概括为“${topic}”，但最终要以基准测试和端到端负载为准。`,
    移除: `合并后，旧路径或冗余覆盖被清理，项目状态更容易读懂。主题可以概括为“${topic}”，需要确认没有删除仍被用户依赖的兼容入口。`,
    重构: `合并后，代码组织或边界会更清楚，后续新增能力/测试更容易落位。主题可以概括为“${topic}”，重点检查行为等价和测试覆盖。`,
    验证: `合并后，CI、测试或 fuzz 覆盖更靠近真实失败边界。主题可以概括为“${topic}”，它的价值主要是提前捕获回归。`,
    文档: `合并后，用户或贡献者能更直接看到推荐用法、限制条件或维护路径。主题可以概括为“${topic}”。`,
    调整: `合并后，${focus} 的相关实现或默认行为被校准。主题可以概括为“${topic}”，需要从 diff 判断影响范围。`
  };
  return map[operation] ?? map.调整;
}

function rationaleTemplate(
  pr: AnalyzablePullRequest,
  category: CategoryKey,
  importanceReason: string,
  signals: ReturnType<typeof bodySignals>
): string {
  const terms = collectTechnicalTerms(pr);
  const hotspots = fileHotspots(pr.files);
  const evidence =
    signals.hasBenchmark || signals.hasTest || signals.hasCi
      ? "PR 正文里有测试、benchmark 或 CI 证据，可以把结论和触发条件对上"
      : "PR 正文里缺少完整实验输出，合理性仍需要靠 CI、benchmark 或 review 讨论补强";
  const termText = terms.length
    ? `机制上它围绕 ${compactChineseList(terms, 6)} 等点做校准。`
    : `机制上要先定位它触碰的是「${categoryName(category)}」里的入口、状态更新、回退还是测试覆盖。`;
  return `${termText}${hotspots ? `${hotspots}` : ""}改动规模是 ${diffSummary(pr)}，${evidence}。${importanceReason}判断这类 PR 是否合理，不要只看“修了/新增了”，要看它是否把旧边界的失败条件、新路径的语义，以及新增测试覆盖闭合起来。`;
}

function experimentTemplate(
  pr: AnalyzablePullRequest,
  category: CategoryKey,
  signals: ReturnType<typeof bodySignals>
): string {
  const body = pr.body ?? "";
  const verification = findRawSection(body, ["verification", "validation", "tests", "test plan", "test", "ci"]);
  const performance = findRawSection(body, ["performance", "benchmark", "benchmarks", "perf"]);
  const evidence = evidenceLines([verification, performance, body].filter(Boolean).join("\n"));
  const commandText = signals.commands.length
    ? `归档里能看到测试/基准测试命令：${signals.commands.map((command) => `\`${clipLiteral(command, 420)}\``).join("；")}。`
    : "";
  if (verification || performance || evidence.length) {
    const sectionText = [verification, performance]
      .filter(Boolean)
      .map((section) => translateTechnicalFragment(section!, 520))
      .filter(Boolean)
      .slice(0, 2)
      .join("；");
    const evidenceText = evidence.length ? `关键证据线索：${evidence.join("；")}。` : "";
    return `${commandText}${sectionText ? `PR 给出的验证/性能信息是：${sectionText}。` : ""}${evidenceText}读的时候要继续核对硬件、dtype、shape、batch size 和 baseline，避免把单机微基准误读成端到端收益。`;
  }
  if (signals.hasBenchmark || signals.hasSweep || signals.hasNumbers) {
    return `${commandText || "PR 正文提到基准测试、参数 sweep、baseline 或数值结果。"}当前归档没有保存完整表格/日志，所以不要把摘要当最终性能结论；建议打开 PR 对照吞吐、延迟、shape 覆盖、硬件型号和回退条件。对「${categoryName(category)}」来说，最关键的是确认优化是否在真实负载上成立，而不是只在微基准里成立。`;
  }
  if (signals.hasTest || signals.hasCi) {
    return `${commandText || "PR 正文包含测试、CI 或验证计划信号。"}这类证据能说明回归路径被覆盖，但通常不能证明性能收益；建议继续检查新增测试是否覆盖失败边界、平台差异和关键 dtype/shape。`;
  }
  return `未在 PR 标题/正文中看到显式实验、基准测试或测试输出。建议打开 PR 检查 CI 状态、review 讨论、关联 issue，以及 ${diffSummary(pr)} 的代码改动是否真的触达 ${categoryName(category)} 的关键路径。`;
}

function fallbackMotivation(category: CategoryKey, repo: RepositoryRecord, hits: string[]): string {
  const focus = CATEGORY_LABELS[category];
  if (hits.length) {
    return `动机大概率是改善 ${repo.displayName} 的 ${focus} 路径，因为标题/正文命中了 ${compactList(hits)} 等信号。`;
  }
  return `动机需要结合 PR 正文和关联 issue 确认；从分类看，它主要服务于 ${repo.displayName} 的 ${focus} 维护或演进。`;
}

function fallbackBefore(title: string, category: CategoryKey): string {
  const op = operationFromTitle(title);
  const focus = CATEGORY_LABELS[category];
  const map: Record<string, string> = {
    修复: `之前相关 ${focus} 场景存在 bug、回归或边界条件失败，需要从复现描述和新增测试确认触发条件。`,
    恢复: `之前已有行为/阈值被改动后可能造成性能或兼容性偏移，这个 PR 试图回到更稳的默认。`,
    启用: `之前能力、测试或路径存在但未默认开启，覆盖面或可见性不足。`,
    新增: `之前项目缺少标题所描述的能力或模型/硬件/路径支持。`,
    优化: `之前核心路径仍有性能、显存、调度或通信开销，值得对照 benchmark 看瓶颈来源。`,
    移除: `之前保留了旧实现、旧测试或冗余路径，增加维护成本或误导后续开发。`,
    重构: `之前实现可能耦合较高或扩展成本偏高，但要从 diff 判断是否保持行为等价。`,
    验证: `之前测试/CI 覆盖不足，相关问题可能只能靠人工或下游使用暴露。`,
    文档: `之前使用路径或约束说明不够清楚，读者需要从代码或 issue 反推。`,
    调整: `之前行为需要从 PR 正文、review 讨论和 diff 中确认；标题表明它在调整 ${focus} 相关路径。`
  };
  return map[op];
}

function fallbackAfter(title: string, category: CategoryKey): string {
  const op = operationFromTitle(title);
  const focus = CATEGORY_LABELS[category];
  return `合并后变化是“${clip(title, 140)}”。按标题判断，这是一次 ${op} 型改动，会改变或澄清 ${focus} 的实现、默认行为或验证覆盖。`;
}

function buildStructuredEvaluation(
  pr: AnalyzablePullRequest,
  repo: RepositoryRecord,
  category: CategoryKey,
  importanceReason: string,
  hits: string[]
): PullRequestEvaluation {
  const body = pr.body ?? "";
  const operation = operationFromTitle(pr.title);
  const topic = titleToChineseTopic(pr.title);
  const signals = bodySignals(body);
  const motivationSource = sectionOrFallback(body, ["motivation", "purpose", "problem", "background", "summary", "description", "why"], [
    "problem",
    "because",
    "previously",
    "regression",
    "bug",
    "adds",
    "introduces",
    "support"
  ]);
  const previousSource = sectionOrFallback(body, ["problem", "background", "before", "current behavior", "motivation"], [
    "previously",
    "before",
    "bug",
    "regression",
    "failed",
    "wrong",
    "nan",
    "crash",
    "oom",
    "deadlock",
    "livelock"
  ]);
  const newSource = sectionOrFallback(body, ["fix", "solution", "implementation", "changes", "behavior", "after", "summary"], [
    "now",
    "adds",
    "introduces",
    "clamp",
    "replace",
    "fallback",
    "dispatch",
    "support"
  ]);
  const terms = collectTechnicalTerms(pr);
  const hotspots = fileHotspots(pr.files);
  const issueNote = issueText(`${pr.title}\n${body}`);
  const hitText = hits.length ? `高影响信号包括 ${compactKeywordList(hits)}。` : "";
  const termText = terms.length ? `技术关键词是 ${compactChineseList(terms, 7)}。` : "";

  const motivation = motivationSource
    ? `这个 PR 要解决的是 ${repo.displayName} 在“${topic}”上的具体问题，而不是抽象地“值得关注”。PR 正文给出的直接线索是：${translateTechnicalFragment(motivationSource, 560)}。${issueNote}${termText}${hitText}`.trim()
    : `这个 PR 要解决的是 ${repo.displayName} 的「${categoryName(category)}」路径里“${topic}”对应的能力缺口或边界问题。按标题判断，它属于${operation}型改动，目标是${operationPurpose(operation)}。${issueNote}${termText}${hitText}`.trim();

  const previousBehavior = previousSource
    ? `合并前的关键状态可以这样理解：${translateTechnicalFragment(previousSource, 560)}。如果要验证这段，优先找复现条件、旧默认值、旧 dispatch/回退分支，或者旧测试为什么漏掉。`
    : `${beforeTemplate(operation, category)}${hotspots ? `从文件热点看，旧行为需要沿着这些触点反推：${hotspots}` : ""}`;
  const newBehavior = newSource
    ? `合并后变成：${translateTechnicalFragment(newSource, 620)}。${hotspots || `本次归档的代码改动规模是 ${diffSummary(pr)}。`}`
    : `${afterTemplate(operation, category, topic)}本次归档的代码改动规模是 ${diffSummary(pr)}。${hotspots}`;
  const rationale = rationaleTemplate(pr, category, importanceReason, signals);
  const experiments = experimentTemplate(pr, category, signals);

  return {
    motivation,
    previousBehavior,
    newBehavior,
    rationale,
    experiments
  };
}

export function analyzePullRequest(
  pr: AnalyzablePullRequest,
  repo: RepositoryRecord
): PullRequestAnalysis {
  const text = `${repo.displayName} ${pr.title} ${pr.body ?? ""} ${pr.labels.join(" ")}`.toLowerCase();
  const category = pickCategory(text, repo);
  const hits = includesAny(text, importantWords);
  const lowHits = includesAny(text, lowSignalWords);
  const totalDelta = (pr.additions ?? 0) + (pr.deletions ?? 0);
  const files = pr.changedFiles ?? 0;

  let score = 1 + Math.min(2, Math.floor(repo.importanceWeight / 2));
  const reasons: string[] = [];

  if (hits.length) {
    score += hits.includes("breaking") || hits.includes("architecture") ? 2 : 1;
    reasons.push(`命中${compactKeywordList(hits)}等高影响关键词`);
  }
  if (category === "kernels" || category === "distributed-moe" || category === "serving-runtime") {
    score += 1;
    reasons.push(`「${CATEGORY_LABELS[category]}」是核心路径`);
  }
  if (totalDelta > 1200 || files > 18) {
    score += 1;
    reasons.push(`diff 较大：${files || "?"} 个文件，+${pr.additions ?? "?"}/-${pr.deletions ?? "?"}`);
  }
  if (category === "docs-ci" && lowHits.length) {
    score -= 2;
    reasons.push(`偏维护项：${compactChineseList(lowHits)}`);
  }
  if (category === "reliability") {
    score += 1;
    reasons.push("修复类 PR 可能对应真实线上边界");
  }

  const importance = clampImportance(score);
  const statLine =
    pr.changedFiles == null
      ? "diff 统计未获取"
      : `${pr.changedFiles} 个文件，+${pr.additions ?? 0}/-${pr.deletions ?? 0}`;
  const reason = reasons.length
    ? `${reasons.join("；")}。${statLine}。`
    : `未命中明显架构/性能关键词，按仓库权重与类别给出基础分。${statLine}。`;
  const evaluation = buildStructuredEvaluation(pr, repo, category, reason, hits);
  const operation = operationFromTitle(pr.title);
  const terms = collectTechnicalTerms(pr);
  const hotspots = fileHotspots(pr.files);
  const studyFocus = terms.length
    ? `重点把 ${compactChineseList(terms, 5)} 这些词和 diff 里的状态更新/dispatch/测试对上。`
    : categoryLearningHint(category);

  return {
    category,
    categoryLabel: CATEGORY_LABELS[category],
    importance,
    importanceLabel: IMPORTANCE_LABELS[importance],
    importanceReason: reason,
    learningComment: `阅读建议：这是一条 ${repo.displayName} 的「${CATEGORY_LABELS[category]}」${operation}型 PR，评级为 ${IMPORTANCE_LABELS[importance]}。先读“动机”确认它解决的真实问题，再读“之前/之后”里的机制差异，最后用“实验/效果”核证据。${studyFocus}${hotspots ? ` ${hotspots}` : ""}`,
    evaluation
  };
}
