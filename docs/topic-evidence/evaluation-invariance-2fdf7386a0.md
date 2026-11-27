# kda.bf16.c16：将执行切分从数值算法中移出去

固定 FlashInfer PR9294 / inventory21267，head `62115374aeca472bbf82dab9c5fc994becd5c18b`，base `a6234a606b56437359e2d5addd89b43871b8118d`。归档 body、23文件list/patch已保存，inventory该条 `deep_dive` **为null**，没有虚构旧深读。新取11份immutable raw，见receipts；从核心函数、实际dispatch、提交与测试核对机制，未全读大型prefill kernel全部约万行。没有GPU、Lean或端到端实验。

## 技术命题：相同递推公式与FP32状态仍不等于同一数值函数

该模式要解决的是同一序列在prefill、逐token decode、batch组成/slot/布局变化下输出不同位的问题。普通decode用rank-1递推，prefill用16行chunk算法；即使两者都保存FP32状态，矩阵乘分解、归约k顺序、gate/norm标量链、tensorcore初始accumulator、BF16/FP16中间舍入仍可不同。FP32提高精度不消除算术程序差异。

prefill本身也有另一条批次相关变化：原auto以 `n_seq*heads*2 <= sm_count` 选择两kernel decomp，否则persistent engine。两route数学等价但不bitwise同值。实现的选择不是找更大容差，而是定义一个数值class：**native BT16 engine的有序操作链**。它固定每序列canonical chunk原点，并让decode重现该算法当前行的值。其他用户auto选择规则不改；只有class的 `_pinned` 用context-local `force_route('engine')` 走同一prefill路线。

因此“batch invariant”不只是atomic不乱序；还必须去掉会因邻居数量改变的算法选择。固定算法牺牲某些小batch更快的decomp，不是免费提升吞吐。body小序列prefill慢于auto就与此取舍相关；本次未复现作者时间。

## canonical相位、边界状态与open-row缓存

以序列已消费p个token、下一行位置p计：

`b(p)=16*floor(p/16)`，`phase=p mod16`。

pool公开FP32矩阵保存 `S_b`，并不是所有时刻都等于“消费p行后的完整递推状态”。0≤phase≤15的未提交贡献存在pool旁的open-chunk中间量。第16行（phase15）完成才将 `S_(b+16)` 写入FP32 pool，刷新BF16镜像、stamp并归零count。

`ExactPool` 按(slot,head)保存：BF16边界镜像、FP32 gate-decay prefix、BF16与FP32 decayed-inverse key rows、BF16 rhs/update、BF16 L矩阵、device count/stamp。它缓存的是同一chunk算法的中间结果，不是保存16个完整state快照，也不重复从头运行全部历史。spec中的“replay partial chunk”是定义项，实际step kernel复用缓存行求本行。

FP32/BF16提交点必须分清：

- Begin从FP32 boundary取BF16镜像，作为tensorcore state projection的乘法操作数。
- 当前行state_k/state_q以BF16边界矩阵和BF16 decay Q/K做MMA，FP32 accumulation；rhs明确在BF16链上计算 `bf16(beta)*(v-bf16(state_k))`。
- L、inverse与update有各自明确的转换，不能概括成“整个chunk全FP32”。inverse内部也有经FP16舍入的步骤（header `add_pair`注释/函数），这同样属于数值class。
- chunk完成时以FP32边界carry乘decay作起始accumulator，再加BF16 update与restore key的tensorcore乘积；结果写FP32 pool，并单独round为下个chunk的BF16镜像。不是每token写BF16全state再作为下次递推输入。

decode kernel使用寄存器 `mma.sync`，prefill使用tcgen05；相同数学形状并不自动证明两指令bitwise相等。源码意图保持operands、k-order、starting accumulator和显式舍入一致，实际跨实现等位仍依赖作者stage探针/设备测试。JIT禁fast-math且 `-fmad=false`，防止编译器将原本分开的scalar运算隐式收缩；不能凭这两个flag声称任意工具链都同位。

## mid-chunk resume：API不是任意切分都等价

1. 从序列起点运行whole prefill，内部按canonical16行分块；末尾不足16行由span step留下open caches，随后单token decode能从这些缓存继续。
2. 重复prefill切分：除最后一段外，切点必须是序列canonical16边界。例0→1024→2064→2071，随后decode可行；这里2071仅是最后prefill尾部，不是可再启动fresh prefill的任意边界。
3. 普通 `recurrent_kda([B,T>1])` 是fresh prefill，将slot当前FP32 pool视作新boundary，**丢弃旧open rows**。若已经处理19token，pool仍是S16，之后把token19…交给新的prefill会从S16重启，遗漏token16…18对未来的贡献；这不属于所承诺chunk invariance。
4. 要对open chunk追加多token，使用内部模块入口 `recurrent_kda_batch_invariant_extend`。T<32用一次span launch，count在GPU上读取，跨16边界仍逐段提交；T≥32按当前count拆 head→whole→tail，head/span补到边界、whole用pinned prefill、tail/span继续。显式slot需host检查，只有default slots的short extend可捕获graph。不能把所有multi-token调用都写成无host同步。

