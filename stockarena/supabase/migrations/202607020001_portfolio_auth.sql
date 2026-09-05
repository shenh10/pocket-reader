create extension if not exists "pgcrypto";

create table if not exists public.portfolio_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '默认组合账户',
  broker text,
  base_currency text not null default 'CNY',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.portfolio_accounts(id) on delete cascade,
  source text not null default 'Supabase 持仓库',
  as_of date not null default current_date,
  today_pnl numeric not null default 0,
  today_pnl_pct numeric not null default 0,
  total_market_value_cny numeric not null default 0,
  total_pnl numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.portfolio_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.portfolio_accounts(id) on delete cascade,
  code text not null,
  name text not null,
  market text not null check (market in ('A', 'HK')),
  channel text,
  sector text,
  themes text[] not null default '{}',
  currency text not null check (currency in ('CNY', 'HKD')),
  shares numeric not null default 0,
  available_shares numeric not null default 0,
  screenshot_price numeric not null default 0,
  cost_price numeric not null default 0,
  average_buy_price numeric not null default 0,
  broker_market_value_cny numeric not null default 0,
  broker_total_pnl numeric not null default 0,
  broker_total_pnl_pct numeric not null default 0,
  fx_rate_to_cny numeric not null default 1,
  thesis text,
  watch text[] not null default '{}',
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, code)
);

create index if not exists portfolio_accounts_user_id_idx on public.portfolio_accounts(user_id);
create index if not exists portfolio_snapshots_account_asof_idx on public.portfolio_snapshots(account_id, as_of desc, created_at desc);
create index if not exists portfolio_holdings_account_sort_idx on public.portfolio_holdings(account_id, sort_order, code);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists portfolio_accounts_set_updated_at on public.portfolio_accounts;
create trigger portfolio_accounts_set_updated_at
before update on public.portfolio_accounts
for each row execute function public.set_updated_at();

drop trigger if exists portfolio_holdings_set_updated_at on public.portfolio_holdings;
create trigger portfolio_holdings_set_updated_at
before update on public.portfolio_holdings
for each row execute function public.set_updated_at();

alter table public.portfolio_accounts enable row level security;
alter table public.portfolio_snapshots enable row level security;
alter table public.portfolio_holdings enable row level security;

drop policy if exists "portfolio_accounts_select_own" on public.portfolio_accounts;
create policy "portfolio_accounts_select_own"
on public.portfolio_accounts
for select
using (auth.uid() = user_id);

drop policy if exists "portfolio_accounts_insert_own" on public.portfolio_accounts;
create policy "portfolio_accounts_insert_own"
on public.portfolio_accounts
for insert
with check (auth.uid() = user_id);

drop policy if exists "portfolio_accounts_update_own" on public.portfolio_accounts;
create policy "portfolio_accounts_update_own"
on public.portfolio_accounts
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "portfolio_accounts_delete_own" on public.portfolio_accounts;
create policy "portfolio_accounts_delete_own"
on public.portfolio_accounts
for delete
using (auth.uid() = user_id);

drop policy if exists "portfolio_snapshots_select_own" on public.portfolio_snapshots;
create policy "portfolio_snapshots_select_own"
on public.portfolio_snapshots
for select
using (auth.uid() = user_id);

drop policy if exists "portfolio_snapshots_insert_own" on public.portfolio_snapshots;
create policy "portfolio_snapshots_insert_own"
on public.portfolio_snapshots
for insert
with check (auth.uid() = user_id);

drop policy if exists "portfolio_snapshots_update_own" on public.portfolio_snapshots;
create policy "portfolio_snapshots_update_own"
on public.portfolio_snapshots
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "portfolio_snapshots_delete_own" on public.portfolio_snapshots;
create policy "portfolio_snapshots_delete_own"
on public.portfolio_snapshots
for delete
using (auth.uid() = user_id);

drop policy if exists "portfolio_holdings_select_own" on public.portfolio_holdings;
create policy "portfolio_holdings_select_own"
on public.portfolio_holdings
for select
using (auth.uid() = user_id);

drop policy if exists "portfolio_holdings_insert_own" on public.portfolio_holdings;
create policy "portfolio_holdings_insert_own"
on public.portfolio_holdings
for insert
with check (auth.uid() = user_id);

drop policy if exists "portfolio_holdings_update_own" on public.portfolio_holdings;
create policy "portfolio_holdings_update_own"
on public.portfolio_holdings
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "portfolio_holdings_delete_own" on public.portfolio_holdings;
create policy "portfolio_holdings_delete_own"
on public.portfolio_holdings
for delete
using (auth.uid() = user_id);
