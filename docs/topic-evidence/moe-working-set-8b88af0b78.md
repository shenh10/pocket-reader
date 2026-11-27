# PR7194：distinct expert 集合与 grouped GEMM 是两种复用

固定 FlashInfer PR7194 / local id4474，head `a806b9007933325314cca8f1bc1b2e1079a5ee41`，base `316faec37a4706a2ecc7d46265087f8190b40baa`。生成/分析 GPT‑6.1 Sol。完整body、11文件inventory、cached全部patch另存，11份head文件从官方immutable raw获取；源码字节数与SHA256见收据，100–700字符连续摘录见anchors。

## 可作为专题的技术命题

对top-k MoE，R个有效route的专家直方图为m_e，U=|{e:m_e>0}|，Σm_e=R。**U决定一个潜在的distinct-expert物化集合；m_e的分布与分组上限决定同一份权重能喂给多少token/route列的GEMM。** 前者是权重表示/解量化/驻留粒度，后者是已存在权重在计算tile内的复用，不能把两个节省比例连乘成实际性能。

本PR是BF16权重上的后者：FC1/FC2直接读取FMA同一份prepared权重，没有本PR新增的“先按U解量化一次”阶段，也没有一份offline interleaved副本。它从路线现场找同expert，TMA加载该expert权重tile一次，在N=8的矩阵列上计算至多g个route。若一个专家有m_e>g个route，会拆成ceil(m_e/g)组并重复加载其权重tiles；不能说“整个调用每expert只加载一次”。物理HBM/L2事务还受cache影响，逻辑CTA载入次数不是HBM读取次数。

若与另一篇distinct-expert解量化机制做对照，可以单独建两个账本：物化量近似U×weight_bytes、materialization成本U×dequant_cost（须另外源码证明）；这里active GEMM组数G_g=Σceil(m_e/g)，组内权重逻辑载入近似G_g×weight_bytes。是否两阶段相连、是否共用物化buffer以及生命周期都需另取证，本PR不能证明。

## 实际group discovery、路由与owner

route_members.py把ids展成原token-major/slot-major route序列。对候选leader位置r：

1. 32lane分chunks ballot比较所有route是否同expert；popc得到本expert在r之前出现次数rank。
2. 只有rank%g==0返回非空members；否则该CTA跳过projection。
3. 从leader起按原route位置升序找接下来至多g个同expert，成员不足以-1填充。没有CPU排序，也没有全局compact/reorder kernel。

同一kernel的grid z仍是所有R_total=T×top_k slots，x是输出tile；所以**所有slot×输出tile CTA都会发射并做validity/发现判定**。非leader CTA虽不执行GEMM，发现代价仍存在。若有Q个输出tile，现场比较工作可粗略记O(Q×R_valid×R_total)，实际以warp ballot做32元素并行，不能把这个复杂度直接当执行时间。FC1与FC2各再发现一次，没有共享persistent group table。

有效leader从route_ids[bidz]选同一expert的权重；FC1激活输入索引members[j]//top_k，FC2激活输入索引members[j]，输出始终写回原members[j]行。重复expert来自不同token时复用权重但各自读对应激活；若同token有重复route，则仍是两个route成员，并非去重后只算一次输出。上游benchmark专门保证每token内distinct，使其也满足比较backend的contract；不能把该比较合同泛化为所有原生TC测试数据。

invalid expert先检查并给本route输出写0；combine先检查live ID，才读score/partial，故无效padding即使score为NaN/Inf也不贡献。combine对每token按slot从0到k−1依次FP32 separate multiply/add，packed narrow模式先将score round到BF16再转FP32。group内部重排没有改变最终slot顺序。FC1激活后写typed intermediate，FC2写typed route output；FP32 accumulator不表示全局保存FP32 projection scratch。没有证明与FMA或其他backend bitwise相等。

## Tile几何与admission

两架构逻辑CTA GEMM的(M,N,Ktile)=(64,8,64或128)。这里**M是权重输出坐标，N才是route列**，与常见将token写成GEMM M轴的讲法转置，不能把source变量名错对应。

- SwiGLU FC1把32个up和32个gate输出坐标合在M64；原权重up/gate各取一个32行切片，shared的gate来自swizzled layout slice，不是简单row×K字节偏移。FC1有效输出I，输出tile数I/32，reduction维H。
- FC2 M64输出hidden坐标，输出tile数H/64，reduction维I。
- N固定8，g∈{2,4,8}只是members最大数；缺成员填零，不把实际MMA变成N=g。g2即使满组，理想有效route列占比也仅2/8。SM120用(16,8,16) warp MMA，4warps沿输出M组成64；Hopper用WGMMA。
- Hopper stage可2/4/8，Ktile64/128。SM120 K128禁止8stage（至多4）；K64可2/4/8。主循环stage再用前需要相应consumer完成：Hopper WGMMA wait，SM120 ldmatrix/MMA前后CTA sync。此处未编译核对PTX/SASS。

公开advertised tuning admission比内部execute可接收的条件更窄：BF16 input/weight/output、default SwiGLU、H2048/I512/k10、T4或T8、finalize=true、SM90或SM120。

| 架构/T | 新增tactics (g,stages,Ktile) |
|---|---|
| Hopper T4 | (2,2/4/8,128) |
| Hopper T8 | (2,2/4/8,64) |
| SM120 T4 | (4,4,64), (2,2,128) |
| SM120 T8 | (8,2,128), (4,2,64), (2,2,64), (2,2,128) |

