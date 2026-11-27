# KDA 恢复的数值契约：保存得少，何时仍能保存同一种语义

本记录用于补强既有 KDA 专题的方案比较。它没有修改正文、扩大模型支持声明或增加一篇已发布文章。固定 vLLM `24c72a76b96bf8d73190a4bb66d47dc8c3eb2134` 源码与 CPU 解释模型分开描述。

## 1. 快照写入不等于把快照再读回递推

“逐步保存完整状态”至少有两种不同数值政策：

| 政策 | 下一 token 从哪里接着算 | 接受前缀保存什么 |
|---|---|---|
| 窗口内保留 FP32，旁写 BF16 snapshots | 上一步仍驻留的 FP32 matrix | 对应 prefix 的一次 BF16 舍入 |
| 每 token BF16 persist **并重新读回** | 已舍入的 BF16 matrix | 累积了每步反馈舍入的 matrix |
| 基准状态 + FP32 corrections + key/gate records | verify 算法自己的内部数值路径 | 重建后一次最终 BF16 写回 |

旁写 snapshot 不必改变下一步的 FP32 state。不能把“snapshot 存储是 BF16”直接推成“每 token 都以 BF16 反馈”，然后据此宣称 RecoverSSM 比 stock 更精确或不等价。

固定通用 Triton verify 把 state 读到 FP32，在整个 `SPEC_QUERY_LEN` loop 内保留 FP32 state，写 FP32 corrections 与输入类型 key/raw gate；其代码并不要求窗口内每 token 写回再读 BF16。CuTe 路径则以同一 BF16 `S0` 构造 probes、用 BF16 high/low MMA 做投影，再在 FP32 三角 solve 中生成 correction。Commit 重新归一化 recorded raw key、重算 gate 累计量，以 FP32 fold 后打包 BF16。因此即使持久层和 records 尺寸一致，算术求值图也不是同一个。

对应固定源位置：

