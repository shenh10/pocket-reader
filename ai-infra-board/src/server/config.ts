import "dotenv/config";
import { CategoryKey, ImportanceLevel, RepositoryConfig } from "../shared/types";

export const APP_TIMEZONE = process.env.TIMEZONE || "Asia/Shanghai";

export const DEFAULT_REPOSITORIES: RepositoryConfig[] = [
  {
    fullName: "vllm-project/vllm",
    displayName: "vLLM",
    homepageUrl: "https://github.com/vllm-project/vllm",
    description: "Open-source high-throughput LLM serving engine.",
    importanceWeight: 5
  },
  {
    fullName: "sgl-project/sglang",
    displayName: "SGLang",
    homepageUrl: "https://github.com/sgl-project/sglang",
    description: "Serving framework and runtime for fast LLM/VLM inference.",
    importanceWeight: 5
  },
  {
    fullName: "THUDM/slime",
    displayName: "slime",
    homepageUrl: "https://github.com/THUDM/slime",
    description: "Post-training framework for LLM RL and scaling experiments.",
    importanceWeight: 4
  },
  {
    fullName: "flashinfer-ai/flashinfer",
    displayName: "FlashInfer",
    homepageUrl: "https://github.com/flashinfer-ai/flashinfer",
    description: "Kernel library for LLM serving and attention workloads.",
    importanceWeight: 5
  },
  {
    fullName: "deepseek-ai/DeepGEMM",
    displayName: "DeepGEMM",
    homepageUrl: "https://github.com/deepseek-ai/DeepGEMM",
    description: "DeepSeek GEMM kernels for FP8 and dense compute paths.",
    importanceWeight: 5
  },
  {
    fullName: "deepseek-ai/DeepEP",
    displayName: "DeepEP",
    homepageUrl: "https://github.com/deepseek-ai/DeepEP",
    description: "Expert-parallel communication library for MoE inference/training.",
    importanceWeight: 5
  },
  {
    fullName: "deepseek-ai/FlashMLA",
    displayName: "FlashMLA",
    homepageUrl: "https://github.com/deepseek-ai/FlashMLA",
    description: "MLA-focused attention kernels from DeepSeek.",
    importanceWeight: 5
  },
  {
    fullName: "fla-org/flash-linear-attention",
    displayName: "FLA",
    homepageUrl: "https://github.com/fla-org/flash-linear-attention",
    description: "Efficient linear attention and sequence modeling kernels.",
    importanceWeight: 4
  },
  {
    fullName: "Dao-AILab/flash-attention",
    displayName: "FlashAttention",
    homepageUrl: "https://github.com/Dao-AILab/flash-attention",
    description: "Reference implementation for fast exact attention kernels.",
    importanceWeight: 5
  }
];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  "serving-runtime": "服务运行时",
  kernels: "算子内核",
  "distributed-moe": "分布式/MoE",
  "training-rl": "训练/RL",
  reliability: "可靠性",
  "docs-ci": "文档/CI",
  "project-meta": "项目元信息"
};

export const IMPORTANCE_LABELS: Record<ImportanceLevel, string> = {
  5: "P5 架构级",
  4: "P4 深读",
  3: "P3 关注",
  2: "P2 扫读",
  1: "P1 归档"
};

export const IMPORTANCE_ORDER: ImportanceLevel[] = [5, 4, 3, 2, 1];

export function splitFullName(fullName: string): { owner: string; name: string } {
  const [owner, name] = fullName.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid GitHub repository full name: ${fullName}`);
  }
  return { owner, name };
}
