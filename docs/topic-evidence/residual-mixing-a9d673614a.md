# 混合约束的抽象几何检查

运行 `node model.mjs` 只计算；加 `--write` 保存 `results.json`。标准库，Float64 小矩阵，不使用真实模型权重或 GPU。这里的 row/column 约定是 `y=Ax`，实际源码如果用转置必须先对应再引用。

## 约束是对哪个映射、哪种范数说的

非负 row-stochastic A 让每个输出坐标成为输入坐标的凸组合，所以 `||Ax||∞≤||x||∞`。它不一定保护跨 stream 的 L2：`A=[[1,0],[1,0]]` 把 `[1,0]` 变为 `[1,1]`，L2 放大根号2，总和也改变。它不会凭空产生一个超出输入坐标范围的坐标，但可以重复同一信息。

若 A 还 column-stochastic，则对每行用 Jensen：

`Σ_i (Σ_j A_ij x_j)^2 ≤ Σ_ij A_ij x_j² = Σ_j x_j²`。

因此 exact doubly stochastic 的**固定线性 map**在欧氏范数下不扩张，且保持坐标和。脚本遍历 `[[t,1-t],[1-t,t]]`、t=0…1的17个取值及289个输入，共4,913项检查；这是该2×2族的模型验证，通用结论来自上述代数，不是用有限采样证明任意矩阵。

这没有证明整个残差层的输出范数受同一输入范数约束。即使 A 为 identity，外加常量 branch injection 也会放大输出幅度；但加常量不改变两输入的差，所以这个例子**不反驳扰动 Lipschitz 界**。实际混合系数还可能依赖 x，此时比较两输入时有：

`A(x)x−A(z)z = A(x)(x−z) + (A(x)−A(z))z`。

固定 map 的界不约束第二项，所以不能把它当整个 nonlinear/Jacobian 或训练稳定性证明。

## AttnRes凸组合不等于输入扰动不扩张

抽象例子取 sources `[0,1]` 与 `[x,1]`，score query `[3,0]`，每source按自身RMS打分，epsilon=1e−5。对固定 x，softmax 输出在两source的凸包内；但 x 从1增加1e−5时，source权重也变化，输出差/输入差约1.02034。它区分“给定sources的输出范数界”与“整个动态选择函数的局部敏感度”。非learned checkpoint、非BF16或GPU数值复现，不代表模型存在训练问题。

## 有限迭代并非精确约束

脚本另取正矩阵 `[[1000,1],[1,1]]`，做一轮 row normalize、column normalize，各分母加1e−6；末端column sum接近1，但row sum约0.6684/1.3316。它只是反驳“任何有限交替归一化后都已exact doubly stochastic”。真实mHC的初始化、顺序、迭代次数与dtype要另核对；不能把这一个iteration的误差归给实际20轮kernel，也不能据此估训练质量。

当前材料支持选题时避免过强结论，不是第八篇正文或内容批准。
