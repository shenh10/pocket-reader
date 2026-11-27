# LatentMoE：压缩的表示空间不等于可交换的执行顺序

固定 Kimi-K3 checkpoint `c7945ea0`、vLLM `24c72a76`。本记录只增加既有专题的可用分析材料，不修改文章或全局状态。取得实际 `latent_moe_runner.py` 与基础 `moe_runner.py` 的固定源，发现原模型注释与实现有重要差异。

## 1. 先恢复真实的归约边界

记每rank routed latent partial为 z_r，shared hidden partial为 s_r，U为从latent到hidden的复制权重。启用latent norm时，目标语义是：

`y = U RMSNorm(sum_r z_r) + sum_r s_r`。

这里column-vector写法的U对应代码 `latent @ weight.T`。RMSNorm在聚合的latent上执行。`U(sum z)=sum(Uz)`在线性实数模型成立；但 `RMSNorm(sum z)`通常不等于`sum RMSNorm(z)`，所以不能通过“升维只是线性层”把整个输出变换任意移到局部partial上。

基础runner明确默认输出transform不与TP sum交换，只有显式声明 `reduce_commutative=True` 才豁免提前归约。条件还检查非SP、TP或EP>1且combine输出尚未reduced。Kimi transform没有该opt-out，且其 `forward` 先norm、再up-proj。[基础判断](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/model_executor/layers/fused_moe/runner/moe_runner.py#L453)、[Kimi transform](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/kimi_k3/nvidia/model.py#L307)

标量/小向量实验采用epsilon1e−5，z0=[1,0]、z1=[0,2]，全局RMSNorm约[0.63245,1.26491]，分别norm再相加约[1.41420,1.41421]。再乘同一U仍不同。`results.json`保存完整值；这只是非交换性的反例，不是实际BF16 kernel误差评测。

## 2. Portable path实际是两个collectives，不是注释中的一次concat

`model.py`复制up-proj处的注释、`_use_fused_path` 的注释写着 concat latent/shared并合成一次all-reduce。但同revision实际portable tier1、tier2没有这个concat：

| 路径 | latent | up-proj | shared/最终输出 |
|---|---|---|---|
| tier1 ALLREDUCE_OVERLAP | all-reduce后norm（可融合原语，或fallback显式AR→norm） | 每rank用完整U计算全部hidden | shared单独all-reduce，和up-proj在aux流重叠，最后相加 |
| tier2 COLUMN_PARALLEL | 同样先全局latent归约并norm | 每rank只计算U的一个hidden row-shard | 将routed shard加进该rank shared partial的对应列，再最终all-reduce整个shared缓冲 |
| tier0 TAIL_FUSION | 委派给专门CuTe tail op | 专门op处理 | 返回output_is_reduced=True；本次没有读其内部，不能借portable推collective数 |

[tier1](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/kimi_k3/nvidia/latent_moe_runner.py#L237)、[tier2](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/kimi_k3/nvidia/latent_moe_runner.py#L273)、[归约+norm](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/kimi_k3/nvidia/latent_moe_runner.py#L385)

这个差异应保留：**注释描述的“一次concat”不能作为固定实现的实际通信次数。** 文章若采用，需以函数体为准。tier2的最后all-reduce由基础 `_maybe_reduce_final_output` 完成；若`skip_final_all_reduce`，该helper会提前返回，因此代数重建结论明确要求最终sum确实执行。[最终归约helper](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/model_executor/layers/fused_moe/runner/moe_runner.py#L483)

## 3. 同一语义可以交换“重复计算”与“重叠机会”

tier1先得到每rank相同的全局normalized latent，随后每rank都做完整H×L projection。tier2也保留这个非线性边界，却只让rank r计算自己的hidden坐标集合I_r：

`temporary_r = s_r + embed_(I_r)(U_(I_r) norm(sum z))`。

最后对temporary求sum，因各I_r不重叠且覆盖hidden轴，每个routed坐标只注入一次，共享partial则全部累加，恢复相同的实数目标。这不是把norm放到partial前，而是在norm之后沿输出维切分线性计算。12个小尺寸构造已验证这个等式。

令一批N token，H=7168、L=3584，忽略bias、norm与padding，只计算up-proj。tier1每rank约2NHL FLOPs；tier2约2NHL/P。单token分别为51,380,224 FLOPs；TP8分片为6,422,528，TP16为3,211,264。**权重对象仍为ReplicatedLinear，读子view不等于释放其余权重存储。** 这里是算术操作数计数，不是实测延迟或带宽。

tier1可把shared AR和完整up-proj重叠，tier2先计算分片、注入shared之后才做最终AR，放弃这部分重叠。一个解释模型是：

`tier1 tail ≈ latentAR+norm + max(full_projection, sharedAR) + add`；
`tier2 tail ≈ latentAR+norm + sharded_projection + finalAR`。

这些项没有本地测量值；不能只按P倍FLOPs减少就说tier2快P倍。源码按token阈值和流开关选tier1/2，正对应小batch重叠与大batch减少重复投影的不同目标。

## 4. latent减半，哪些payload并没有减半

假设有一个用于计量的“两份hidden-width归约”比较项，元素数为2H；latent+shared的两项输入总元素为L+H。L=H/2时，`(L+H)/(2H)=0.75`，总逻辑输入仅少25%，并非50%。BF16每token是21504B对照28672B。这个two-H比较项只是单位一致的预算参照；在norm开启时不能直接把它叫做可交换后的等价实现。

实际tier1/2仍是两个collective；具体wire字节要加上算法、rank数、拓扑和协议。896选16的router仍读H维hidden，shared分支也读H维；down与up projection新增计算，不能把整个MoE、EP dispatch+combine或网络量一起标成减半。此处还没有追DeepGemmMegaMoE的分发协议，因此不把latent维数直接转换为实际EP节省。

## 5. 条件与未核对项

上述specialized路径的 `_use_fused_path` 要求TP>1、有shared expert、combine输出未归约、非sequence-parallel、up-proj为UnquantizedLinearMethod。否则走基础runner，并不适用上表的分派承诺。tier0还要求NVIDIA SM100 family与TP8/16，并按op最大token数选用；代码拒绝该融合模式下的DBO/ubatching和sleep。**这些是固定runner的条件，不是全模型/全部EP后端支持矩阵。**

MegaMoE在model中另有分支：shared先单独计算，KimiRoutedOutputTransform再合并；仅unquantized up-proj可走 `residual.addmm_` beta-add，quantized分支是projection之后再add。本次没有把该分支算进portabletier1/2。

本次只读固定源码与配置，并运行CPU实数代数/成本计数。未检查base runner所有输入ownership、specializedtail内部、collective kernel、参数加载完整性、GPU舍入或性能。实际norm的FP32累加/归约与BF16写回顺序可能不同，代数相等不是bitwise相等。来源hash与连续锚点见收据和`source-anchors.json`。
