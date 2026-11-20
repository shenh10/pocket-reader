# Pocket Reader 移动端

网页和安装版共用 `index.html`、`settings.html`、`nvidia-docs/`、`ai-infra-board/` 和 `shared/`。Capacitor 8 将同一份构建结果放进 Android / iOS 安装包。界面由 WebView 渲染，系统返回、分享、外部浏览器和设置存储由原生插件提供。

## 本地开发

要求 Node.js 22+。Android 构建需要 JDK 21、Android SDK 36；iOS 构建需要支持 Capacitor 8 的 Xcode 和 Apple 签名配置。

```sh
npm ci
npm ci --prefix ai-infra-board
npm ci --prefix stockarena
npm run check
npm run mobile:sync        # 构建 _mobile 并同步到 Android
npm run mobile:android     # Android Studio
# 或 cd android && ./gradlew assembleDebug
npm run mobile:sync:ios
npm run mobile:ios         # Xcode
```

`Build Pocket Reader Mobile` GitHub Actions 构建测试 APK，并检查手机页面导航、字号、缓存、收藏、通知路由、首次离线打开和服务数据更新。APK 使用临时 debug 签名，适合安装体验；正式发布需要固定签名。Android 最低版本 7.0（API 24），还需要支持现代网页功能的 WebView。iOS 工程已生成，尚未做签名和真机验证。

## 服务架构

```text
GitHub 采集任务 → Supabase PostgreSQL ← Supabase Edge API
                                               ↑
                                    网页 / Android / iOS
```

- 定时采集独立在 `Collect Daily Content` workflow 中，每天 09:15（上海）写入数据库，与前端发布分离。
- Supabase `pocket-reader` Edge Function 提供公开只读 `/v1/summary`、`days`、`dashboard?date=`、`timeline?start=&end=&offset=`、`highlights?year=&limit=` 接口。时间线每页 500 条，客户端跟随 `nextOffset` 读取，不截断半年归档。
- API 对每次请求查询数据库；不通过 Pages 静态 JSON 中转。返回时去掉服务端个人笔记、收藏和阅读状态；无采集或修改接口。
- 数据库连接仅存放在 Supabase 服务端 `POCKET_DATABASE_URL` secret。客户端只有公开 API 地址，配置位于 `pocket.config.json`，构建时可用 `POCKET_API_URL` 覆盖。
- **APK、iOS 包和网页构建结果均不包含日报数据。** 构建不下载日报，也不连接数据库。`build-site` 会删除历史构建残留的 `ai-infra-board/data`。
- 首页从 API 获取最新日期和计数；日报在打开时请求 API。服务端入库后无需更新 APK 或重新部署网页即可读取新内容。
- 初次打开日报需要联网。后续可读 IndexedDB 中已经获取的内容；最多缓存 64 项，按最近写入时间淘汰，没有缓存的页面明确提示不可用。
- 收藏/已读暂存当前设备，跨设备账户同步未实现。清理内容缓存不会清除阅读状态。
- 教程作为静态资源随包发布；网页通过 Service Worker 缓存已访问页面，最多 120 项。

## 部署 API 和网页

现有 Supabase project：`rihzdwrefdjruzgdtasb`。API 基址：
`https://rihzdwrefdjruzgdtasb.supabase.co/functions/v1/pocket-reader/v1/`

```sh
npm run build:service
cd ai-infra-board
# 在安全的本机环境文件中设置 POCKET_DATABASE_URL，不要提交文件或粘贴到聊天。
supabase secrets set --project-ref rihzdwrefdjruzgdtasb --env-file /path/to/server-secrets.env
supabase functions deploy pocket-reader --project-ref rihzdwrefdjruzgdtasb --use-api
```

Edge 入口复用现有数据库查询与规则解读代码，经 esbuild 构建为可部署的单文件。公开内容允许匿名 GET；数据库凭据、管理员采集入口与个人笔记均不暴露。测试覆盖参数边界、分页、错误脱敏及只读约束。

Pages workflow 只安装前端依赖并运行 `npm run build:web`。每日采集使用原有 `AI_INFRA_DATABASE_URL` 和可选 `AI_INFRA_GITHUB_TOKEN` GitHub secret。本机服务仍可开发调试，云端定时任务负责持续采集。

## 系统链接与推送

已注册 `pocketreader://daily?date=2026-11-20`、`pocketreader://learn`、`pocketreader://home`。Android 可用 `adb shell am start -a android.intent.action.VIEW -d 'pocketreader://daily?date=2026-11-20' cc.shenhan.pocketreader` 检查。

HTTPS 链接可分享为网站地址，但 Universal Links / Android App Links 的域名关联尚未配置；普通 HTTPS 链接会打开网页。

**本版本没有启用远程推送。** 设置页明确显示“待开放”，不请求通知权限。国内 Android 需要选定推送服务并接入华为、小米、OPPO、vivo 等厂商通道；iOS 需要 APNs 凭据。没有使用仅依赖 FCM 的方案。

预留可选原生 `PocketPush` 插件约定（尚未实现原生 SDK）：

- `register()`：用户主动点击开启后请求系统授权并注册设备；后端注册和凭据由后续集成完成。
- `notificationOpened` 事件：`{date: 'YYYY-MM-DD'}` 或 `{url: 'https://shenhan.cc/pocket-reader/ai-infra-board/?date=...'}`。
- JS 入口 `window.PocketReader.handleNotification(payload)` 校验白名单、日期和目标路径；不接受任意外部地址。

真正上线推送还需设备 token 接口、取消订阅、通知偏好、定时投递与失败重试。当前日报生成/数据库服务可继续作为内容源。
