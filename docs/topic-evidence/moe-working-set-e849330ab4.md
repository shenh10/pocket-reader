# MoE 工作集的窄消费者契约：容量不是有效行，dummy 不是 token

建议作为 U/M/C 主文的一节消费者契约案例，而非按两个修复组织独立长文。前文若用 U 表示命中的专家集合大小、M 表示真实 route 行数、C 表示执行/分配容量，本节负责说明：**不能把 C 中存在的每一行纳入 M，也不能把为了执行而造出的专家工作项纳入语义 U。** 请由主文统一 U/M/C 记号；这两项材料本身不提供完整权重工作集/吞吐模型。

## 固定 shape 如何保留真实工作量

vLLM #54109 head `649d72af5264b9476364e9af8fbfc5bf5dacef06`：`PaddedStandard` 保持二维 `(capacity_rows, hidden)`，把活跃性作为独立输入契约。DeepEP v2 graph/decode 路径 `do_expand=False, do_cpu_sync=False`，无法为了拿精确 host shape 同步 GPU。最坏接收容量由 rank 数与 `num_max_tokens_per_rank` 决定；后者从 DP 已知 batch 上界经过 SP ceil 分片并取 2 的幂，限制 JIT shape 种类。这不是固定所有 workload 一个全局最大 shape，也不等于把真实 recv 行数读回 host。

真实 recv 前沿留在 GPU 上的 `psum_recv_per_rank` 中，其末元素是有效前缀行数。globalize kernel 在设备读取该数，把 `row >= num_recv` 的 top-k slots 强制改成 `-1`，同时将合法 local IDs 转成 global IDs。某些模块可推迟 globalize 并传 `rank_expert_offset`；不能说所有路径都立即运行同一 sanitizer。`ExpertTokensMetadata` 可以存在而 `expert_num_tokens=None`；DeepGEMM 必须检查字段，缺 counts 时依据 topk 重新计数，不能以对象非空当作精确有效工作量已知。

decode 的激活尾部明确允许未初始化；prefill expanded 路径使用 CPU counts 与另一布局/对齐策略。此调查没有读取 DeepEP 外部库实现，不把 producer 返回注释作为证明 padding gap 的逐地址实际写入。已有 vLLM 类 docstring 仍说 decode padding rows zeroed，和 enum、receiver 的明确 UNINITIALIZED 注释不一致；主文应以实际消费者契约为准，避免承诺零填充。PR body 中列举的支持专家也比 head patch 旧：该 head 已包括 Triton、NVFP4、MXFP4 BF16 等 pad-aware 声明；不能照搬 body 的“仅 mxfp8 支持”等枚举作为当前真值。

format 检查方向是 `expert_format.is_superset(prepare_format)`。Pad-aware expert 接受精确 Standard 作为无 padding 特例；Standard-only 不能反向消费 padded。BatchedExperts 仍为不同布局。这个类型表达的是消费者可处理的有效性条件，不保证物理计算必然跳过 padding。

## topk=-1 不是所有消费者的万能隔离

若每行计算完全局部，未选 route 可以 skip 或 compute-then-discard；有效输出不受 padding 影响，并不能区分这两种实现。PR 的 NaN-poison 测试明确承认它测的是隔离正确性，不能以 bit-identical 结果推算节省 FLOPs。

但 tensor-wide 动态量化尺度会跨行归约：`s=max(abs(X))/qmax`。即使 GEMM 后面严守 topk=-1，padding 也可能先污染所有有效行共用的 s。该 head 的真实修复在 receiver 中先 `masked_amax_scale(..., num_valid=psum[-1:])`，仅在无 CPU counts 的 decode 分支且 `act_scale_is_tensor_wide(a1_scale)` 为真时使用。后者限定无静态 scale 的 native FP8/INT8 per-tensor scheme；per-token/block 局部尺度和静态尺度不是同一个跨行风险。Triton 第二层 activation scale 则通过 `row_valid=topk_ids.view(-1)>=0` 隔离路由空洞；batched producer 可使用每专家有效前缀界限。

mask 在加载 X 前就应用，padding 不参与 absmax；并非先对垃圾求归约再把最终 padding 输出乘零。全空有效集也不应从未初始化尾部决定尺度，kernel 有 eps 下界。更一般的原则是每个下游消费者都要声明自己的依赖域：routing、量化归约、GEMM、finalize，不能只审查主 GEMM。

反例 `counterexamples.py`：真实值 `[1,2]`，inactive tail 为有限值 `10^6`。INT8 对称量化用有效行尺度得到 `[64,127]`，若归约整个容量则真实值变成 `[0,0]`。这里用有限毒值避免依赖某个 GPU max 对 NaN 的具体传播规则。这是标量算术模型，不是上游 kernel 复现。

