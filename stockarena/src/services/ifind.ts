import type { KlinePayload, KlinePeriod, LiveEvent, MarketIndex, MarketSecurity, StockProfile } from "../data/market";
import type { PortfolioBrokerSnapshot, PortfolioHolding } from "../data/portfolio";
import type { CompanyResearch, ResearchReportDigest, ThemeCluster } from "../data/research";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DATA_API_BASE =
  (import.meta.env.VITE_DATA_API_BASE as string | undefined) ||
  (import.meta.env.VITE_IFIND_API_BASE as string | undefined) ||
  "";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);

const supabase: SupabaseClient | null = createSupabaseClient();

export type DataConnectionState = "seed" | "connecting" | "connected" | "error";
export type IfindConnectionState = DataConnectionState;

function apiUrl(path: string) {
  if (!DATA_API_BASE) return path;
  return `${DATA_API_BASE}${path}`;
}

function createSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const globalScope = globalThis as typeof globalThis & {
    __stockarenaSupabase?: SupabaseClient;
    __stockarenaSupabaseKey?: string;
  };
  const cacheKey = `${SUPABASE_URL}:${SUPABASE_ANON_KEY}`;

  if (globalScope.__stockarenaSupabase && globalScope.__stockarenaSupabaseKey === cacheKey) {
    return globalScope.__stockarenaSupabase;
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  });
  globalScope.__stockarenaSupabase = client;
  globalScope.__stockarenaSupabaseKey = cacheKey;
  return client;
}

export type DataProvider = {
  id: string;
  name: string;
  status: "connected" | "standby" | "configured" | "needs-token" | "extension-ready";
  coverage: string[];
  auth: string;
  note: string;
  health?: {
    state: "verified" | "degraded" | "failed" | "not-configured" | "reserved";
    checkedAt: string;
    latencyMs?: number;
    sampleCode?: string | null;
    sampleName?: string | null;
    evidence?: string[] | string;
    error?: string | null;
  };
};

export type HkResearchItem = {
  id: string;
  code: string;
  source: string;
  layer: "official-filing" | "research-index" | "public-view" | "public-news" | string;
  category: string;
  title: string;
  date: string;
  summary: string;
  url: string;
  signal: "上修" | "维持" | "下修" | "分歧" | "事实" | string;
  risks: string[];
  relevance: "direct" | "sector";
  confidence: number;
};

export type HkResearchSourceStatus = {
  name: string;
  status: "verified" | "failed" | "reserved" | "not-configured" | string;
  url: string;
  evidence: string[];
  error?: string | null;
};

export type HkResearchIndex = {
  code: string;
  rawCode: string;
  market: "HK";
  name: string;
  generatedAt: string;
  coverage: {
    quote: string;
    officialFiling: string;
    publicResearch: string;
    licensedConsensus: string;
  };
  analysis: {
    directCount: number;
    sectorCount: number;
    filingCount: number;
    researchCount: number;
    themes: string[];
    notes: string[];
  };
  items: HkResearchItem[];
  sources: HkResearchSourceStatus[];
  limitations: string[];
};

export type ResearchDocumentExtraction = {
  url: string;
  code: string;
  title: string;
  source: string;
  status: "parsed" | "empty" | string;
  format: "pdf" | "html" | string;
  fetchedAt: string;
  bytes: number;
  pageCount: number;
  pdfTitle: string;
  textChars: number;
  excerpt: string;
  forecast: {
    status: "found" | "not-found" | string;
    rows: Array<{
      metric: string;
      periods: string[];
      values: string[];
      raw: string;
    }>;
    confidence: number;
  };
  ratingLines: string[];
  warning?: string | null;
  limitations: string[];
};

export type ResearchDocumentRequest = {
  url: string;
  code?: string;
  title?: string;
  source?: string;
};

export type AccountSession = {
  authenticated: boolean;
  account: {
    userId: string;
    email: string | null;
    username: string;
    name: string;
    accountId: string | null;
    broker: string | null;
    holdingsCount: number;
    sessionExpiresAt: string;
  } | null;
};

export type AccountPortfolio = {
  account: NonNullable<AccountSession["account"]>;
  brokerSnapshot: PortfolioBrokerSnapshot;
  holdings: PortfolioHolding[];
};

