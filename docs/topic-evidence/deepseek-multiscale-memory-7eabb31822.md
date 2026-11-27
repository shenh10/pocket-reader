# V4-Flash packed KV：按实际访问组比较布局

范围固定 vLLM `24c72a76b96bf8d73190a4bb66d47dc8c3eb2134`。本记录解释 writer、prefill gather 与布局的关系，供既有专题增加设计取舍。它不修改正文，不声称所有 backend、allocator 或 FlashMLA decode 都使用相同指令，也没有 GPU/编译产物验证。新增的实际 CuTe gather 原件、固定 URL 与 SHA256 在本目录；其他原件沿用架构基线。

## 1. 首先区分实际 CuTe gather 与 Triton 参考路径

`cache_utils.py:dequantize_and_gather_k_cache` 在 `has_cutedsl()` 时转到 `nvidia/ops/dequant_gather_k_cutedsl.py` 并立即返回；后面才是 Triton fallback。只审 Triton 的 `tl.arange` 不能代表已审实际 CUDA reader 的 lane 访问。新取的固定源将这一缺口补上。[dispatch](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/common/ops/cache_utils.py#L520)

## 2. 实际 CuTe gather：一 warp 负责一 stored state

该 kernel 每 CTA 4 warps、每 warp 4-stage prefetch。对给定请求，初始 state 位置为 `worker_id*4+warp_id`，下一次前进 `num_workers*4`；实际物理 page 仍经 block table 查找，不能把逻辑连续位置直接当物理连续页。

对 V4-Flash，`fp8_dim=448, group_size=64`，所以 data_dim=576、scale_bytes=8。每 warp 的 `load_g2s` 明确设置128-bit cp.async copy atom，并分三组从 global 搬入该 warp 的 shared stage：

| 源级访问组 | lane 与字节范围 | 声明宽度 |
|---|---|---|
| 首512B数据 | lanes0…31，各读 row+16×lane | 每lane16B |
| 尾64B数据 | lanes0…3，各读 row+512+16×lane | 每lane16B |
| scales | lane4（idx=36），复制这一 state 的完整8B scale row | 一个64-bit copy atom |

这是源代码可明确重建的访问组，不是从数组总字节数反推 instruction count。[loader](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/nvidia/ops/dequant_gather_k_cutedsl.py#L74)、[warp 与 shared stage](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/nvidia/ops/dequant_gather_k_cutedsl.py#L124)

后续转换从 shared 以8B块取 FP8，转换成连续16B BF16输出。scale0 的 shared 索引是 `floor(lane/8)`，scale1 是 `floor((lane+32)/8)`；每8个 lane 复用同一 scale 字节。最后8个 lane 的第二份结果最终用 BF16 tail 覆盖，不使用 padding scale 作为真实量化组。Global 已经以一次8B stage copy 搬入 scales，不能把64个 FP8 channel 共用一个 scale 写成64次 global 访存。[shared scale 与转换](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/nvidia/ops/dequant_gather_k_cutedsl.py#L211)、[BF16 tail 覆盖](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/nvidia/ops/dequant_gather_k_cutedsl.py#L251)

128-bit copy atom表达源级复制宽度；最终 SASS、事务拆分、cache命中、不同copy组之间的复用及持续带宽没有在本轮观测。`LoadCacheMode.GLOBAL` 也不构成本轮所有缓存行为的测量证据。

## 3. 两种 compressed writer 的线程划分不能混在一起

### C128 的独立 norm/RoPE/store

`SparseAttnNormRopeStoreKernel` 为512维使用256线程、8warps。每线程负责两个相邻 channel：

- warps0…6各覆盖一个64-channel NoPE量化组，lane l 发一个 Uint16 pair，地址 `value_base + 64*warp + 2*l`；每 warp 合起来连续64B。
- warp7做64个RoPE维，lane l 发一个 Uint32 BF16 pair，地址 `value_base+448+4*l`；合起来连续128B。
- 每个 NoPE warp 的 lane0 写一个 UE8M0 scale；warp0/lane0另外写第7槽padding=0。因此 scale全行最终8B，但不是一个warp集中一次写出8B。

store 的2B/4B来自 packed类型和下标；不在未看编译产物时进一步宣称全部 global store 指令保持此宽度。[地址与 thread mapping](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/nvidia/ops/sparse_attn_compress_cutedsl.py#L1481)、[NoPE/RoPE stores](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/nvidia/ops/sparse_attn_compress_cutedsl.py#L1576)

### C4 的 fused compress/norm/RoPE/store

C4 fused kernel 用每线程8个channel，因此一个64-channel组只有8 lanes，每 warp 4组、整个CTA只有2warps/64线程。它从 FP32 value/score partial state 读取时声明128-bit universal copy atom，每lane分两次取4个FP32；这些读取面向raw compressor state，与最终 packed KV 的访问不是同一数据格式。

输出NoPE的每个lane循环4个 Uint16 pair。对固定pair j，组内地址是 `value_base+64*group+8*group_lane+2*j`，单次源级访问组有空洞；四个pair最终填满64B。Compiler可能合并邻接写入，不能把源级4个pair机械计成四轮相同硬件事务。Scale由每组 `group_lane==0` 写出，RoPE组写BF16 pairs。[分组](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/nvidia/ops/sparse_attn_compress_cutedsl.py#L109)、[128-bit raw-state copy](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/nvidia/ops/sparse_attn_compress_cutedsl.py#L200)、[pair与scale写入](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/nvidia/ops/sparse_attn_compress_cutedsl.py#L362)

### Triton writer/gather 的可证明范围

参考 writer 是每token一个program：每个NoPE组使用 `tl.arange(0,64)`，做absmax、FP8转换和64个byte值的store；随后写一个scalar scale，尾部BF16按16元素块处理。Triton gather对每个请求启动128 workers，在每个program中循环处理其分配的state；各NoPE组读取64个byte值和一个scalar scale，再将64个BF16写到输出；RoPE按16个BF16元素块直接复制。这里的64/16是源级元素向量长度，不能据此断言最后是何种warp/lane划分或一条64B/32B机器访存指令。[参考writer](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/common/ops/cache_utils.py#L111)、[Triton gather](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/common/ops/cache_utils.py#L323)

## 4. 后置scale保留了什么对齐条件

设物理page首地址P同时按32B对齐。V4格式的数据行起点为P+576t，576是16与32的倍数；64-channel FP8 group的64B边界、448B后的RoPE尾部，以及16B gather chunks都保持相应对齐。Scales在P+576N+8t，每行8B自然对齐。

反事实逐行交错 `[576B data | 8B scales]` 的row stride=584。其row base相对16B边界在0/8之间交替，相对32B在0/8/16/24循环。它仍保持C128写出的2B/4B自然对齐，但奇数row不能原样满足实际gather的16B源copy对齐要求。PTX的cp.async说明将地址约束指向自然访问大小对齐规则；相关原文从已有官方快照提取保存在本目录。需要改变复制策略，或对每条record加padding：stride592保持16B、stride608保持32B。不能将一个未适配的584-stride reader直接用于“公平性能比较”。[PTX地址对齐](https://docs.nvidia.com/cuda/parallel-thread-execution/index.html#addresses-as-operands)

N64时，现有packed格式按页576B对齐需37440B。反事实592-stride的原始record覆盖量为37888B，608-stride为38912B；若公平比较时继续采用相同576B page-size quantum，分别应再round up为38016B与39168B。原始record覆盖量不能与已对齐page大小混称；其他页对齐规则属于另一个设计维度。这些是几何容量比较，不是作者报告的实测显存/延迟。[当前page-size对齐](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/v1/kv_cache_interface.py#L704)

这里的P对齐是明确前提。Actual gather warmup声明 `assumed_align=32`，C128 store warmup声明16；576页大小对齐使最小页跨度为32的倍数。但runtime view还有allocation offset、layer stride和block stride，不能只见 `alignment=576` 就宣称已经证明全部allocation模式的page首地址都对齐。读取绑定实现可见这些stride/offset的组合，但本轮未穷举规划器输出。[gather编译期契约](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/nvidia/ops/dequant_gather_k_cutedsl.py#L371)、[view binding](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/v1/kv_cache_interface.py#L449)

## 5. 32B bin 模型要区分访问组求和与唯一覆盖

只把地址放进32B bins，可得到一个静态几何模型：当前SoA-like格式的一行被实际gather的512B/64B/8B三组分别覆盖16/2/1个bins。反事实584 stride的非零32B residue，若用同样范围去计地址，分别覆盖17/3/1个bins；但这时有些16B copy已经不符合对齐，需要改写reader。

这个“每组bins数之和”不是HBM事务数。AoS同一record的数据与scale共享最后一个bin，整条record唯一覆盖仍为19个bins；当前格式数据18个bins加远处scale1个bin也为19。四个相邻当前格式state可共享一个scale bin，而整个page两种布局的内容总量相同。不同warp、不同copy组、重复命中是否产生新的流量，需要执行和cache证据。把17+3+1直接叫21次HBM读会把重复覆盖重复计费。

## 6. 不能推广成“scale必须后置”

同一固定CuTe gather还显式有另一分支：无BF16 tail时，data_stride=data_dim+scale_bytes，scale紧跟每行data。源码将它用于V4.1的512维全FP8、32元素scale组：512+16=528B，每行仍16B对齐。这是一个具体反例，说明布局要同时服从数据宽度、scale组宽度和reader复制形状，后置scale不是普遍更优规则。这里仅引用该format分支，不把V4.1机制拼进V4-Flash，也不声明完整V4.1部署支持。[两种记录分区](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/nvidia/ops/dequant_gather_k_cutedsl.py#L27)

## 7. 当前 prefill 先物化完整压缩历史，再让 query 选择

固定 `flashmla.py:_forward_prefill` 的compressed gather使用 `seq_lens[chunk_start:chunk_end] // compress_ratio`，`gather_lens=None`、offset=0。实际CuTe gather在None时把gather_len设为seq_len，因此为每个请求本chunk物化全部C_i个压缩历史位置，而不是只读某query的至多512个C4选择项。C_i对应本chunk所需的请求范围，不表示这些位置对每个较早query都因果可见；后面仍有query选择/可见性约束。之后才combine top-k/SWA索引，并将BF16 workspace传入sparse attention。[完整compressed gather](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/nvidia/flashmla.py#L310)、[索引选择与稀疏消费](https://github.com/vllm-project/vllm/blob/24c72a76b96bf8d73190a4bb66d47dc8c3eb2134/vllm/models/deepseek_v4/nvidia/flashmla.py#L361)

这是该prefill分支的具体设计：先为同请求多个query建立共享BF16历史，再由不同索引读取。它在query较多或选择集重叠时可以摊销gather/dequant物化；不能从“最终每query top-k≤512”直接推出“整个prefill只搬512个compressed records”。也不能将此结论推广到decode的paged调用。

可用来对照的备选是每query只物化所选K项。若C为一个请求的compressed history长、Qp为其prefill query数，且各query均有K个有效候选，单纯物化记录数是现路径C，对照QpK。若改成选择并集去重，记录数可为U=|union S(q)|，但还要建立重映射/去重计划与query索引，不是白得的优化。以上都是相同BF16物化目标下的逻辑payload模型，不包含下游attention读取、cache复用或调度开销。

另外，实际处理数与workspace容量不要混算。跨一个request chunk的gather处理数为sum C_i；源码workspace `(chunk_size,chunk_M,head_dim)` 的capacity由chunk规划、各请求最大长度、SWA和padding共同决定，并不等于每一项都被本次compressed gather写满。

## 未闭合项

没有检查目标GPU的PTX/SASS、实际cp.async lowering、global/store合并、cache policy效果、带宽、延迟或GPU数值。没有审外部FlashMLA decode内部reader、SWA fused CUDA writer、所有allocator页基址组合。当前结论是固定源码支持的访问组/表示/对齐契约，以及明确条件下的反事实几何比较。
