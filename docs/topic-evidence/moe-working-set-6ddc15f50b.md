# 路由集合、分组与固定容量的独立 CPU 模型

运行 `node model.mjs` 只计算并输出；加 `--write` 更新 `results.json`。标准库，无 GPU 或模型依赖。

## 定义和适用范围

本模型每 token 恰有 k 个不同且有效的专家 ID，N 个 token、E 个本地候选专家。M=Nk，m_e 为命中专家 e 的路由行数，U 为 m_e>0 的专家数，C=min(M,E)。实际系统中的无效 ID/padding 要另设有效路由计数，不能直接把 M 当成有效工作。

只在这个模型下，sum(m_e)=M 且 U≤C。它不模拟 EP 分发、量化误差、专家 GEMM、图捕获、物理 allocator、GPU 事务或性能。

## 均匀参照

若不同 token 独立，每个 token 在 E 个专家中均匀选 k 个且不重复，则单个专家没有被选中的概率为 `(1-k/E)^N`，所以：

`E[U] = E * (1 - (1-k/E)^N)`。

不要求一个 token 内各专家选择相互独立；那里本来就无放回。该公式不是实际 router 的经验分布。代码穷举 E=1…5、k=0…E、N=0…4 的全部合法路由矩阵，共26,344项、100个期望值配置，逐项核对边界并与解析均值比较。

一般独立 token、专家边际命中概率为 p_e 时，可改写为 `sum_e [1-(1-p_e)^N]`。跨 token 相关时，单靠 p_e 不足以应用这个幂次公式。

## 同 U 不同分组

先有一个 N8/k2/E16 的小反例。另一个反例使用 grouped decode 案例 advertised 的路由维度 N8/k10/E512：

- 前4个 token 选择0…9，后4个选择10…19：20个专家各4行。
- 前7个 token 选择0…9，最后1个选择10…19：10个专家各7行，另10个各1行。

两者均 M80/U20/C80，每 token 无重复。若组容量 g=4，组数 G=sum ceil(m_e/g) 分别为20、30。逻辑组槽率 M/(gG) 为1、2/3；若实际 token 方向 tile 是8列，则有效列率 M/(8G) 为1/2、1/3。前者与后者不是同一个计量；都不是实际 GPU 利用率或吞吐预测。该路由维度与形状匹配，不等于已运行上游 kernel。

## 字节计费

独立合成专家有3HI个参数（gate/up/down），H2048/I512；BF16展开为6MiB。假定MXFP4每值4bit、每32值一个1B scale，则packed值1.5MiB，加scale0.09375MiB。未计bias、padding、对齐或重复cache访问。

按M80/U20/C80预算，distinct输出scratch仍480MiB，实际展开输出的逻辑字节120MiB，packed逻辑输入31.875MiB。它不是 FlashInfer BF16 grouped 实现使用 OCP 反量化的证明，两个真实案例的backend/dtype不同；本段只是统一计费模型。

## 无效槽反例

有效值`[1,2]`后接一个NaN未初始化槽：先全capacity求max得NaN，之后再屏蔽无效输出无法恢复有效scale。`0*NaN`仍为NaN。它说明需要先限制归约读域，不能把最终乘零当作未读取；实际 masked_amax、route skip 与 GEMM专用offset的源证据另存于相邻研究目录。
