# Supabase account backend

This directory contains the account and portfolio schema for the private side of the app.

## Setup

1. Create a Supabase project.
2. Enable Email/Password sign-in in Authentication.
3. Run `migrations/202607020001_portfolio_auth.sql` in Supabase SQL Editor.
4. Create a user in Authentication.
5. Insert that user's portfolio rows with `user_id = auth.users.id`.
6. Put the browser-safe project values in `.env`:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

Only the anon/publishable key belongs in the Vite frontend. Never put a Supabase service-role key in `.env` for this browser app.

Use `auth.users.id` as the system user ID. Use `portfolio_accounts.name` for a formal portfolio account name, for example `主账户`, `港股组合`, or `长期权益组合`.

## Restore the local private portfolio

The previously hand-entered holdings are kept in `server/private-portfolio.mjs`, which is ignored by git. To restore them into Supabase:

```bash
npm run portfolio:seed-sql
```

This generates `server/private-portfolio-seed.sql`, also ignored by git. Open that SQL file, replace:

```sql
target_email text := 'REPLACE_WITH_LOGIN_EMAIL';
```

with the email of the Supabase Auth user, then run the file in Supabase SQL Editor. If the Supabase project has exactly one Auth user, the generated SQL can resolve that user automatically, but setting the email is safer.

The seed upserts existing holdings by `(account_id, code)` and inserts a fresh broker snapshot for `2026-07-02`.

## Minimal data shape

```sql
insert into public.portfolio_accounts (id, user_id, name, broker)
values (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  '主账户',
  '券商名称'
);

insert into public.portfolio_snapshots (
  user_id,
  account_id,
  source,
  as_of,
  today_pnl,
  today_pnl_pct,
  total_market_value_cny,
  total_pnl
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  '券商导入',
  current_date,
  0,
  0,
  0,
  0
);

insert into public.portfolio_holdings (
  user_id,
  account_id,
  code,
  name,
  market,
  channel,
  sector,
  themes,
  currency,
  shares,
  available_shares,
  screenshot_price,
  cost_price,
  average_buy_price,
  broker_market_value_cny,
  broker_total_pnl,
  broker_total_pnl_pct,
  fx_rate_to_cny,
  thesis,
  watch,
  sort_order
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'H00700',
  '腾讯控股',
  'HK',
  '深港通',
  '互联网平台',
  array['游戏', '广告复苏'],
  'HKD',
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0.9,
  '填写你的持仓逻辑',
  array['业绩公告', '回购'],
  10
);
```
