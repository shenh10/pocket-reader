# NVIDIA Docs Pocket

自包含的 NVIDIA 文档整理页，适合作为 `my-pocket-reader` 下的一个静态子目录发布。

## 入口

- `index.html`：NVIDIA Docs 入口目录
- `nccl/index.html`：NCCL 专题页
- `nccl/env-tool.html`：NCCL 环境变量工具页别名
- `cuda/index.html`：CUDA Programming Guide 教程速读
- `cuda/programming-guide.html`：CUDA Programming Guide 教程速读
- `cuda/cublas-reference.html`：cuBLAS 速查
- `cuda/ptx-reference.html`：PTX ISA 速查

## 本地预览

```bash
cd /Users/linzhao/Downloads/coding/my-pocket-reader
python3 -m http.server 5175
```

然后打开：

```text
http://127.0.0.1:5175/nvidia-docs/
http://127.0.0.1:5175/nvidia-docs/cuda/programming-guide.html
```

## CUDA 精讲课程

`cuda/blackwell.html` 是中文学习主线，含 17 章：CUDA 基础、内存布局、Streams/Graphs、架构边界、TMA/TMEM/tcgen05、同步、流水线与 Roofline 交互、低精度、CuTe、Ultra/Rubin、编译与实验、LLM 应用及自测。

- `cuda/learning-labs.js`：独立的双缓冲调度与 Roofline 教学模型，无外部依赖。
- `cuda/labs/bandwidth.cu`：可下载的测量实验。编写环境无 NVIDIA GPU/nvcc，尚未实机编译运行；不能把它的逻辑带宽当成 HBM 计数器实测。
- 旧的 Programming Guide、PTX、cuBLAS 检索页继续保留。
- Blackwell/Rubin 来源固定到页面注明的 NVIDIA CUTLASS commit；更新时应同步核对 toolkit/driver/known issues，不能只替换版本号。

静态部署仍由现有 workflow 复制整个 `nvidia-docs/`，无需新增构建依赖。

## Kernel Atlas：Attention 与 MoE 源码深读

`kernels/index.html` 是进阶主入口，基础教程继续作为前置阅读。六篇独立专题（各自固定源码快照）：

- `kernels/paged-decode.html`：FlashInfer SIMT paged decode，页表 / GQA / cp.async / 在线 softmax / split-KV。
- `kernels/blackwell-attention.html`：FlashAttention CuTe SM100，warp 分工 / TMEM 复用 / pipeline / 描述符与预算。
- `kernels/fused-moe.html`：vLLM aligned Triton MoE，SGLang 分支与 FlashInfer grouped FP8 对照。
- `kernels/expert-parallel.html`：DeepEP EPv2，rank 去重 / 布局 / TMA / dispatch-combine / stream 生命周期。

`sources.json` 固定 5 个仓库的独立阅读快照、源码路径、行号与文件 SHA-256；不宣称是最新版本或一套兼容依赖。每篇区分源码事实、CPU 教学模型和待 GPU 验证的性能假设。

验证交互模型：`node nvidia-docs/kernels/lab-checks.mjs`。覆盖 split-softmax、mask/空状态、page addressing、MoE gather/scatter 和 rank payload。没有 GPU benchmark 结果。

### 2026-11-20：后端、测量与双缓冲

- `kernels/execution-path.html`：vLLM / SGLang 分派、旧 FlashInfer plan/run、Autotuner v2 测量与缓存。
- `kernels/fa4-ping-pong.html`：PR #2817 head a93c9a8f 的 S/P 双缓冲、O 依赖、slot/phase 和启用门槛；核对时 PR 尚未合并。
- `kernels/bench-decode-boundaries.py`：可下载的 NVIDIA GPU benchmark；本地仅完成语法与 CLI 检查，未运行 GPU 性能实验。
- `kernels/path-checks.mjs`：`node nvidia-docs/kernels/path-checks.mjs` 检查教学模型。
- `kernels/execution-sources.json`：29 处固定版本引用与阅读/PR 状态。

CPU 数值与源码分支检查通过；本轮浏览器因 macOS 沙箱禁止 Chromium Mach port 启动，未完成视觉验收。
