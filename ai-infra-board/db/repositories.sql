INSERT INTO repositories
  (full_name, owner, name, display_name, homepage_url, description, importance_weight)
VALUES
  (
    'vllm-project/vllm',
    'vllm-project',
    'vllm',
    'vLLM',
    'https://github.com/vllm-project/vllm',
    'Open-source high-throughput LLM serving engine.',
    5
  ),
  (
    'sgl-project/sglang',
    'sgl-project',
    'sglang',
    'SGLang',
    'https://github.com/sgl-project/sglang',
    'Serving framework and runtime for fast LLM/VLM inference.',
    5
  ),
  (
    'THUDM/slime',
    'THUDM',
    'slime',
    'slime',
    'https://github.com/THUDM/slime',
    'Post-training framework for LLM RL and scaling experiments.',
    4
  ),
  (
    'flashinfer-ai/flashinfer',
    'flashinfer-ai',
    'flashinfer',
    'FlashInfer',
    'https://github.com/flashinfer-ai/flashinfer',
    'Kernel library for LLM serving and attention workloads.',
    5
  ),
  (
    'deepseek-ai/DeepGEMM',
    'deepseek-ai',
    'DeepGEMM',
    'DeepGEMM',
    'https://github.com/deepseek-ai/DeepGEMM',
    'DeepSeek GEMM kernels for FP8 and dense compute paths.',
    5
  ),
  (
    'deepseek-ai/DeepEP',
    'deepseek-ai',
    'DeepEP',
    'DeepEP',
    'https://github.com/deepseek-ai/DeepEP',
    'Expert-parallel communication library for MoE inference/training.',
    5
  ),
  (
    'deepseek-ai/FlashMLA',
    'deepseek-ai',
    'FlashMLA',
    'FlashMLA',
    'https://github.com/deepseek-ai/FlashMLA',
    'MLA-focused attention kernels from DeepSeek.',
    5
  ),
  (
    'fla-org/flash-linear-attention',
    'fla-org',
    'flash-linear-attention',
    'FLA',
    'https://github.com/fla-org/flash-linear-attention',
    'Efficient linear attention and sequence modeling kernels.',
    4
  ),
  (
    'Dao-AILab/flash-attention',
    'Dao-AILab',
    'flash-attention',
    'FlashAttention',
    'https://github.com/Dao-AILab/flash-attention',
    'Reference implementation for fast exact attention kernels.',
    5
  )
ON CONFLICT (full_name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  homepage_url = EXCLUDED.homepage_url,
  description = EXCLUDED.description,
  importance_weight = EXCLUDED.importance_weight,
  updated_at = now();
