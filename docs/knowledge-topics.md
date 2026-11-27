# 知识专题发布

专题与日报共用 Supabase PostgreSQL 和 `pocket-reader` Edge Function。目录与正文分别请求 `GET /v1/topics`、`GET /v1/topics/{id}`；原有 PR 与阅读状态不参与专题导入。网页入口为 `ai-infra-board/?view=topics`，单篇地址增加 `&topic={id}`。

数据库专表 `public.reader_topics` 保存正文、目录字段、关联专题、内容版本及 SHA256。公开 API 只返回已发布内容且没有写接口。RLS 与 grants 排除 Supabase 匿名、authenticated 和 service_role 的直接访问；当前服务角色本身也是建表/发布角色，表 owner 的权限并非只读，不能将其凭据交给客户端。

## 内容更新

`content/topics/publication.json` 是经审核的服务端发布输入，不是客户端静态数据。构建网页和移动包时不复制 `content/` 或 `docs/topic-evidence/`，正文由 API 获取。读者访问过的内容可以用现有设备缓存离线读取。

从本地已评审稿构建发布输入：

```sh
node scripts/prepare-topics.mjs --source /absolute/path/to/knowledge-topics
cd ai-infra-board
node --import tsx scripts/publish-topics.ts --input /absolute/path/to/content/topics/publication.json --dry-run
# DATABASE_URL 仅由安全的本机或服务环境提供。
node --import tsx scripts/publish-topics.ts --input /absolute/path/to/content/topics/publication.json --migrate
```

准备工具要求每篇正文与评审清单及 metadata 哈希一致，再转换专题互链、公开研究记录与过期的“本地未发布”状态句。科学结论及实验限制保留。`reviewed-sources.json` 保存审核原稿与发布内容两个哈希。补充研究记录在 GitHub 的 `docs/topic-evidence/` 阅读，不作为网页脚本执行。

首次使用 `--migrate` 只建立专题专表。后续不需要重复迁移；导入事务只 upsert 输入中的专题，重复相同输入返回 `changed: 0`。不会删除其他专题、修改 PR 或个人状态。发布前应审查版本与输入 diff，避免拿旧 bundle 覆盖新内容；当前发布器不自动阻止显式旧版本回滚。

仅内容更新时，导入数据库即可，无需重新发布网页或 APK。目录和正文缓存最长60秒；联网重开可刷新。阅读组件升级才需要 Pages 发布，兼容的 v0.3 移动端会通过现有签名页面更新获得界面；更老且没有页面更新功能的安装版需要升级。

## 界面与验证

Markdown 使用受控 renderer，不执行原始 HTML；KaTeX 与字体随界面发布，Mermaid 在 strict 模式生成 SVG 后经 sanitizer 过滤。表格和公式可横向阅读，中文目录支持锚点，专题互链保留 Web/原生路径。没有把数据库脚本直接注入 WebView。

接口测试覆盖白名单、发布条件、参数/错误脱敏、只读约束、输入校验和幂等 upsert。浏览器测试使用全部八篇真实发布正文检查公式、图、目录、互链、错误重试与手机/暗色布局。部署后还需对线上八篇正文和哈希逐项核验，并打开实际 Pages 阅读入口。
