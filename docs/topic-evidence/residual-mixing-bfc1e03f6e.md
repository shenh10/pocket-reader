# mHC：固定宽度的残差传输，不能简写为“跨深度attention”

本轮仅候选可行性与来源/数学研究，没有第8篇正文或上线批准。固定 vLLM `24c72a76b96bf8d73190a4bb66d47dc8c3eb2134`，配置 DeepSeek-V4-Flash `60d8d70770c6776ff598c94bb586a859a38244f1`。复用baseline manifest核对model/config哈希，新增两份同revision的mHC wrapper/kernel immutable源。没有继续网络抓取；没有GPU、完整模型、checkpoint系数或训练稳定性实验。

## 可以成立的新学习命题

建议将“**历史检索轴与固定状态宽度是两种残差自由度；约束残差传输矩阵，只控制其中一条路径**”作为研究命题。

mHC保持每token的n条H维stream，当前sublayer从这n条状态生成动态pre/post/residual系数，再把一个H维attention或FFN结果送回n条stream。n=4来自此配置；它不在每层显式存储一个按深度增长的历史列表。AttnRes若由另一研究确认维护跨深度block历史，则两者可对照“显式可寻址的过去表示”与“固定nH状态中的逐层折叠”，不是两个attention kernel实现，也没有证据证明互相可替代或已组合。

与已有DeepSeek多尺度memory稿不重复：这里轴是**模型深度上的残差流/系数约束**，不是token历史的KV压缩/页布局。与KDA恢复稿不重复：这里没有递推接受前缀回退。是否值得合写需等AttnRes一侧独立源把历史原子、生命周期、读写/合并语义证明清楚；当前mHC一侧足够支持窄机制对照，单靠“都有mixing”不足以定第8篇。

## 真实三映射与方向

令每token状态 X∈R^(n×H)，flatten r∈R^(nH)。源码 `fn` 是 `(n²+2n,nH)` FP32权重，先投影并用整nH输入的RMS尺度归一化：

`z = W r / sqrt(sum(r²)/(nH)+rms_eps)`。

这是controller的RMS规范化（不带独立norm weight），不应和随后喂给F的H维RMSNorm混淆。三个组使用各自learned scalar scale与base：

`a_i = sigmoid(s_pre*z_i + b_i) + eps_pre`；
`b_j = 2*sigmoid(s_post*z_(n+j) + base_(n+j))`；
`L_ij = s_res*z_(2n+i*n+j) + base_(2n+i*n+j)`，`C=finite_sinkhorn(L)`。

三个映射职责分别是：

1. pre collapse：`u_h=Σ_i a_i X_(i,h)`，再经实现规定的BF16/RMSNorm路径送入普通H维sublayer `F`。
2. post injection：将F输出 `v_h` 乘每个目标stream的b_j。
3. residual transport：混合旧stream，合成 `Y_(j,h)=Σ_i C_(i,j) X_(i,h)+b_j*v_h`。

上述“当前X生成a，再collapse当前X”的时间关系只对应本轮model.py实际调用的standard `mhc_pre_tilelang` / `mhc_fused_post_pre_tilelang`，不是所有wrapper变体的统一运行时序。wrapper另有 `mhc_pre_delayed_tilelang` 与 `mhc_fused_post_pre_delayed_tilelang`：它们保存新计算的next_pre_mix，却可以用传入的上一sublayer pre_mix collapse；无旧系数且save_pre_mix时kernel选择stream0，而非当前新系数。**canonical三映射的代数角色，与delayed系数carry的实际生效时刻必须分开。** 本轮未追完整delayed caller链/训练语义，也不声明delayed与standard数值等价；不能把本节公式冒充每个可能layer_input都使用当前X的新a。

**存储矩阵第一轴是input stream i、第二轴是output stream j**。若把X画成行stream，Y=C^T X+b v^T，而不是CX。kernel明确 `a_local[i_hci,i_hco]` 与 `cm[k,j]`。pre是1×n映射，post是n×1映射，只有residual是n×n。model先attn pre→F(attn)，然后fused post+next FFN pre→F(ffn)，下一层同样先完成上一sublayer的post。post可以延迟融合，但这不把pre/post改成同一组系数。

pre不是softmax也不要求和为1：零logits时Σa≈n/2+n*eps，n4约2.000004。post范围在(0,2)，也没有sum1条件。不能把整个Y叫作对旧streams与F的凸组合。aux draft路径有plain stream mean，但最终head是另一个learned sigmoid collapse再norm，不是所有输出统一取4-stream平均。

## 有限Sinkhorn到底约束了什么

此版本不是精确的Birkhoff投影oracle。实际步骤：

1. 每行稳定softmax，然后**每元素加eps**。
2. 每列除以 `column_sum+eps`。
3. 再重复19次“每行除以row_sum+eps，再每列除以column_sum+eps”。

配置n=4、repeat20、eps=1e-6。有限轮不保证两边margin同时到1；分母eps使即使理想均匀logits的最后column sums也略小于1。最后一次是column normalization，故给定有限非负数时每个column sum为 `s/(s+eps)<1`，而row sums没有同样即时界。实际FP32舍入与下溢可改变最后几位；非finite输入更不能谈概率矩阵。with_norm路径还以RMS非NaN条件跳过剩余迭代，只因为其整行结果已NaN，而不是修复NaN。

