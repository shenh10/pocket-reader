# stockarena

一个面向 A/H 股投研、持仓复盘与交易辅助的单页网站原型，覆盖：

- 我的持仓：录入券商截图中的持仓数量、成本价、可用股数、市值和盈亏口径。
- 每日调仓：按组合权重、成本盈亏、趋势结构、数据可信度和市场别生成调仓优先级。
- 基本面分析：估值、成长、盈利质量、现金流。
- 技术面监控：价格趋势、日期横轴 K 线、均线、支撑压力、RSI、MACD、量能。
- 市场情绪：新闻倾向、讨论热度、北向资金、融资变化、主力净流入。
- 研报共识：最近 12-18 个月研报/公告/券商观点摘要、上修/下修/分歧判断。
- 题材板块：AI 算力、半导体国产替代、人形机器人、固态电池/储能、创新药、高股息。
- 信息流：连接本地数据网关后接收实时行情事件；研报/公告/舆情可继续扩展到 Tushare、AKShare、交易所公告和自建索引。
- 操作辅助：综合评分、调仓动作、规则权重、监控触发器。

当前页面不会把 mock 数据伪装成实时流。持仓数量和成本来自 Supabase 登录账户下的私有表；行情、涨跌幅、K 线和趋势指标来自本地数据网关。网关不可用时，只展示公开研报种子库和本地分析框架。

## 当前接入边界

- 实时行情：已通过本地网关接入。浏览器请求同源 `/api`，Vite 代理到 `http://127.0.0.1:8787`，再由 `server/data-gateway.mjs` 并发请求东方财富 Push2、腾讯行情、新浪行情，对 A 股和港股价格、涨跌幅和时间戳做交叉验证。
- 实时信息流：已接 SSE 通道 `/api/market/stream`，当前以行情快照轮询事件为主。若 SSE 重试，不影响单股快照和 K 线展示。
- 多周期 K 线：优先使用东方财富 Push2His 提供日 K、周 K、月 K、年 K；若历史 K 线源空响应，自动退到腾讯历史 K 线。前端横轴显示真实日期。
- 港股支持：`H00700`、`HK00700`、`00700` 会统一归一为 `H00700`，东方财富 secid 使用 `116.00700`，腾讯/新浪使用 `hk00700`。
- 研报分析：已做首批公司近 12-18 个月公开研报/公告摘要的结构化种子库，进入推荐理由、题材评分和风险标签。港股侧按 HKEXnews、AAStocks AAFN、公司 IR 和授权研报库分层；还没有接自动 PDF 抓取、全文解析、盈利预测表抽取和机构一致预期自动更新。
- 财务指标：PE/PB 等基础字段来自行情源；ROE、营收增速、现金流等深度财务字段需要 Tushare Pro、AKShare/BaoStock 离线任务或自建财报库补全。
- 账户数据：个人持仓不再进入前端静态包，也不再由本地 Node 网关保存；登录走 Supabase Auth，持仓读取走启用 RLS 的 `portfolio_accounts`、`portfolio_snapshots`、`portfolio_holdings` 表。

数据源状态面板显示的是后端最近一次样本探测结果，不代表长期 SLA，也不代表未配置数据源已经接入。`已探测验证` 会附带样本股票、验证字段、探测时间和耗时；`未配置` / `扩展位未运行` 不参与实时决策。

## 数据如何每天更新

当前版本是“页面在线刷新 + 实时网关拉取”的方式：

- 未登录时只刷新公共行情、指数、研报和题材研究池。
- 登录后立即读取 Supabase 账户持仓，并并发刷新持仓行情快照。
- 登录状态下页面保持打开时，每 60 秒自动刷新一次持仓快照，并在持仓面板显示上次刷新、下一轮倒计时、成功/失败数量。
- 点击“立即刷新”会手动触发一轮持仓快照更新。
- 选中股票或切换日/周/月/年 K 线时，会重新请求 `/api/market/kline/:code`。
- SSE `/api/market/stream` 每轮推送行情事件，用于信息流更新。
- 上游收盘后更新日 K，页面下一次刷新或切换周期时会拿到新的日线数据。

还没有做本地数据库定时落库。真实生产版建议增加一个后端 cron/worker：

- 09:20：刷新持仓清单、数据源健康检查。
- 09:30-16:10：每 30-60 秒拉取 A/H 持仓快照，写入 `quote_snapshots`。
- 16:15：刷新 A 股日 K、组合盈亏、调仓建议。
- 18:10：刷新港股日 K、组合盈亏、调仓建议。
- 夜间：抓取公告/研报/财报，跑全文解析和题材归因，写入研究库。

## 账户与隐私边界

