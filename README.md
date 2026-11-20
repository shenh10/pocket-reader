# My Pocket Reader

一个 GitHub Pages 静态书架。每个内容包放在独立顶层子目录，发布后保持相同路径：

- `/`：书架首页
- `/nvidia-docs/`：NVIDIA 文档专题，包含 NCCL、CUDA Programming Guide、cuBLAS、PTX
- `/ai-infra-board/`：AI infra merged PR radar
- `/stockarena/`：A/H 股投研与持仓复盘工作台

## GitHub Pages

仓库使用 GitHub Actions 发布，workflow 在：

```text
.github/workflows/pages.yml
```

在 GitHub 仓库设置里选择：

```text
Settings -> Pages -> Source -> GitHub Actions
```

之后 push 到 `main`，或手动运行 `Deploy Pocket Reader` workflow。

## Secrets

`nvidia-docs/` 是纯静态 HTML，不需要 secrets。

`ai-infra-board/` 推荐配置：

```text
AI_INFRA_DATABASE_URL=postgresql://.../postgres?sslmode=no-verify
AI_INFRA_GITHUB_TOKEN=github_pat_...  # 可选
```

`AI_INFRA_DATABASE_URL` 是必需的；workflow 会从 Supabase/Postgres 导出静态 JSON 后再发布。

`stockarena/` 可选配置：

```text
STOCKARENA_SUPABASE_URL=https://your-project.supabase.co
STOCKARENA_SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key
```

没有 Supabase secrets 时，公开页面仍可构建，但个人持仓登录功能会显示未配置。

## 本地预览

```bash
cd /Users/linzhao/Downloads/coding/my-pocket-reader
python3 -m http.server 5175
```

打开：

```text
http://127.0.0.1:5175/
http://127.0.0.1:5175/nvidia-docs/
http://127.0.0.1:5175/ai-infra-board/
http://127.0.0.1:5175/stockarena/
```

## Mobile reader and content service

The shared website and Capacitor Android/iOS apps read daily content from a Supabase Edge API. Daily collection is a separate workflow; no reports are packaged into the app. See [mobile development and deployment](docs/mobile.md).