一个仅FP32 pool矩阵也不足以迁移midchunk序列：必须保留open-row缓存、phase与同一数值class，或从canonical boundary重算。API pool identity按storage/offset/shape；同extent view共享缓存，不表示复制pool数据到另一个storage会自动获得open-row缓存。调度/迁移系统应将这种状态合同当作数值语义的一部分。

## 与其他方案的实质比较

| 选择 | 得到什么 | 付出与失效点 |
|---|---|---|
| auto prefill +普通rank1 decode | 各形状可选更快算法；无该class side-cache | batch变化可切算法；FP32本身不统一运算顺序 |
| 任意调用边界都提交当前state/开新chunk | 接口容易分段 | chunk原点与舍入点随调用划分，不能保持canonical数值项 |
| canonical16 + partial replay | 定义上同一prefix/chunk函数 | 每token重算最多16行，定义简单但额外工作；不是实际GPU实现 |
| canonical16 +缓存row中间量 | 同一函数的增量placement；一次step launch | side-cache、phase/lifecycle、p15重提交成本；需硬件验证两种MMA placement等位 |

性能应按phase看而非只测phase0。普通15行主要读BF16 boundary与row caches；第16行还要读FP32 carry、写FP32 boundary与BF16镜像。混合phase batch可能几乎每launch都有完成chunk的CTA，关键路径不能由“每序列1/16慢步”直接平均。可用服务模型 `mean=(sum phase0…15 times)/16` 描述同步phase流，但混合phase、占用/访存争用需另量。本次不从作者byte或时间表推出本地吞吐。

这不是已有 RecoverSSM恢复/容量稿的续写。旧稿取vLLM revision `24c72a76b96bf8d73190a4bb66d47dc8c3eb2134`，命题是投机接受前缀恢复、快照/恢复记录/重算与容量；本篇FlashInfer62115374的命题是固定数值算法与跨路径一致性。这里class显式拒绝 `num_spec_tokens`、`num_accepted_tokens`和checkpoint等，不能说已接入RecoverSSM或给已有恢复路径提供bitwise证明。两文只能在“状态表示影响后续计算”层作知识cross-link。

## 保证边界与证据分层

- R1 repeat、R2 batch/slot/order不变、R4 prefill/chunked/decode一致是作者在该class的有限输入支持域内的声明；R3任意配置空间不声明。same_bits只比较同序列输入、initial boundary state、同canonical原点及合法续接。changing batch不包含改变序列prefix、模型gate参数或任意重初始化phase。
- 数值输入要求finite。非有限值在whole chunk算法可从chunk首行传播，逐行decode只能从其出现行传播，因此chunk内prefix agreement不能扩到NaN/Inf。API不逐元素检查全部finite，不代表非finite输入获得保证。
- 声明/作者测试架构仅SM100/103/107，BF16 q/k/v/g/beta、FP32池、D128、equal H/HV与特定head transport支持；head规则为multiple8或1…10/12，不泛化SM90/120、GQA、任意dtype或任意head数。参数gate/norm/beta fused合同缺失会typed error，不能silent fallback。
- fingerprint含prefill/step源码、launcher、build flags与安装CuTeDSL版本，因此跨软件环境不应只匹配字符串类名。作者报告三SM上同位，不能将其扩成跨任意硬件和compiler bitwise保证；本次没有重编译或检查SASS。
- Lean将chunk step当opaque、假设deterministic/per-sequence与prefix causality，证明replay-row与prefill-row及16提交算术；cached GPU step等于replay是外部硬件假设，不是Lean检查mma lowering。
- stamp只比较每head前8个FP32值，不是完整state identity；slot重用到相同prefix值（尤其短请求后重置零）需要显式reset。duplicate decode slots是调用者错误；decode不做host唯一性检测，越界slot返回NaN而不写其他状态。不要把数值不变性当作任意lifecycle错误自愈。

已读测试关键范围：279–363 prefill/decode与合法chunk切点、448–543 graph/缓存惯性/非零初态、543–703 extend/显式reset、988–1030 negative controls、1143–1245 head/batch/segment。测试源码存在same_bits断言及负对照，作者结果不等于本地执行。未执行GPU、Lean、cross-process hash或性能表；没有raw作者benchmark结果文件。

完整body、全filelist/patch保存但没有将23文件全部逐行审计；API/spec/pool、decode关键投影/提交、prefill route选择及tests已核对。新增源码获取/摘录hash仅证明来源完整性，不证明机制深度或hardware equality。
