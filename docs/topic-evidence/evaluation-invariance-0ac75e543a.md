# Attention：固定逻辑分段，改变物理 program 数

材料为 SGLang PR47410 / local id23426，head `86ec68ef5f055fdf4b0781dfafa180c4075b20c9`，base `36d82211fe7374fd03ae3d91c20a8fddea5ad447`。GPT‑6.1 Sol。已保存完整body、3文件inventory/patch、旧inventory deep_dive、3份head和3份base immutable官方源及bytes/hash。旧deep_dive承认diff截断，本轮补读核心完整head函数并将完整cached patch应用到固定base，3文件逐字重建head通过。它们是同一PR前后，不混用作者其他open changes构成完整部署证明。

## 必须先纠正“固定64边界”的说法

此版本没有把逻辑split固定为64 tokens。确定性backend默认环境变量 `SGLANG_TRITON_DECODE_SPLIT_TILE_SIZE=256`，设请求长度L、tile参数T：

- backend给出逻辑split count `S=ceil(L/T)`，预算 `Smax=ceil(max_context_len/T)`。
- stage1和stage2都按 `w=32*ceil(ceil(L/S)/32)` 得到每split实际宽度。
- 逻辑split j覆盖 `[j*w,min((j+1)*w,L))`，空区间不读取/写partial。一般调用也可由scheduler提供S或由forced替代；公式使用同一个S。

所以T是决定count的参数，不是每个split一律256宽的证明。L257、T256时S2、w160，边界是0/160/257，而不是0/256/257。L1500时S6/w256。保持的是**同请求L与S下相同的逻辑分段公式**，它不随batchmate或物理program数改变。32是MIN_BLOCK_KV对齐，BLOCK_N通常32（HIP且Lk≥576时16）是split内dot遍历块；64也可能是物理program数或head维，都不等于本规则。

## 物理调度真正改变了什么

设batch B、head tile数h、设备core数C，P候选为：

`P=max(32,next_power_of_2(ceil(C/(B*h))))`。

只有Smax>32、没有forced split且P<Smax时，stage1 grid第三轴才用P；否则仍按forced或Smax。这个32是保留足够并行program的下限，不是最多32，也不是逻辑token tile。head tile由 `kv_head_num*ceil(kv_group_num/16)` 得到，不能对所有GQA形状都写ceil(query_heads/16)（每KV组独立占完整head tile）。

program p依次处理 `j=p,p+P,p+2P,…<S_i`。每轮都重新初始化FP32 `e_max=-inf,e_sum=0,acc=0`，独立执行该split的QK/online softmax/PV，再写原先 `partial[batch,head,j,:]` 和 `lse[batch,head,j]`。一个CTA处理多个split不表示合成更大split，也没有把前一个split的acc留给下一个。

完成先后与存储位置解耦：不同物理program能乱序结束，但merge仍按逻辑split ID读取相同槽，不以CTA完成次序归约。stride分配对S中所有ID是一一覆盖（唯一余数j%P），CPU模型枚举S1..512、P1/8/32/64/128共2560种验证ownership；这不证明GPU编译数值或性能。

已有 `_rotate_batch` 在HIP不均匀batch时用program的split起始ID旋转request，旋转前后是batch索引置换。它不让同一逻辑split跨请求，也不改变逻辑partition；不将本文扩成XCD负载均衡验证。

## merge不是“只要源码顺序一样就必然逐位”

stage1产生每split归一化vector o_j与LSE l_j。stage2按split ID递增，维护FP32 m/s/a，形式为：

`m'=max(m,l_j); a'=a*exp(m-m')+o_j*exp(l_j-m'); s'=s*exp(m-m')+exp(l_j-m')`。

最后可加入attention sink到分母，输出`a/s*v_scale`，store转换到O dtype。实际split累积内部通常把p cast到V dtype做dot，gfx1250有保留FP32 p/V的既有特殊分支；不能把整个attention说成纯FP32实数计算。

关键是两个不同优化：

1. **只改物理P**，S、逻辑边界、split内算术/存储槽与stage2模式不变。新增测试在各自固定stop设置下比较P1/8/32和每split一个program的输出，用torch.equal检验。
2. **stage2提前停止**：`stop_at_request_splits=True`把constexpr预算上界Smax换成device S_i，跳过空预算尾部。源码仍按同一ID顺序处理有效partial，但注释指出dynamic bound会改变unrolling/reassociation，可能令MLA结果差几个ULP。backend仅在deterministic启用此选项，普通模式保留constexpr；forced split也禁用dynamic end。

因此“batch invariant”“同一stop策略下换P逐位相等”“新旧版本全模式逐位相等”是三个验收命题，不能互相替代。新增测试并未断言stop=False与True直接相等，源码注释更反对这种承诺。动态循环不改数学公式，也可能改机器求值结构。这里没有检查Triton IR/ISA或重现该ULP现象。

