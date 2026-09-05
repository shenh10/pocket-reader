import { writeFile } from "node:fs/promises";
import { portfolioBrokerSnapshot, portfolioHoldings } from "../server/private-portfolio.mjs";

const outputPath = new URL("../server/private-portfolio-seed.sql", import.meta.url);
const targetEmailPlaceholder = "REPLACE_WITH_LOGIN_EMAIL";

function sqlString(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : "0";
}

function sqlTextArray(values) {
  if (!Array.isArray(values) || values.length === 0) return "array[]::text[]";
  return `array[${values.map(sqlString).join(", ")}]::text[]`;
}

const holdingRows = portfolioHoldings
  .map((holding, index) => {
    const sortOrder = (index + 1) * 10;
    return `(
    target_user_id,
    target_account_id,
    ${sqlString(holding.code)},
    ${sqlString(holding.name)},
    ${sqlString(holding.market)},
    ${sqlString(holding.channel)},
    ${sqlString(holding.sector)},
    ${sqlTextArray(holding.themes)},
    ${sqlString(holding.currency)},
    ${sqlNumber(holding.shares)},
    ${sqlNumber(holding.availableShares)},
    ${sqlNumber(holding.screenshotPrice)},
    ${sqlNumber(holding.costPrice)},
    ${sqlNumber(holding.averageBuyPrice)},
    ${sqlNumber(holding.brokerMarketValueCny)},
    ${sqlNumber(holding.brokerTotalPnl)},
    ${sqlNumber(holding.brokerTotalPnlPct)},
    ${sqlNumber(holding.fxRateToCny)},
    ${sqlString(holding.thesis)},
    ${sqlTextArray(holding.watch)},
    ${sortOrder}
  )`;
  })
  .join(",\n");

const sql = `-- Local private portfolio seed.
-- Generated from server/private-portfolio.mjs.
-- This file is ignored by git. Replace target_email before running in Supabase SQL Editor.

do $$
declare
  target_email text := '${targetEmailPlaceholder}';
  target_user_id uuid;
  target_account_id uuid;
  auth_user_count integer;
begin
  if target_email = '${targetEmailPlaceholder}' then
    select count(*) into auth_user_count from auth.users;
    if auth_user_count = 1 then
      select id into target_user_id from auth.users order by created_at desc limit 1;
    else
      raise exception 'Please replace target_email with your Supabase login email. Found % auth users.', auth_user_count;
    end if;
  else
    select id into target_user_id
    from auth.users
    where email = target_email
    order by created_at desc
    limit 1;
  end if;

  if target_user_id is null then
    raise exception 'No Supabase auth user found for email %', target_email;
  end if;

  select id into target_account_id
  from public.portfolio_accounts
  where user_id = target_user_id
  order by created_at asc
  limit 1;

  if target_account_id is null then
    insert into public.portfolio_accounts (user_id, name, broker, base_currency)
    values (target_user_id, '主账户', '用户截图录入', 'CNY')
    returning id into target_account_id;
  else
    update public.portfolio_accounts
    set
      name = coalesce(nullif(name, ''), '主账户'),
      broker = coalesce(nullif(broker, ''), '用户截图录入')
    where id = target_account_id;
  end if;

  delete from public.portfolio_snapshots
  where account_id = target_account_id
    and source = ${sqlString(portfolioBrokerSnapshot.source)}
    and as_of = ${sqlString(portfolioBrokerSnapshot.asOf)}::date;

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
    target_user_id,
    target_account_id,
    ${sqlString(portfolioBrokerSnapshot.source)},
    ${sqlString(portfolioBrokerSnapshot.asOf)}::date,
    ${sqlNumber(portfolioBrokerSnapshot.todayPnl)},
    ${sqlNumber(portfolioBrokerSnapshot.todayPnlPct)},
    ${sqlNumber(portfolioBrokerSnapshot.totalMarketValueCny)},
    ${sqlNumber(portfolioBrokerSnapshot.totalPnl)}
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
  ) values
${holdingRows}
  on conflict (account_id, code) do update
  set
    name = excluded.name,
    market = excluded.market,
    channel = excluded.channel,
    sector = excluded.sector,
    themes = excluded.themes,
    currency = excluded.currency,
    shares = excluded.shares,
    available_shares = excluded.available_shares,
    screenshot_price = excluded.screenshot_price,
    cost_price = excluded.cost_price,
    average_buy_price = excluded.average_buy_price,
    broker_market_value_cny = excluded.broker_market_value_cny,
    broker_total_pnl = excluded.broker_total_pnl,
    broker_total_pnl_pct = excluded.broker_total_pnl_pct,
    fx_rate_to_cny = excluded.fx_rate_to_cny,
    thesis = excluded.thesis,
    watch = excluded.watch,
    sort_order = excluded.sort_order,
    updated_at = now();
end $$;
`;

await writeFile(outputPath, sql, "utf8");

console.log(`Generated ${outputPath.pathname}`);
console.log(`Holdings: ${portfolioHoldings.length}`);
console.log(`Snapshot as of: ${portfolioBrokerSnapshot.asOf}`);