## 空 rank 的执行非空与语义空必须分开

FlashInfer #9514 head `b0dd4e522462b4325ad20c5005bf280926e642af` 面对另一种背离：调用本身 `num_rows>0`，但本 EP rank 没有任何路由 token。特定 grouped GEMM 执行路径需要至少一行，因此给最后一个 local expert 一行零输入。它复制 `expert_first_token_offset` 到独立的 `gemm_expert_first_token_offset`；原末 offset 为零时才清零输入行并将 GEMM 末 offset 设为1。两个 GEMM 都消费这个 compute-only offsets。

真实 guards 是 `use_deepseek_fp8_block_scale && ep_size>1 && !enable_alltoall && num_rows>0`。非空 rank 仍复制 offsets 但不补行；全调用零行不在补丁覆盖范围，没有 permuted buffer 可写。这里 `!enable_alltoall` 指该实现 all-gather/reduce-scatter 路径，不代表“没有任何通信”。不能泛化到其他量化/GEMM、单 rank、all-to-all 或所有 zero-token 调用。

隔离的关键不是零输入，而是原始 `token_selected_experts`、路由反置换元数据不变。对应 no-alltoall finalizer 遍历原始 num_rows，累加器初始为零，对不在本 rank 专家范围的 selected expert 先 continue，再读取任何专家结果。全 rank 无本地 route 就没有贡献；dummy 不获得语义 route。BlockScaleFC2 确实调用该 finalizer；虽然它的 offsets 参数来自 compute-only 分支，实际 no-filling 以外的 gather/scatter finalizer不靠这个末 offset 枚举输出，而靠原始 topk 语义。

“输入零所以最终输出零”不是可靠论证：抽象合法消费者 `f(x)=2x+3` 在零输入仍输出3；实际代码也存在 bias 参数，因此无需以某配置无 bias 作为通用不变量。CPU 反例明确不是声称某 FP8 kernel 配置支持这个 affine 函数，而是证伪零输入蕴含零输出的推理。正确隔离后 contribution 为0；若把 dummy 伪造为一个真实 route，则错误贡献为3。即使纯线性算术给零，NaN/非有限 scale、epilogue 与新算子扩展也不应被用来替代路由契约。

## 主文中如何比较而不写补丁复盘

可以围绕三种设计比较：host 同步获取精确 shape；保留容量 shape、以 GPU 有效性元数据驱动所有消费者；为底层 kernel 合法域补 dummy 但保留语义路由。第一种减少容量处理但引入 host/device 同步与图捕获限制；第二种以更多容量和mask/metadata维护换图与通信流水；第三种以少量非语义 compute 换底层合法输入。它们处理不同层，dummy 不是 mask 的替代，mask 也不让 M=0 的底层 kernel 自动可用。

可计费维度：C 行容量的字节占用、M 行真实激活的处理与归约、按每专家 alignment 放大的执行行数、额外mask/offset-copy kernel启动及 metadata 字节。FlashInfer新增 offsets workspace 为 `(local_experts+1)*8` 字节（workspace allocator 实际对齐另计），一次256线程block helper；主文不能把PR“few microseconds”叙述当本地/该SM90路径已测结果。dummy 会把语义空 rank 的 compute 行数从0变1，不能把这个额外 expert 当成真实权重工作集 U 的业务增长。没有本地吞吐、GPU内存流量或硬件数值测量。

适合接在 U/M/C/对齐容量模型之后，用窄反例说明“计算工作集被缩小之后，消费者必须仍只观察语义工作集”。不宜为这两个小案例另造大而全架构专题；它们提供的是更大工作集模型的正确性边界。

## 阅读与验证范围

- 两份 cache 完整 body、完整 file list 已读取并保存；全部49+2文件的 patch 已保存，已阅读全部核心生产分支、oracle/format改动、主要 poison tests。部分大段测试构造输出曾截断，不能声称逐字符终审全部51份patch；不以此材料证明整PR或全部后端正确性。
- immutable raw 共9文件，收据含URL、revision、完整sha256、行数；按上述问题读取核心连续函数/分支和相关测试，并未通读所有49文件完整内容。
- 已核验 receiver/globalize/scale、DeepGEMM计数metadata、dummy helper/guard、两个GEMM参数、BlockScaleFC2→finalize→本地expert guard链。未审完整外部DeepEP/DeepGEMM kernel实现、未证明各种后端物理跳过padding。
- `anchors.json` 保存18段100–700字符连续摘录与行号/哈希；source receipts证明取材版本，不充当深度证据。`counterexamples.py` 标准库CPU算术可运行，输出见counterexample-results.json。没有GPU、DB、线上内容修改。
