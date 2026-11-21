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
  // Ranking is metadata, never evidence for claims about the code.
  // Deep dives are produced separately from fetched diffs and immutable source.
  const evaluation = { motivation: "", previousBehavior: "", newBehavior: "", rationale: "", experiments: "" };

  return {
    category,
    categoryLabel: CATEGORY_LABELS[category],
    importance,
    importanceLabel: IMPORTANCE_LABELS[importance],
    importanceReason: reason,
    learningComment: "",
    evaluation
  };
}