## 实质备选与正确性/成本边界

| 方案 | 数值/逻辑分区 | 物理代价与条件 |
|---|---|---|
| 一split一program、grid按Smax | 保留原split和merge策略 | 短请求仍发射很多无工作program；并行度高 |
| 直接减少逻辑S/扩大split | 同一实数softmax目标，但局部归约/舍入边界变化 | 更少partial和program；不能仅凭实数等式承诺batch invariance或旧位级输出 |
| 固定逻辑S、物理P跨split循环 | 保留每split边界、独立FP32partial与原slot | 减少发射，仍保留Smax scratch；一个program串行多个split，长请求并行度可能降低 |
| 再将merge上界改为S_i | 有效partial顺序相同，编译求值可能不同 | 减少空预算迭代/条件检查，数值兼容策略需单独验收 |

设S_i是每请求逻辑count，A_i是其中非空区间数，B/h/Dv固定。非forced路径：

- 旧stage1 launched programs=`B*h*Smax`，新=`B*h*(P或Smax)`。有工作的物理program约 `h*Σmin(P,A_i)`（只适用于每请求非空split为连续前缀），逻辑split计算仍为`h*ΣA_i`；不能用launch减少比当FLOPs下降比。
- P小于S_i时，每program至多ceil(S_i/P)轮；Q可能每轮重新load，KV逻辑payload和split写入数没有因P减小而减少。真正cache事务/吞吐未测。
- stage2 program数仍B*query_heads，循环上界从Smax到S_i减少的是空尾部检查。旧代码空split有if保护，不能说旧merge读取/累加了所有未初始化尾部。
- FP32 scratch仍为 `4*B*query_heads*Smax*(Dv+1)` 字节，主要buffer形状 `[B,Hq,Smax,Dv]` 与 `[B,Hq,Smax]` 不改。B64/Hq64/Smax512/Dv64仅这两项为520MiB；不是本优化已省520MiB，也不含output/KV/allocator padding。

数值例：B64、h4、C256、Smax512，P32，stage1发射131072→8192（16倍减少），但每请求只用S6时，真正非空split计算总量仍64*4*6=1536；新grid仍有很多无workprogram。另一边B1/h1/C256/Smax256得P候选256、触发fallback，仍256program，避免小batch被统一压成32。P规则是覆盖设备的启发式，不证明最优occupancy或latency。

### 最小可区分反例

CPU标量binary32模型在均匀logits下比较v=`[1e8,1,-1e8,1]`：一个逻辑split按顺序sum后除4得到0.25；先分成两组各sum/mean再合并得到0。实数目标一样、舍入不同，说明“扩大split来减CTA”与“同split改owner”不是可任意交换的变换。

保持两组partial与slot不变，只让两组以不同先后完成，再按原slot merge，模型都得到0。它证伪逻辑partition不重要的推理，但**不是上游tl.dot/exp/GPU attention的复现**，也不把该极端值差异当模型实际精度数据。代码与完整输出见split-model.py/model-results.json。

## 真实范围与作者证据

改physical loop的是grouped GQA/MQA/MLA stage1；MHA非grouped stage1保持原grid。新的stage2 stop选项可通过共同decode入口传给normal/grouped，故不能概括成“整个MHA路径完全未变”。forced split、预算≤32不改stage1。Lean是另一实现；backend在deterministic强制禁Lean，本文不据此证明Lean所有路径或其他attention backend的确定性。

MLA tuned path遇到 `_keep_scheduler_splits` 时保留scheduler的count，并选batch-free几何，源码明确num_warps也影响FP32 accumulation；不能只固定S而任意切warp geometry后承诺不变。普通nonforced MLA可受P优化，普通默认GQA预算8保持旧stage1；所以这不是仅deterministic编译才能执行的kernel。

新测试为BF16输入/输出、GQA64/8、D64、budget128、长度1/255/1500/2049/8000/20000、sinks。每个stop策略内比较P1/8/32和原grid；另一测试核对6种core/batch/head规则。它不是全dtype、全硬件、全MLA、所有graph/PD组合证明。

body报告MI350X/ROCm7.2.4实测，以及多个模型端到端与normal-mode对照；这些是作者报告而非本地实验，且端到端说明包含其他open deterministic changes，两边相同，不能归为本PR独立完整支持证明。body还列出extend测试在有无改动都失败；没有将CI绿色泛化为目标kernel全部正确。本专题可以不依赖任何作者吞吐数字成立。

## 交付范围

当前仅研究材料与CPU模型，未改DB、旧稿、专题metadata。补充来源收据/连续anchors支持真实公式和scope，不能把文件/摘录数量当深度指标。建议主文围绕“数值求值图与执行所有权分离”组织；checkpointed state/通信等其他案例应另证，不能把本PR所有规则无条件迁移。