当前版本使用 Supabase 托管个人账户：

- 登录：Supabase Auth Email/Password。
- 会话：`@supabase/supabase-js` 浏览器会话，自动刷新 token。
- 私有数据：`portfolio_accounts`、`portfolio_snapshots`、`portfolio_holdings`。
- 权限：所有私有表启用 Row Level Security，策略使用 `auth.uid() = user_id` 或 `auth.uid() = id`。
- 本地网关：只处理公开行情、K 线、研报源探测和 SSE 行情流，不保存账户密码和个人持仓。

建议复制 `.env.example` 到 `.env` 并修改：

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key
```

数据库建表脚本在 `supabase/migrations/202607020001_portfolio_auth.sql`。真实部署时不要把 Supabase service-role key 放进浏览器环境变量；导入券商持仓、批量改仓位、后台定时任务这类高权限操作应放到服务端 worker 或 Supabase Edge Function。

## 多源验真与交易逻辑

后端不会直接信任单一行情返回值。`/api/market/snapshot/:code` 会返回：

- `dataQuality`：每个行情源的状态、价格、涨跌幅、时间戳、偏差、失败原因、共识价、价差和可信度。
- `tradingPlan`：基于二级市场交易逻辑生成趋势结构、入场区、加仓条件、止损、止盈、风险收益比、仓位建议和失效条件。

当前交易逻辑使用：

- 数据可信度：三源强一致优先，单源或分歧降低操作权重。
- 趋势结构：价格相对 MA20/MA60、均线方向、MACD。
- 位置与风报比：距离支撑/压力的上行空间和下行空间。
- 过热/破位：RSI、接近压力位、跌破支撑或 MA60。
- 仓位节奏：只输出研究辅助，不直接给交易指令。

持仓调仓逻辑额外使用：

- 组合权重：单一标的或港股整体过高时提高风控优先级。
- 成本压力：按券商截图的“成本价”口径计算浮盈亏；阿里巴巴-W 的成本价和买入均价差异会在页面提示复核。
- 盈利保护：高浮盈且 RSI 偏热或权重不低时提示分批止盈。
- 深亏处理：深套本身不是立即卖出的理由；系统会先判断基本面是否证伪、是否继续破位、是否仓位过度集中，再输出“停止补仓 / 等待修复 / 反弹降风险 / 纪律止损”。没有逻辑证伪时不机械低位割肉，也不默认补仓。
- 汇率边界：港股人民币市值按截图隐含 HKD/CNY 汇率估算，真实交易需同步券商汇率。

## 分析框架

权重默认如下，可在 `src/data/research.ts` 中调整：

- 研报共识 24%：报告数量、机构覆盖、评级方向、目标价变化、盈利预测修正。
- 基本面质量 22%：营收、利润、ROE、毛利率、现金流、估值分位。
- 题材板块 18%：政策催化、产业订单、景气指标、龙头扩散、拥挤度。
- 技术资金 16%：MA20/MA60、RSI、MACD、换手率、主力净额、北向资金。
- 信息流冲击 12%：事件类型、影响度、情绪倾向、是否改变盈利假设。
- 风险折扣 8%：估值拥挤、预期差、政策风险、价格战、外部限制。

## 本地运行

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动：

- 前端：`http://127.0.0.1:5173/`
- 数据网关：`http://127.0.0.1:8787/`

## Supabase 配置

个人账户和持仓表不再走本地文件：