export type AddPortfolioHoldingInput = {
  code: string;
  name: string;
  market: "A" | "HK";
  channel: string;
  sector: string;
  themes: string[];
  currency: "CNY" | "HKD";
  shares: number;
  availableShares: number;
  screenshotPrice: number;
  costPrice: number;
  averageBuyPrice: number;
  fxRateToCny: number;
  thesis: string;
  watch: string[];
};

export type UpdatePortfolioHoldingInput = AddPortfolioHoldingInput;

type PortfolioAccountRow = {
  id: string;
  name: string | null;
  broker: string | null;
};

type PortfolioSnapshotRow = {
  source: string | null;
  as_of: string | null;
  today_pnl: number | string | null;
  today_pnl_pct: number | string | null;
  total_market_value_cny: number | string | null;
  total_pnl: number | string | null;
};

type PortfolioHoldingRow = {
  code: string;
  name: string;
  market: string;
  channel: string | null;
  sector: string | null;
  themes: string[] | null;
  currency: string;
  shares: number | string | null;
  available_shares: number | string | null;
  screenshot_price: number | string | null;
  cost_price: number | string | null;
  average_buy_price: number | string | null;
  broker_market_value_cny: number | string | null;
  broker_total_pnl: number | string | null;
  broker_total_pnl_pct: number | string | null;
  fx_rate_to_cny: number | string | null;
  thesis: string | null;
  watch: string[] | null;
};

export function hasIfindEndpoint() {
  return typeof EventSource !== "undefined";
}

export function isSupabaseConfigured() {
  return Boolean(supabase);
}

export async function fetchDataProviders(sampleCode?: string): Promise<DataProvider[] | null> {
  const suffix = sampleCode ? `?sample=${encodeURIComponent(sampleCode)}` : "";
  const response = await fetch(apiUrl(`/api/providers${suffix}`), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`data provider request failed: ${response.status}`);
  }

  const payload = (await response.json()) as { providers: DataProvider[] };
  return payload.providers;
}

export async function fetchAccountSession(): Promise<AccountSession> {
  if (!supabase) {
    return { authenticated: false, account: null };
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  if (!data.session) return { authenticated: false, account: null };

  return {
    authenticated: true,
    account: {
      userId: data.session.user.id,
      email: data.session.user.email ?? null,
      username: identityLabel(data.session.user.email, data.session.user.id),
      name: identityLabel(data.session.user.email, data.session.user.id),
      accountId: null,
      broker: null,
      holdingsCount: 0,
      sessionExpiresAt: data.session.expires_at
        ? new Date(data.session.expires_at * 1000).toISOString()
        : new Date(Date.now() + 60 * 60 * 1000).toISOString()
    }
  };
}

export async function loginAccount(username: string, password: string): Promise<AccountSession> {
  if (!supabase) {
    throw new Error("Supabase 未配置：请设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。");
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: username,
    password
  });

  if (error) throw new Error(error.message);
  return fetchAccountSession();
}