- [Triton recurrent 更新](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/kimi_k3/nvidia/ops/recoverssm.py#L48)：column decay、correction、rank-one update。
- [窗口内 FP32 state](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/kimi_k3/nvidia/ops/recoverssm.py#L141)：load 转 FP32 后循环，`state = tl.where(...updated_state...)`。
- [CuTe probe high/low](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/kimi_k3/nvidia/recoverssm/cutedsl/verify.py#L151)、[FP32 三角解](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/kimi_k3/nvidia/recoverssm/cutedsl/verify.py#L500)。
- [Commit 重算 normalized key 与 scaled coefficients](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/kimi_k3/nvidia/recoverssm/cutedsl/commit.py#L218)、[最终 fold 与 BF16 pack](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/kimi_k3/nvidia/recoverssm/cutedsl/commit.py#L253)。

每条本地连续摘录、line range 与 SHA256 在 `source-anchors.json`，原件在上一级 `sources-math/`。获取原件不表示已验证目标 GPU 的 lowering。

## 2. 一个能区分政策的标量反例

目的只是在最小系统中隔离舍入位置。选 K=V=1、S0=1、raw key=1，再按 `1/sqrt(1+1e-6)` 归一化；β=1/64、log gate=−0.0001，value 使用 BF16 可表示的1.203125。所有 token 重复这组输入，Q=8。

| 接受输入 m | Float64 递推 | FP32 window 后一次 BF16 | FP32 records fold 后一次 BF16 | 假设每 token BF16 persist 并重读 |
|---:|---:|---:|---:|---:|
| 1 | 1.003075402 | 1 | 1 | 1 |
| 2 | 1.006102448 | 1.0078125 | 1.0078125 | 1 |
| 4 | 1.012014501 | 1.015625 | 1.015625 | 1 |
| 8 | 1.023291003 | 1.0234375 | 1.0234375 | 1 |

在1附近，BF16 相邻数间距为0.0078125，半间距0.00390625。每次从1出发的净更新约0.0030754，小于半间距，所以逐 token 持久化再重读会一直回到1。窗口保留较高精度则能累计更新，最后再舍入。这个反例说明**完整状态与恢复记录的存储比较，必须先固定反馈舍入政策**；它不是在证明实际 stock verify 采用最后一列的政策，也不是证明 CuTe 的模型精度更高。

本实验的 FP32 record corrections 来自顺序 FP32 recurrence，刻意复用同一记录以隔离 fold 顺序。实际 CuTe 的 high/low probes、triangular coefficients、MMA 和归约顺序不在这列里。

## 3. 实数递推的状态误差不会凭空指数放大，但局部舍入仍重要

对同一组精确输入，令 Dt=diag(exp(gt))，则更新可写成：

`S_t = S_(t−1) Dt (I − βt kt ktᵀ) + βt vt ktᵀ`。

所以两个 state 的差异在齐次部分右乘 `At = Dt(I−βt ktktᵀ)`。若实数模型中 `||kt||₂≤1`、β∈[0,1]、各 channel 的 gate≤0，那么 `I−βktktᵀ` 的谱值落在[0,1]，且 `||Dt||₂=max_c exp(gt,c)≤1`。因此：

`||At||₂ ≤ max_c exp(gt,c) ≤ 1`。

若把本地算术扰动记为 ηt，可得 Frobenius 范数上界：

`||E_m||F ≤ ||E_0||F ∏(t=1…m) dmax_t + Σ(j=1…m) ||ηj||F ∏(t=j+1…m) dmax_t`。

这是同输入的实数 recurrence 加性扰动模型。Near-zero gates 让旧误差保留更久；较强衰减抑制较早的状态误差。但它没有限制 coefficient 重算、输入量化或三角 solve 的全部局部误差，更没有保证小 state 的相对误差。不同方法仍可能在 BF16 rounding midpoint 两侧，输出不同的最终 bit pattern。

这也避免了一个过宽结论：“递推层一定会把任何舍入误差指数放大”。本 recurrence 在上述条件下的齐次 state operator 是非扩张的。实际有限精度 normalized key 可能略偏离理想单位球，真实 kernel 的数值分析还需处理这些偏差。

## 4. 有限扫参说明什么，不说明什么

可复现命令：

`node work/knowledge-topics/drafts/kda-state-layout/tradeoff-research/precision-experiment.mjs`

模型包括 D=1/4/8、Q=1…8、四档 negative-gate 强度、普通幅度与大基准/小初始 residual 两种构造、四个固定 seed，逐一比较所有 m=1…Q。Float64 顺序 recurrence 与代数 fold 最大绝对差约2.84e−14。FP32 window 后最终 BF16与同 corrections 的 FP32 fold，在两个被枚举的条目上出现不同最终 BF16；这实际是**一个唯一输入前缀**（D=8、seed19、m=7）在Q7/Q8中重复出现，不能当作独立样本频率。

该 witness 的 matrix[6,5]，Float64参考为−2.921504773e−6，一次最终BF16的FP32 window为−2.935528755e−6，FP32 record fold为−2.950429916e−6，二者差约1.49e−8。它说明不同FP32算术路径也可能落到不同的BF16格点；不能据绝对小差推广出任务质量结论。完整输入和prefix保存在results。

其余大量匹配同样有用：这个实验没有证明 record fold 普遍破坏数值，也没有由实数等式推断 bitwise 一致。两者是不同的问题。`hypothetical...` 字段的 mismatch 只比较明确假设的逐 token BF16 re-read 政策，不应写成 upstream kernel 的失败次数。

BF16 转换通过正负 tie-to-even、subnormal、zero、Infinity/NaN 共12个边界 fixture。脚本先舍入到 FP32，再按 BF16 nearest-even；它不使用简单截断。

**未模拟的内容集中列在这里：** GPU FMA/parallel reduction 的实际求值顺序、BF16 high/low Tensor Core MMA、CuTe 三角 solve、raw gate sigmoid/convolution 的近似、stochastic rounding、FTZ、真实任务/模型质量与任何硬件性能。所有结果是 CPU 构造实验，不是精度测评或 GPU 复现。
