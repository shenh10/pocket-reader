# 日报代码分析

关键词只用于粗排，不能产生技术结论。列表删除入选理由、阅读建议以及旧的规则模板。没有分析的 PR 显示「尚未完成代码分析」。历史模板不会再通过 API 返回；旧版客户端也只能看到新分析的兼容字段。

分析单独保存在 Supabase `pull_requests.deep_dive`，采集与重新分类不会覆盖它。网页和 App 从同一 API 读取，不打包日报。摘要直接呈现具体机制，展开后包含触发条件、旧路径、新机制、代价、验证边界和真实代码摘录。每段必须引用已获取的证据；实验结果注明作者报告，不能冒充本地复现。

## 取证与发布

在 `ai-infra-board/` 运行：

```sh
npm run deep-dive -- prepare --repo owner/repo --number 123 --out evidence.json
# 依据 evidence.json 和 src/server/deep-dive.ts 中的 ANALYSIS_PROMPT 撰写 analysis.json。
npm run deep-dive -- publish --evidence evidence.json --analysis analysis.json
```

publish 会重新获取 GitHub 原始材料、核对 commit，验证引用 ID 和逐字代码摘录后才写数据库。无有效 diff、无证据、模板化结论或伪造代码会拒绝发布。结构校验不等于语义事实核查；人工撰写仍需要逐项核对因果与来源。

取证读取合并 PR 正文、完整文件列表、最多 8 个代码 diff（保留回归测试），以及前 3 个文件首个改动附近的前后版本。链接固定源码 SHA。正文/diff 有预算上限，覆盖比例和截断/缺失信息会显示给读者；这不是全仓审计。上游文字是数据，不允许作为指令执行。

## 每日自动分析

仓库 Settings → Secrets and variables → Actions：

- Secret `DEEP_DIVE_API_KEY`：模型密钥。
- Variable `DEEP_DIVE_BASE_URL`：提供 `/chat/completions` 的 HTTPS API base，包含所需的 `/v1` 前缀。
- Variable `DEEP_DIVE_MODEL`：模型 ID，须支持 JSON object 输出。

默认每天每期最多 5 条，已有分析计入额度；重复运行不会重付费生成。按现有粗排挑选 P4/P5，并过滤文档维护项。可用 `--limit 1..20` 或 `DEEP_DIVE_DAILY_LIMIT` 调整。分析失败保留已有内容，单条失败不阻止尝试其他条目，命令最终返回失败。每日采集结束后分别处理昨日和今日，随后推送；分析失败不阻止采集与通知。未配置模型时明确发出 Actions 警告，不伪造分析。

```sh
npm run deep-dive -- run --date 2026-11-21 --limit 5
```

模型只接收公开 PR 材料，不接收数据库凭据、笔记或设备信息。API 密钥只在服务侧环境读取，网页与 APK 不包含它。模型请求超时 180 秒。发布前由既有 `npm run db:setup` 添加 JSONB 列，再部署 Supabase Edge Function 与 Pages。
