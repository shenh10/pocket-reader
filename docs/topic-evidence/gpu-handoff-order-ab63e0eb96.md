# 从发布规则到完整 buffer 协议

本目录支持 article.md 新增的主文比较；不是另一篇读者必须拼接的补充文章。

## 来源

固定 CUTLASS v4.8.0 revision `098de2a652cf8f00fd70b2df54051c7eccbb855a` 的 full/empty、index/phase、初始 state；文件复用 `../../../source-research/gpu-ordering/stage-proof/` 已保存源码。`source-receipts.json` 固定每个文件哈希；`anchors.json` 为逐行连续摘录与摘录哈希。PTX phase 条件来自先前已抓取的官方 ISA 快照；没有把整数代际模型当作 parity 正确性的证明。

新增 `programming-model.html` 于 2026-11-26 从 NVIDIA 官方 programming guide 获取。第534行说明普通 block 没有相互调度保证，第542行说明 block 应能按任意顺序并行或串行运行。这里只用它支持“不能假设跨 CTA 同驻留”；toy scheduler 的 capacity=2、无抢占、持有 residency 忙等是显式模型假设，不是硬件测量。web search 接口返回403，随后直接获取官方文档，未引用搜索摘要。

## 可运行模型

在本目录运行 `node protocol-model.mjs`，重建 `model-results.json`。

- ownership 模型：4 tiles、一个按序 producer、一个按序 consumer；producer 两步（整 tile write、publish）；consumer 三步（开始源读、源读完成、return）；1/2槽。`full(g)` 的可见性作为前提，`empty(g)` 必须在源读完成之后。模型以整数标签检查代际，不建模 release/acquire、proxy 或硬件 barrier。
- 安全单槽 21状态/20边，双槽39状态/56边；0次模型定义的未归还覆盖或错代读观察。都存在终止状态；双槽另存在 read0 与 write1 重叠的轨迹。
- 去掉 producer 的 empty 检查：57状态/88边。至少一条轨迹 `W0,full0,W1,full1,beginRead0,W2` 在源读尚未完成时覆盖同一 slot0；没有把重复 violation 观察计数当作失败概率。
- 调度模型：3个CTA（2 consumer，1 producer）、2驻留容量，无抢占，consumer在producer完成前不能退出；枚举16状态，存在先驻留两个 consumer 而使 producer 无法入场的无后继状态。

这些是所列有限抽象模型内的状态遍历，不是 GPU simulator、完整内存模型证明、硬件死锁复现或性能测试。可达终止状态不是所有调度公平性的证明。

## 主文成本模型

P = 生产/发布时间，R = 消费开始到可归还源的时间。单槽 P+R 与两槽理想下界 max(P,R) 只在两个角色可独立执行、忽略同步/资源争用/填充排空时用于比较。更多槽可能增加 shared memory 并影响 occupancy；未给出实际 kernel 速度、性能收益或最优stage数。

## 保留的正确性边界

主文保留所有128名 gate writer 的 full arrive、full/empty的不同职责、generic→async proxy fence、TMA `.read` 仅保证源读取完成、PDL dependent 必须 wait、release scope/domain 条件。新增段落没有提供可复制但缺少可见性/进度条件的裸 CUDA flag 协议。