1. 在 Supabase 创建项目。
2. 在 Authentication 里开启 Email/Password 登录。
3. 在 SQL Editor 执行 `supabase/migrations/202607020001_portfolio_auth.sql`。
4. 创建你的登录用户。
5. 按 `supabase/README.md` 的字段结构导入持仓、账户和快照数据。
6. 在 `.env` 写入：

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key
```

前端只允许使用 anon/publishable key。service-role key 只能放在服务端导入脚本、Edge Function 或受控 worker 里。

## 数据源策略

已接入：

- 东方财富 Push2/Push2His：A/H 股快照、指数、日/周/月/年 K 线、成交额、估值基础字段。
- 东方财富 Push2 clist：A/H 全市场股票池、代码/名称/行业/题材搜索、概念/行业板块榜和板块领涨股。网关缓存 10 分钟，前端搜索不再只依赖硬编码研究池。
- 腾讯行情/历史 K 线：A/H 股报价校验和历史 K 线兜底。
- 新浪行情：A/H 股报价校验。
- AAStocks AAFN：港股公开新闻、Research Report、Analysts' Views 与个股信息入口已做页面可用性探测。它适合做索引，不等同于完整研报数据库。
- 东方财富研报中心：A 股个股研报、行业研报、盈利预测入口已做页面可用性探测；港股覆盖需按个股继续核验。

预留扩展：

- Tushare Pro：财务、复权、日线历史、股票基础资料，需要 `TUSHARE_TOKEN`。
- AKShare：Python 聚合数据源，适合批量抓取和落库。
- BaoStock：免费历史行情和部分财务，适合离线补全。
- HKEXnews 披露易：港股公告、年报、中报、业绩公告、回购和权益披露，是港股事实源；若上游反爬或临时不可用，页面会按探测结果降级显示。
- 富途 OpenD：适合港股行情、账户/交易接口和讨论热度扩展，需要 `FUTU_OPEND_HOST` 或账户授权后再稳定接入；不作为研报事实源。
- 授权研报库：Wind、Choice、iFinD、FactSet、LSEG、Bloomberg 等才能稳定覆盖完整券商研报全文、盈利预测、目标价历史和机构一致预期，需要 `RESEARCH_VENDOR_TOKEN` 或具体供应商授权。
- 巨潮/交易所/东方财富研报：公告、年报季报、公开研报 PDF 和板块新闻。

## 港股研报数据源路线

港股不能只靠网页片段做“完整研报分析”。推荐分三层：

- 事实层：HKEXnews 披露易、公司 IR、业绩公告、年报/中报、回购和权益披露。用于验证收入结构、管理层指引、风险事项和资本动作。
- 公开索引层：AAStocks AAFN、东方财富研报中心和券商官网公开 PDF。用于发现大行观点、评级/目标价变化和新闻事件，但必须保留原始链接。
- 授权完整层：Wind、Choice、iFinD、FactSet、LSEG、Bloomberg 或合规自建研报库。用于完整抽取近 12-18 个月研报全文、盈利预测表、目标价历史、机构覆盖和一致预期。

当前实现只把公开入口和扩展位接入状态面板，不会把“页面可访问”包装成“研报全文已入库”。

## 数据网关接口

前端默认调用同源 `/api`，Vite 会代理到 `http://127.0.0.1:8787`。

- `GET /api/providers`
- `GET /api/providers?sample=H00700`
- `GET /api/market/indexes`
- `GET /api/market/universe?q=宁德时代&market=A&limit=80`
- `GET /api/market/themes?limit=8`
- `GET /api/market/snapshot/:code`
- `GET /api/market/kline/:code?period=day|week|month|year`
- `GET /api/market/stream?codes=H00700,002594,300750`

返回结构对齐：

- `src/data/market.ts` 中的 `MarketIndex`、`MarketSecurity` 和 `StockProfile`
- `src/data/research.ts` 中的 `ResearchReportDigest`、`CompanyResearch` 和 `ThemeCluster`

## 授权数据源扩展

任何需要 token、账号或终端授权的数据源都必须放在服务端代理里，不要暴露给浏览器。

配置示例：

```bash
TUSHARE_TOKEN=your_token npm run dev
```

港股研报/授权扩展示例：

```bash
FUTU_OPEND_HOST=127.0.0.1:11111
RESEARCH_VENDOR_TOKEN=your_vendor_token
```

真实落地时建议代理层继续扩展：

- `GET /api/research/universe?market=A`
- `GET /api/fundamentals/:code`
- `GET /api/technicals/:code`
- `GET /api/sentiment/:code`
- `GET /api/market/breadth`
- `GET /api/research/earnings-revisions/:code`
- `GET /api/research/industry/:theme`
- `GET /api/news?codes=...&themes=...`
- `POST /api/alerts`

## 研报自动化下一步

建议新增后端 ingestion pipeline，而不是在浏览器里抓网页：

- 抓取层：从东方财富研报、巨潮公告、交易所公告、Tushare/AKShare 可用接口拉取报告元数据和 PDF。
- 解析层：PDF 文本抽取后识别机构、日期、评级、目标价、盈利预测、核心假设和风险提示。
- 归因层：把报告观点映射到题材、板块、盈利预测修正、风险折扣和监控条件。
- 存储层：落到 SQLite/Postgres 或本地 JSONL 索引，再由 `/api/research/reports/:code` 提供给前端。
- 校验层：每条摘要保留来源 URL、报告日期和机构名，避免把模型摘要伪装成原始研报。

## 首批研究池

公开种子库覆盖：

- AI 算力/半导体/PCB：中际旭创、工业富联、沪电股份、北方华创、中芯国际。
- 新能源/储能/机器人：宁德时代、比亚迪、阳光电源、汇川技术、三花智控。
- 消费/医药/金融/红利：贵州茅台、五粮液、恒瑞医药、迈瑞医疗、招商银行、中国移动。

> 页面信号用于研究和风控展示，不构成任何投资建议。