原16 FMA候选和untuned FMA default保留。内部runtime还检查T≤8、k≤32、H/I对齐128，可测试BF16/FP16及非finalized等更广组合；这不扩大已advertised的性能admission。runtime的route values不进compile cache，live tensors/stream每调用绑定，warmup是graph capture前要求。

## 用m_e直方图区分同U的工作负载

histogram-model.py构造**admitted形状**T8/k10/H2048/I512，E512、R80、U20，每token内没有重复expert：

- A：20个expert各4条route（[4]×20）。
- B：10个expert各7条route、另10个各1条（[7]×10+[1]×10）。

A让4个token选expert0..9、另4个选10..19；B让7个token选0..9、另1个选10..19。每token行和仍为10，m_e≤T=8，矩阵合法。

| g | A的G | B的G | A/B有效g容量 R/(gG) | A/B固定N8列占比 R/(8G) |
|---|---:|---:|---|---|
| 2 | 40 | 50 | 1 / 0.8 | 0.25 / 0.20 |
| 4 | 20 | 30 | 1 / 2/3 | 0.50 / 1/3 |
| 8 | 20 | 20 | 0.50 / 0.50 | 0.50 / 0.50 |

SM120 T8的g4是实际候选之一。相同U和R下，A/B的g4 GEMM active组相差1.5倍；distinct-expert物化规模却相同。**这两种比例是组容量/矩阵列的几何指标，不是整GPU利用率。** 对g8，两者G和总体有效列比一样，也不证明延迟相同：成员分布、expert地址/缓存、调度与并发仍可能不同。

## 条件化成本账本，而不是直接预测速度

令W=3HI为BF16 SwiGLU两个投影的权重元素数（FC1 2IH，FC2 HI），F_useful=6RHI FLOPs（不计activation/combine）。若忽略跨CTA cache复用、且每active组遍历相同权重tiles：

- route-wise逻辑权重载入参照：R×W；本实现grouped CTA逻辑载入：G_g×W。比值G_g/R，不是U/R，且不是FMA实测DRAM流量。
- 固定N8 MMA操作几何：F_nominal≈6×8×G_g×HI；useful/nominal=R/(8G_g)。不声称填零列在硬件会被稀疏跳过。
- 总projection launched CTA：R_total×Q；active GEMM CTA：G_g×Q，Q=I/32+H/64=48。本例都launch3840个，g4 active为960对1440。invalid/非leader仍有开销。
- typed中间和route输出payload仍随R×I与R×H增长；grouping没有把每route不同的激活和结果变成每expert一份。

若额外假设三类服务充分重叠、发现和其余开销串行暴露，一个仅用于列出待测项的示意模型为 `time ≈ max(weight_service(G_g, addresses, cache), mma_service(8G_g,H,I), activation_and_output_service(R)) + discovery + stage/launch/combine overhead`。真实服务可能部分重叠、争用，开销也可能被隐藏；同一G的不同地址也会不同。没有有效带宽/吞吐/latency参数，不能由上式给微秒预测，也不把它当无条件上下界。大的g可能减少G但增加padding，并减少可独立active CTA；stages与Ktile改变流水线、shared/register容量，不能只按平均m_e自动选winner。

为后续专题最有区分力的实验应固定R/U/权重dtype和token形状，只换m_e分布及expert地址，然后冻结候选分别测warm/cold：记录G、尾组、launched/active CTA、L2/DRAM数据与MMA关键路径。该实验未执行。

## 作者证据与当前head边界

body报告H100 T4/T8使用当前head a806b9007/seed7203；SM120表明确pre-score-fix seed7191，性能rerun被中断。不得把SM120 1.48×/1.37×标为当前head实测。所有GPU数字都是作者报告，本次没有取得原始benchmark JSON或复现。

当前body的H100结果也只代表同checkpoint/shape/指定共享路由/缓存条件下的complete routed-expert GPU interval：排除prepare、host enqueue、router network、shared experts、EP通信和serving吞吐。baseline是backend的compound candidate+heuristic与FMA候选，非笛卡尔穷举；作者先选择冻结，再ABBA/CUPTI测量。body还明确disjoint favor FMA、partial routes会受expert地址影响、SM120 T8共享cold接近持平，不能根据T4/T8一刀切dispatch。

benchmark源码会检查CUPTI≥13（不允许silent CUDA-event fallback）、保存source hashes、候选/冻结选择/原始samples/reference error；它是可复现脚本，不等于结果已经在本机生成。测试覆盖live route变化、独立pointer/stream/graph、typed边界及invalid nonfinite score，本次只读没有执行。head body测试175pass等同样标为作者报告。

## 可交付的下一专题切口与剩余问题

建议命题：“相同distinct专家数，为什么算起来不一样？” 从U的物化账本走向m_e、G_g与固定N列几何，再解释为何缓存与CTA发现成本让reuse高也不自动赢。可交互参数为T/k、合法路由矩阵、g、固定N与expert地址标签；观察U、直方图、G、尾组、有效列占比和逻辑字节，**不输出硬件速度**。

还缺distinct-expert物化PR的真实生产/消费链才能连接两机制；缺raw作者benchmark JSON/当前SM120计时；缺实际CuTe lowering/硬件流量。这里不是新专题成稿/发布批准，未改数据库、旧63文、既有专题或metadata。