`model.py` 以相同初始化、eps顺序、20轮的**CPU Python double（binary64）标量模型**构造有限合成logits：

```text
[20,-20,-20,0]
[20,-20,-20,20]
[-20,0,0,-20]
[-20,20,0,20]
```

它得到最大row-sum误差约0.0759259，最后column sums接近1但小于1。此为**合成controller logits**，没有读取真实checkpoint W/输入，既非真实模型分布，也非FP32 TileLang或GPU复现。它足以证伪“20轮+eps在数学上必然精确双随机”的推断，不能用此误差估模型训练或生成质量。结果保存results.json。

方向重要：若C精确双随机，C^T X的每个目标stream是旧stream凸组合，固定C可得若干标准非扩张结论；此实现最后列归一且eps>0，在实数有限算法里每目标系数和略小于1，更接近subconvex。**这些仅是冻结系数、单独residual线性项的性质。** C(X)是输入依赖controller，比较两个不同输入时还多了系数变化项；pre/post injection和F另有增益，不能由“混合矩阵近双随机”推出整个非线性网络Lipschitz≤1、梯度不爆炸或训练稳定性。

一个更强的结构反例甚至不需要有限误差：取精确双随机C=I、a_i=1/2、b_j=1、F(u)=u，四条输入stream都为1，则residual还是1，pre得到2，每输出为3。n4、zero controller logits恰给近似这些pre/post系数；实际eps只把pre再略增。此例是标量抽象合法结构，不声称checkpoint恰学到该组权重。它直接反对“凸residual transport因此全block非扩张”。CPU另用cycle permutation检查input0应转到output1，防止公式转置混淆。

## 4-stream成本与dtype不应被“小矩阵”掩盖

n4/H4096的multi-stream residual为16384 BF16元素=32768B/token，普通H维residual为8192B/token，**这个activation张量是4倍**。它不是KV history，也不按sequence context额外增长；在prefill token批次和PP边界上均存在此宽状态。四streams不意味attention/FFN本体都4次运行：pre collapse后F输入仍H维。

每sublayer的controller输出维 `n²+2n=24`，FP32 W大小24×16384=393216参数=1.5MiB；attention/FFN各自一组，所以每decoder layer两组controller W约3MiB，另有base/scales。名义稠密controller约 `2*nH*(n²+2n)=786432 FLOPs/token/sublayer`，不含RMS、sigmoid、Sinkhorn、混合与F。pre collapse约nH个乘加，residual transport约n²H、post injection约nH；Sinkhorn每轮O(n²)，但小矩阵归约/启动可能有固定成本。不能把整个开销按20×4×4就结束。

weights/scales/base及pre/post/C为FP32，residual/F输出/layer_input为BF16；mix sums、controller partials和RMS用FP32中间。controller可走DeepGEMM TF32 helper或TileLang fallback，**FP32存储不等于每项都完整FP32乘法精度**。本轮未展开tf32 helper的内部乘法/lowering。

存在shape-dependent fused post/pre路径：小token把旧X与F合成new_r后，直接FP32用于下一controller投影与平方和，同时写BF16 residual；分离路径先写BF16 residual再重读投影，不能未取证就宣称两者逐位同值。with_norm collapse路径也先把weighted sum暂存BF16，normalization平方和是否来自round前值取决于save_pre_mix分支；模型本次标准入口不是delayed variant。要讨论数值一致性须指定路径，不能因为数学式相同就忽略rounding点。

fused kernel可以减少额外读写/launch，但仍保留multi-stream residual输出和后续消费；不要只依据Python fused函数名声称4stream activation全部不落HBM。此研究没有精确物理DRAM流量、register/shared、吞吐或训练开销测量。

## 实现范围与后续可行性结论

- 本文公式绑定NVIDIA `model.py` 的standard mHC接口；wrapper中还有delayed pre、broadcast first layer、shape-specific fused/separate、head collapse等变体。没有把所有mHC实现/所有硬件/后端统一为一个精确位级算法。
- 第一层2D embedding有broadcast专用pre，后续保持nstreams；PP中间传宽状态；最终learnedhead collapse；aux draft的stream mean是另一消费者。不能把固定4streams误画成4个深度历史KV槽。
- 明确阅读：model参数615–665、调用715–810、PP/输出933–1054、wrapper prenorm与standard pre/fused dispatch、kernel coefficient/Sinkhorn/pre-collapse/post/fused/head连续段。两新增raw共3017行只读相关分支，没有逐行审完全部kernel或性能调度器；未读训练梯度、完整checkpoint、其他平台模型实现。
- 收据含2份新immutable raw+2份复用源；18段100–700字符连续anchors可复查方向/迭代/精度。CPU模型只验证上述有限标量算法与数学反例，不证明GPU或网络稳定性。

建议：保留为候选。若AttnRes一侧可以证明block-history增长/压缩边界，并给出“相同表示混合但无法恢复被折叠历史”的可区分例子，这两个机制值得作为有张力的对照；否则mHC应单独作为“受约束残差传输”材料，不为共同关键词强合一篇。
