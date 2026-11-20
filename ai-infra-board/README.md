# AI Infra Merge Board

Local dashboard for merged PRs in AI infrastructure repositories. It fetches daily GitHub PRs, archives them in Postgres, scores them by importance, and adds Chinese reading/evaluation comments covering motivation, before/after behavior, rationale, and experiment evidence.

## Quick Start

Use Supabase Postgres as the recommended database. The app only needs a normal
Postgres connection string; it does not depend on the Supabase JS SDK.

```bash
cd /Users/linzhao/Downloads/coding/my-pocket-reader/ai-infra-board
cp .env.example .env
npm install
npm run db:check
npm run db:setup
npm run dev
```

Open `http://localhost:5173`.

## Supabase

Create a Supabase project, then copy a Postgres connection string from
Project Settings -> Database into `.env`:

```bash
DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=no-verify
DATABASE_SSL=true
DATABASE_POOL_MAX=8
DATABASE_CONNECT_TIMEOUT_MS=10000
```

Then initialize the schema and seed the repository watchlist:

```bash
npm run db:check
npm run db:setup
```

If you are logged in with Supabase CLI and do not want to paste the database
password into chat, initialize the remote schema through the Management API and
write the local `.env` through a hidden password prompt:

```bash
supabase link --project-ref rihzdwrefdjruzgdtasb
npm run supabase:setup
npm run env:supabase
npm run db:check
```

`db:check` only verifies connectivity. `db:setup` runs migrations and seeds the
AI infra repository list. After switching databases, rerun a fetch or backfill:

```bash
npm run fetch -- --date today --notify
npm run fetch-range -- --start 2026-02-24 --end 2026-08-24 --notify
```

If you need a temporary local database without Docker:

```bash
npm run db:local:start
```

## Daily Fetch

```bash
npm run catch-up
npm run fetch -- --date yesterday
npm run fetch-range -- --start 2026-02-19 --end 2026-08-19 --notify
```

The app also has Timeline and Annual Picks views. Timeline reads archived PRs newest first for a selected range; Annual Picks ranks archived PRs by importance, core-path category, diff size, explicit evidence, and favorites, then displays the selected set newest first.

`catch-up` fetches from the latest successful archive date through today, always
including yesterday so merges after the previous morning run are not missed. It
backfills the recent half-year when the archive is empty. A failed or incomplete
GitHub response fails the command before replacing snapshots.

The backend also schedules a daily catch-up with `DAILY_FETCH_CRON` in `.env` and sends a desktop notification when `ENABLE_DESKTOP_NOTIFICATIONS=true`. The schedule only runs while the local backend process is running.

Authenticated fetches use GitHub GraphQL search with exact merge-time windows,
pagination, and recursive window splitting at the 1,000-result search cap. Each
window must match GitHub's reported PR count. Set `GITHUB_TOKEN`, or authenticate
`gh`; the limited unauthenticated REST fallback fails if it cannot scan the full
range. Optional `GITHUB_BACKFILL_CACHE` checkpoints only closed windows older
than 24 hours; current windows always refetch.

PR descriptions and metadata are complete; file paths are sampled to the first
30 files for large PRs. Importance and Chinese evaluations are rule based, not
manual reviews or independently verified benchmark results. Follow the original
PR for full diffs and experimental evidence.

## Static GitHub Pages Build

GitHub Pages cannot run the Express API or connect to Postgres from the browser.
For Pages, the backend job fetches GitHub data, archives it to Supabase
Postgres, exports a small `public/data/static.json` manifest plus `public/data/days/*.json`
day files, and then builds a static Vite app. The UI loads days on demand,
shows the last archive/export time, and paginates rendering without dropping
older PRs. The export keeps every archived day by default and refuses an empty
archive. Full PR bodies are omitted from the public snapshot; upstream links
and extracted evaluations are retained. Favorite/read/watch-later state is stored
in the visitor browser's `localStorage`.

```bash
npm run catch-up
npm run build:pages
```

The static app is emitted to `dist/` and is designed to live under the
`/ai-infra-board/` subdirectory of the `my-pocket-reader` GitHub Pages site.

For GitHub Actions, add these repository secrets:

```text
AI_INFRA_DATABASE_URL=postgresql://.../postgres?sslmode=no-verify
AI_INFRA_GITHUB_TOKEN=github_pat_...  # optional; falls back to github.token
```

The workflow lives at `../.github/workflows/pages.yml` and runs daily at
09:15 Asia/Shanghai, on manual dispatch, and on pushes to `main`. For the first
publish, run the workflow manually with `backfill=true` to fetch the recent
half-year before deploying. Scheduled runs use `catch-up`. A plain static HTTP
server serves the last build only; it does not execute the scheduler. To refresh
a local static deployment, run catch-up and build:pages, then sync `dist/` to
its served `ai-infra-board/` folder. Browser reading/favorite state remains local.