export async function logoutAccount(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function addPortfolioHolding(input: AddPortfolioHoldingInput): Promise<string> {
  if (!supabase) {
    throw new Error("Supabase 未配置，无法写入个人持仓。");
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  const session = sessionData.session;
  if (!session) throw new Error("未登录，无法写入个人持仓。");

  const userId = session.user.id;
  const account = await ensurePortfolioAccount(userId);
  const normalized = normalizeHoldingInput(input);

  const { count } = await supabase
    .from("portfolio_holdings")
    .select("id", { count: "exact", head: true })
    .eq("account_id", account.id);

  const row = holdingRowPayload(userId, account.id, normalized, ((count ?? 0) + 1) * 10);

  const { error } = await supabase
    .from("portfolio_holdings")
    .upsert(row, { onConflict: "account_id,code" });

  if (error) throw formatSupabaseSetupError(error, "portfolio_holdings");
  return normalized.code;
}

export async function updatePortfolioHolding(
  originalCode: string,
  input: UpdatePortfolioHoldingInput
): Promise<string> {
  if (!supabase) {
    throw new Error("Supabase 未配置，无法更新个人持仓。");
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  const session = sessionData.session;
  if (!session) throw new Error("未登录，无法更新个人持仓。");

  const userId = session.user.id;
  const account = await requirePortfolioAccount(userId);
  const normalized = normalizeHoldingInput(input);
  const row = holdingRowPayload(userId, account.id, normalized);

  const { data, error } = await supabase
    .from("portfolio_holdings")
    .update(row)
    .eq("user_id", userId)
    .eq("account_id", account.id)
    .eq("code", normalizeHoldingCode(originalCode))
    .select("code")
    .maybeSingle<{ code: string }>();

  if (error) throw formatSupabaseSetupError(error, "portfolio_holdings");
  if (!data) throw new Error("未找到要更新的持仓，可能已被删除或不属于当前账户。");
  return normalized.code;
}

export async function deletePortfolioHolding(code: string): Promise<void> {
  if (!supabase) {
    throw new Error("Supabase 未配置，无法删除个人持仓。");
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  const session = sessionData.session;
  if (!session) throw new Error("未登录，无法删除个人持仓。");

  const userId = session.user.id;
  const account = await requirePortfolioAccount(userId);
  const { error } = await supabase
    .from("portfolio_holdings")
    .delete()
    .eq("user_id", userId)
    .eq("account_id", account.id)
    .eq("code", normalizeHoldingCode(code));

  if (error) throw formatSupabaseSetupError(error, "portfolio_holdings");
}

export async function fetchAccountPortfolio(): Promise<AccountPortfolio> {
  if (!supabase) {
    throw new Error("Supabase 未配置，无法读取个人持仓。");
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  const session = sessionData.session;
  if (!session) throw new Error("未登录，无法读取个人持仓。");

  const userId = session.user.id;
  const accountResult = await supabase
    .from("portfolio_accounts")
    .select("id,name,broker")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<PortfolioAccountRow>();

  if (accountResult.error) throw formatSupabaseSetupError(accountResult.error, "portfolio_accounts");

  const accountRow = accountResult.data;
  if (!accountRow) {
    return {
      account: accountPayloadFromSupabase({
        userId,
        email: session.user.email ?? null,
        accountId: null,
        accountName: "未绑定组合账户",
        broker: null,
        holdingsCount: 0,
        expiresAt: session.expires_at
      }),
      brokerSnapshot: emptyBrokerSnapshot(),
      holdings: []
    };
  }

  const [holdingsResult, snapshotResult] = await Promise.all([
    supabase
      .from("portfolio_holdings")
      .select(
        [
          "code",
          "name",
          "market",
          "channel",
          "sector",
          "themes",
          "currency",
          "shares",
          "available_shares",
          "screenshot_price",
          "cost_price",
          "average_buy_price",
          "broker_market_value_cny",
          "broker_total_pnl",
          "broker_total_pnl_pct",
          "fx_rate_to_cny",
          "thesis",
          "watch"
        ].join(",")
      )
      .eq("account_id", accountRow.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("portfolio_snapshots")
      .select("source,as_of,today_pnl,today_pnl_pct,total_market_value_cny,total_pnl")
      .eq("account_id", accountRow.id)
      .order("as_of", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<PortfolioSnapshotRow>()
  ]);

  if (holdingsResult.error) throw formatSupabaseSetupError(holdingsResult.error, "portfolio_holdings");
  if (snapshotResult.error) throw formatSupabaseSetupError(snapshotResult.error, "portfolio_snapshots");

  const holdings = ((holdingsResult.data ?? []) as unknown as PortfolioHoldingRow[]).map(holdingFromRow);
  return {
    account: accountPayloadFromSupabase({
      userId,
      email: session.user.email ?? null,
      accountId: accountRow.id,
      accountName: accountRow.name,
      broker: accountRow.broker,
      holdingsCount: holdings.length,
      expiresAt: session.expires_at
    }),
    brokerSnapshot: brokerSnapshotFromRow(snapshotResult.data, accountRow),
    holdings
  };
}

async function ensurePortfolioAccount(userId: string): Promise<PortfolioAccountRow> {
  if (!supabase) throw new Error("Supabase 未配置，无法读取组合账户。");

  const account = await getPortfolioAccount(userId);
  if (account) return account;

  const insertResult = await supabase
    .from("portfolio_accounts")
    .insert({
      user_id: userId,
      name: "主账户",
      broker: "手动录入",
      base_currency: "CNY"
    })
    .select("id,name,broker")
    .single<PortfolioAccountRow>();

  if (insertResult.error) throw formatSupabaseSetupError(insertResult.error, "portfolio_accounts");
  return insertResult.data;
}

async function requirePortfolioAccount(userId: string): Promise<PortfolioAccountRow> {
  const account = await getPortfolioAccount(userId);
  if (!account) throw new Error("未找到组合账户，请先添加一笔持仓初始化账户。");
  return account;
}

async function getPortfolioAccount(userId: string): Promise<PortfolioAccountRow | null> {
  if (!supabase) throw new Error("Supabase 未配置，无法读取组合账户。");

  const accountResult = await supabase
    .from("portfolio_accounts")
    .select("id,name,broker")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<PortfolioAccountRow>();

  if (accountResult.error) throw formatSupabaseSetupError(accountResult.error, "portfolio_accounts");
  return accountResult.data ?? null;
}

function normalizeHoldingInput(input: AddPortfolioHoldingInput): AddPortfolioHoldingInput {
  const code = normalizeHoldingCode(input.code);
  const hkCode = code.match(/^H\d{5}$/);
  const market = input.market === "HK" || hkCode ? "HK" : "A";
  const currency = market === "HK" ? "HKD" : "CNY";
  const shares = Math.max(0, toNumber(input.shares));
  const availableShares = Math.max(0, toNumber(input.availableShares, shares));
  const screenshotPrice = Math.max(0, toNumber(input.screenshotPrice));
  const costPrice = Math.max(0, toNumber(input.costPrice));
  const averageBuyPrice = Math.max(0, toNumber(input.averageBuyPrice, costPrice));
  const fxRateToCny = Math.max(0, toNumber(input.fxRateToCny, market === "HK" ? 0.9 : 1));

  if (!code) throw new Error("请填写股票代码。");
  if (!input.name.trim()) throw new Error("请填写股票名称，或先从股票池补全。");
  if (shares <= 0) throw new Error("持仓数量必须大于 0。");

  return {
    ...input,
    code,
    name: input.name.trim(),
    market,
    channel: input.channel.trim() || (market === "HK" ? "港股通/港股" : "A股"),
    sector: input.sector.trim() || "未分类",
    themes: input.themes.map((item) => item.trim()).filter(Boolean),
    currency,
    shares,
    availableShares,
    screenshotPrice,
    costPrice,
    averageBuyPrice,
    fxRateToCny,
    thesis: input.thesis.trim() || "手动录入持仓，等待补充持仓逻辑。",
    watch: input.watch.map((item) => item.trim()).filter(Boolean)
  };
}

function normalizeHoldingCode(code: string) {
  const rawCode = code.trim().toUpperCase();
  const hkCode = rawCode.match(/^(?:HK|H)?(\d{5})$/);
  return hkCode ? `H${hkCode[1]}` : rawCode;
}

function holdingRowPayload(
  userId: string,
  accountId: string,
  normalized: AddPortfolioHoldingInput,
  sortOrder?: number
) {
  const marketValueCny = normalized.shares * normalized.screenshotPrice * normalized.fxRateToCny;
  const costBasisCny = normalized.shares * normalized.costPrice * normalized.fxRateToCny;
  const brokerTotalPnl = marketValueCny - costBasisCny;
  const brokerTotalPnlPct = costBasisCny ? (brokerTotalPnl / costBasisCny) * 100 : 0;

  return {
    user_id: userId,
    account_id: accountId,
    code: normalized.code,
    name: normalized.name,
    market: normalized.market,
    channel: normalized.channel,
    sector: normalized.sector,
    themes: normalized.themes,
    currency: normalized.currency,
    shares: normalized.shares,
    available_shares: normalized.availableShares,
    screenshot_price: normalized.screenshotPrice,
    cost_price: normalized.costPrice,
    average_buy_price: normalized.averageBuyPrice,
    broker_market_value_cny: Number(marketValueCny.toFixed(2)),
    broker_total_pnl: Number(brokerTotalPnl.toFixed(2)),
    broker_total_pnl_pct: Number(brokerTotalPnlPct.toFixed(2)),
    fx_rate_to_cny: normalized.fxRateToCny,
    thesis: normalized.thesis,
    watch: normalized.watch,
    ...(sortOrder == null ? {} : { sort_order: sortOrder })
  };
}

function formatSupabaseSetupError(error: { message?: string; code?: string }, tableName: string) {
  const message = error.message ?? "";
  const schemaCacheMiss =
    error.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("Could not find the table");

  if (schemaCacheMiss) {
    return new Error(
      `Supabase 数据表未初始化或 schema cache 尚未刷新：缺少 public.${tableName}。请在 Supabase SQL Editor 执行 supabase/migrations/202607020001_portfolio_auth.sql，完成后刷新页面。`
    );
  }

  return new Error(message || `Supabase 查询失败：${tableName}`);
}

function accountPayloadFromSupabase({
  userId,
  email,
  accountId,
  accountName,
  broker,
  holdingsCount,
  expiresAt
}: {
  userId: string;
  email: string | null;
  accountId: string | null;
  accountName: string | null | undefined;
  broker: string | null;
  holdingsCount: number;
  expiresAt?: number;
}): NonNullable<AccountSession["account"]> {
  const username = identityLabel(email, userId);
  return {
    userId,
    email,
    username,
    name: accountName || username,
    accountId,
    broker,
    holdingsCount,
    sessionExpiresAt: expiresAt
      ? new Date(expiresAt * 1000).toISOString()
      : new Date(Date.now() + 60 * 60 * 1000).toISOString()
  };
}

function identityLabel(email: string | null | undefined, userId: string) {
  return email || `UID ${userId.slice(0, 8)}`;
}

function toNumber(value: number | string | null | undefined, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function emptyBrokerSnapshot(): PortfolioBrokerSnapshot {
  return {
    source: "Supabase 持仓库",
    asOf: new Date().toISOString().slice(0, 10),
    todayPnl: 0,
    todayPnlPct: 0,
    totalMarketValueCny: 0,
    totalPnl: 0
  };
}

function brokerSnapshotFromRow(
  row: PortfolioSnapshotRow | null,
  account: PortfolioAccountRow
): PortfolioBrokerSnapshot {
  if (!row) {
    return {
      ...emptyBrokerSnapshot(),
      source: account.broker ? `${account.broker} / Supabase` : "Supabase 持仓库"
    };
  }

  return {
    source: row.source || account.broker || "Supabase 持仓库",
    asOf: row.as_of || new Date().toISOString().slice(0, 10),
    todayPnl: toNumber(row.today_pnl),
    todayPnlPct: toNumber(row.today_pnl_pct),
    totalMarketValueCny: toNumber(row.total_market_value_cny),
    totalPnl: toNumber(row.total_pnl)
  };
}

function holdingFromRow(row: PortfolioHoldingRow): PortfolioHolding {
  return {
    code: row.code,
    name: row.name,
    market: row.market === "HK" ? "HK" : "A",
    channel: row.channel ?? (row.market === "HK" ? "港股" : "A股"),
    sector: row.sector ?? "未分类",
    themes: Array.isArray(row.themes) ? row.themes : [],
    currency: row.currency === "HKD" ? "HKD" : "CNY",
    shares: toNumber(row.shares),
    availableShares: toNumber(row.available_shares),
    screenshotPrice: toNumber(row.screenshot_price),
    costPrice: toNumber(row.cost_price),
    averageBuyPrice: toNumber(row.average_buy_price),
    brokerMarketValueCny: toNumber(row.broker_market_value_cny),
    brokerTotalPnl: toNumber(row.broker_total_pnl),
    brokerTotalPnlPct: toNumber(row.broker_total_pnl_pct),
    fxRateToCny: toNumber(row.fx_rate_to_cny, row.currency === "HKD" ? 0.9 : 1),
    thesis: row.thesis ?? "等待补充持仓逻辑。",
    watch: Array.isArray(row.watch) ? row.watch : []
  };
}

export async function fetchIfindSnapshot(code: string): Promise<StockProfile | null> {
  const response = await fetch(apiUrl(`/api/market/snapshot/${encodeURIComponent(code)}`), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`market snapshot request failed: ${response.status}`);
  }

  return (await response.json()) as StockProfile;
}

export async function fetchMarketIndexes(): Promise<MarketIndex[] | null> {
  const response = await fetch(apiUrl("/api/market/indexes"), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`market indexes request failed: ${response.status}`);
  }

  return (await response.json()) as MarketIndex[];
}

export async function fetchMarketKline(code: string, period: KlinePeriod): Promise<KlinePayload | null> {
  const response = await fetch(apiUrl(`/api/market/kline/${encodeURIComponent(code)}?period=${period}`), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`market kline request failed: ${response.status}`);
  }

  return (await response.json()) as KlinePayload;
}

export async function fetchMarketUniverse(options: {
  query?: string;
  market?: "ALL" | "A" | "HK";
  limit?: number;
} = {}): Promise<{
  items: MarketSecurity[];
  total: number;
  matched: number;
  source: string;
  refreshedAt: string;
  coverage: { A: number; HK: number };
} | null> {
  const params = new URLSearchParams();
  if (options.query) params.set("q", options.query);
  if (options.market && options.market !== "ALL") params.set("market", options.market);
  if (options.limit) params.set("limit", String(options.limit));

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(apiUrl(`/api/market/universe${suffix}`), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`market universe request failed: ${response.status}`);
  }

  return (await response.json()) as {
    items: MarketSecurity[];
    total: number;
    matched: number;
    source: string;
    refreshedAt: string;
    coverage: { A: number; HK: number };
  };
}

export async function fetchIfindResearchUniverse(): Promise<CompanyResearch[] | null> {
  if (!DATA_API_BASE) {
    return null;
  }

  const response = await fetch(apiUrl("/api/ifind/research/universe"), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`iFinD research universe request failed: ${response.status}`);
  }

  return (await response.json()) as CompanyResearch[];
}

export async function fetchIfindReports(code: string): Promise<ResearchReportDigest[] | null> {
  if (!DATA_API_BASE) {
    return null;
  }

  const response = await fetch(apiUrl(`/api/ifind/research/reports/${code}?window=18m`), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`iFinD reports request failed: ${response.status}`);
  }

  return (await response.json()) as ResearchReportDigest[];
}

export async function fetchHkResearchIndex(code: string): Promise<HkResearchIndex | null> {
  const response = await fetch(apiUrl(`/api/research/hk/${encodeURIComponent(code)}`), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`HK research index request failed: ${response.status}`);
  }

  return (await response.json()) as HkResearchIndex;
}

export async function fetchResearchDocument(input: ResearchDocumentRequest): Promise<ResearchDocumentExtraction | null> {
  const params = new URLSearchParams();
  params.set("url", input.url);
  if (input.code) params.set("code", input.code);
  if (input.title) params.set("title", input.title);
  if (input.source) params.set("source", input.source);

  const response = await fetch(apiUrl(`/api/research/document?${params.toString()}`), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`research document extraction request failed: ${response.status}`);
  }

  return (await response.json()) as ResearchDocumentExtraction;
}

export async function fetchIfindThemes(): Promise<ThemeCluster[] | null> {
  const response = await fetch(apiUrl("/api/market/themes?limit=8"), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`market themes request failed: ${response.status}`);
  }

  const payload = (await response.json()) as { themes: ThemeCluster[] };
  return payload.themes;
}

export function connectIfindStream(
  codes: string[],
  onMessage: (event: LiveEvent) => void,
  onStateChange?: (state: DataConnectionState) => void
) {
  if (typeof EventSource === "undefined") {
    onStateChange?.("seed");
    return () => undefined;
  }

  onStateChange?.("connecting");
  const stream = new EventSource(
    apiUrl(`/api/market/stream?codes=${encodeURIComponent(codes.join(","))}`)
  );

  stream.onopen = () => onStateChange?.("connected");
  stream.onerror = () => onStateChange?.("error");
  stream.onmessage = (message) => {
    try {
      onMessage(JSON.parse(message.data) as LiveEvent);
    } catch {
      onStateChange?.("error");
    }
  };

  return () => stream.close();
}
