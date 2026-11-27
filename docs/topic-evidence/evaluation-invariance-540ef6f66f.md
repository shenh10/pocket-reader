# 逻辑分段与物理program的CPU模型

`node model.mjs`仅计算并打印；`--write`更新`results.json`。标准库，不使用GPU、PyTorch或模型。

## 明确算术而非宿主默认精度

模型每次加法均`Math.fround`，输入也先转换binary32。`[2^24,1,-2^24,-1]`左折叠为−1；按宽2分别从0积累、再按split顺序折叠为0。它是分段/舍入节点的反例，不是在GPU复现某个GEMM。

乘加反例为`a=1+2^-23,b=1-2^-23,c=-1`。分别RN乘和加得到0；一次末尾舍入得到`−2^-46`。这组binary32乘积与加法在binary64中恰能精确表示，所以此处可用JavaScript double构造单次舍入参照；代码没有把一般double表达式视作通用FMA模拟器。

partial精度反例为`1.00390625,-1`。先FP32合并再转BF16得到0.00390625；partial先BF16 RNE舍入则前项落到1，合并后为0。有限BF16转换器仅用于这组finite fixture，不作为GPU量化器或非有限值处理的实现。

## 不变的是逻辑槽，不是工作者数量

对S=1…64个逻辑split及P=1…64个physical program，program p负责`p,p+P,...`。代码检查每个split恰有一个owner，共4,096种映射。每个owner按原split边界产生partial，存入逻辑slot；第二阶段仍按逻辑slot升序fold。逆序启动physical program也保留数值结果。CPU证明范围只限显式逐操作模型，不涵盖实际编译器重排、GPU数据竞争、MMA accumulator语义或硬件调度。

## Attention几何是独立模型

按已核对公式，默认split-token预算T256：`S=ceil(L/T)`，`w=32*ceil(ceil(L/S)/32)`，split j读`[jw,min(L,(j+1)w))`。L257得到S2/w160而非两个固定256窗口。核对请求实际split的有效读取域每位置恰一次，不把更大的allocated budget尾部当成请求数据。对L1…16384共16,384例核对覆盖。

budget512、请求L1500时S6、physical program32可以同时成立；三者是容量、逻辑工作与执行者，不可混为一谈。未计算实际GPU速度、workspace峰值、softmax数值或stage2动态循环的lowering。
