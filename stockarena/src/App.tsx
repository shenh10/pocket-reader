import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Gauge,
  Layers,
  LineChart,
  Lock,
  LogOut,
  Newspaper,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Target,
  TrendingDown,
  TrendingUp,
  Trash2,
  X
} from "lucide-react";
import {
  marketIndexes,
  sectorHeat,
  stocks,
  strategyWeights,
  type FundamentalProfile,
  type KlineBar,
  type KlinePayload,
  type KlinePeriod,
  type LiveEvent,
  type MarketSecurity,
  type StockProfile
} from "./data/market";
import {
  type PortfolioBrokerSnapshot,
  type PortfolioHolding
} from "./data/portfolio";
import {
  analysisFramework,
  companyResearch,
  dataSourceLayers,
  getReportsByCode,
  getResearchByCode,
  hkResearchSources,
  reportDigests,
  themeClusters,
  type CompanyResearch,
  type HkResearchSource,
  type ResearchReportDigest,
  type ThemeCluster
} from "./data/research";
import {
  connectIfindStream,
  addPortfolioHolding,
  deletePortfolioHolding,
  fetchAccountPortfolio,
  fetchAccountSession,
  fetchDataProviders,
  fetchHkResearchIndex,
  fetchIfindThemes,
  fetchIfindSnapshot,
  fetchMarketKline,
  fetchMarketIndexes,
  fetchMarketUniverse,
  fetchResearchDocument,
  hasIfindEndpoint,
  isSupabaseConfigured,
  loginAccount,
  logoutAccount,
  updatePortfolioHolding,
  type AddPortfolioHoldingInput,
  type AccountPortfolio,
  type AccountSession,
  type DataProvider,
  type HkResearchIndex,
  type IfindConnectionState,
  type ResearchDocumentExtraction,
  type ResearchDocumentRequest
} from "./services/ifind";

const currencyFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const integerFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0
});

const PORTFOLIO_REFRESH_MS = 60_000;

type PortfolioRefreshState = "idle" | "refreshing" | "error";

type PortfolioRefreshMeta = {
  state: PortfolioRefreshState;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  nextRefreshAt: string | null;
  successCount: number;
  failedCount: number;
  reason: "启动刷新" | "自动刷新" | "手动刷新";
  error: string | null;
};

type MetricMode = "neutral" | "good" | "risk" | "watch" | "missing";

type HkResearchLoadState = {
  loading: boolean;
  error: string | null;
};

type DocumentExtractionEntry = {
  state: "loading" | "ready" | "error";
  data?: ResearchDocumentExtraction;
  error?: string;
};

type HoldingEditorState =
  | { mode: "create" }
  | { mode: "edit"; holding: PortfolioHolding }
  | null;

type ResearchCoverageTarget = {
  code: string;
  name: string;
  market: "A" | "HK";
  sector: string;
};

function formatPct(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

type FundamentalField = keyof FundamentalProfile;

const quoteOnlyMissingFields = new Set<FundamentalField>([
  "roe",
  "revenueYoy",
  "profitYoy",
  "grossMargin",
  "debtRatio",
  "ocfToProfit",
  "dividendYield"
]);

function isKnownNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMissingFundamental(stock: StockProfile, field: FundamentalField, value: number | null | undefined) {
  if (!isKnownNumber(value)) return true;
  if ((field === "pe" || field === "pb") && value <= 0) return true;
  return Boolean(stock.dataQuality && quoteOnlyMissingFields.has(field) && value === 0);
}

function fundamentalMetric(
  stock: StockProfile,
  field: FundamentalField,
  label: string,
  formatter: (value: number) => string,
  helper: string,
  missingHelper: string,
  modeForValue: (value: number) => MetricMode
) {
  const value = stock.fundamentals[field];
  if (isMissingFundamental(stock, field, value)) {
    return { label, value: "--", helper: missingHelper, mode: "missing" as const };
  }

  const numericValue = value as number;
  return {
    label,
    value: formatter(numericValue),
    helper,
    mode: modeForValue(numericValue)
  };
}

function formatMoney(value: number, prefix = "¥") {
  const sign = value < 0 ? "-" : "";
  return `${sign}${prefix}${currencyFormatter.format(Math.abs(value))}`;
}

function formatPrice(value: number, currency: "CNY" | "HKD" = "CNY") {
  return formatMoney(value, currency === "HKD" ? "HK$" : "¥");
}

function formatTime(value?: string | null) {
  if (!value) return "未刷新";
  return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}

function formatCountdown(nextRefreshAt: string | null, now: number) {
  if (!nextRefreshAt) return "--";
  const seconds = Math.max(0, Math.ceil((new Date(nextRefreshAt).getTime() - now) / 1000));
  return seconds <= 0 ? "即将刷新" : `${seconds}s`;
}

function shortId(value?: string | null) {
  if (!value) return "未绑定";
  return value.length <= 12 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function toneClass(value: number) {
  if (value > 0) return "is-up";
  if (value < 0) return "is-down";
  return "is-flat";
}

function scoreBand(score: number) {
  if (score >= 82) return "强";
  if (score >= 72) return "稳";
  if (score >= 60) return "中";
  return "弱";
}

const klinePeriods: Array<{ value: KlinePeriod; label: string }> = [
  { value: "day", label: "日" },
  { value: "week", label: "周" },
  { value: "month", label: "月" },
  { value: "year", label: "年" }
];

function connectionLabel(state: IfindConnectionState) {
  if (state === "connected") return "多源数据网关";
  if (state === "connecting") return "连接数据网关";
  if (state === "error") return "网关异常";
  return "公开研报种子库";
}

function streamLabel(state: IfindConnectionState) {
  if (state === "connected") return "SSE通道已连接";
  if (state === "connecting") return "SSE连接中";
  if (state === "error") return "SSE重试中";
  return "研报事件回放";
}

function reportToEvent(report: ResearchReportDigest): LiveEvent {
  return {
    id: report.id,
    time: report.date,
    source: "研报",
    stockCode: report.code,
    stockName: report.stockName,
    title: `${report.signal} · ${report.title}`,
    tone: report.signal === "下修" ? "negative" : report.signal === "分歧" ? "neutral" : "positive",
    impact: report.signal === "上修" ? 88 : report.signal === "下修" ? 76 : 68
  };
}

function Sparkline({ data, accent = "var(--rise)" }: { data: number[]; accent?: string }) {
  const width = 154;
  const height = 52;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const spread = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value - min) / spread) * (height - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="价格走势">
      <polyline points={points} fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function barsFromTechnicals(stock: StockProfile): KlineBar[] {
  return stock.technicals.close.map((close, index, closes) => {
    const open = index === 0 ? close : closes[index - 1];
    const high = Math.max(open, close);
    const low = Math.min(open, close);
    return {
      date: String(index + 1),
      open,
      close,
      high,
      low,
      volume: stock.technicals.volume[index] ?? 0,
      amount: 0,
      amplitude: 0,
      pct: open ? ((close - open) / open) * 100 : 0,
      change: close - open,
      turnover: stock.technicals.turnoverRate
    };
  });
}

function formatKlineDateLabel(date: string, period?: KlinePeriod) {
  if (!date.includes("-")) return date;
  const [year, month, day] = date.split("-");
  if (period === "year") return year;
  if (period === "month") return `${year}-${month}`;
  return `${month}-${day}`;
}

function tickIndexes(length: number, maxTicks = 5) {
  if (length <= 1) return [0];
  const count = Math.min(maxTicks, length);
  return Array.from({ length: count }, (_, index) => Math.round((index / (count - 1)) * (length - 1)))
    .filter((value, index, values) => values.indexOf(value) === index);
}

function PriceChart({ stock, kline }: { stock: StockProfile; kline?: KlinePayload | null }) {
  const bars = kline?.items?.length ? kline.items : barsFromTechnicals(stock);
  const technicals = kline?.technicals ?? stock.technicals;
  const data = bars.map((bar) => bar.close);
  const width = 720;
  const plotHeight = 238;
  const axisHeight = 34;
  const height = plotHeight + axisHeight;
  const leftPad = 10;
  const rightPad = 58;
  const plotWidth = width - leftPad - rightPad;
  const min = Math.min(...bars.flatMap((bar) => [bar.low, bar.open, bar.close]), technicals.support) * 0.985;
  const max = Math.max(...bars.flatMap((bar) => [bar.high, bar.open, bar.close]), technicals.resistance) * 1.015;
  const spread = max - min || 1;
  const xFor = (index: number) => leftPad + (index / Math.max(1, bars.length - 1)) * plotWidth;
  const yFor = (value: number) => plotHeight - ((value - min) / spread) * (plotHeight - 28) - 14;
  const line = data.map((value, index) => `${xFor(index)},${yFor(value)}`).join(" ");
  const ma20Y = yFor(technicals.ma20);
  const ma60Y = yFor(technicals.ma60);
  const supportY = yFor(technicals.support);
  const resistanceY = yFor(technicals.resistance);
  const candleWidth = Math.max(4, Math.min(13, plotWidth / Math.max(12, bars.length) * 0.5));
  const yTicks = [max, (max + min) / 2, min];
  const xTicks = tickIndexes(bars.length);

  return (
    <svg className="price-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${stock.name} 技术走势`}>
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line key={ratio} x1={leftPad} x2={width - rightPad} y1={plotHeight * ratio} y2={plotHeight * ratio} className="chart-grid" />
      ))}
      {yTicks.map((value) => (
        <g key={value}>
          <line x1={leftPad} x2={width - rightPad} y1={yFor(value)} y2={yFor(value)} className="chart-grid faint" />
          <text x={width - 46} y={yFor(value) + 4} className="chart-axis-label">
            {value.toFixed(value >= 100 ? 1 : 2)}
          </text>
        </g>
      ))}
      {bars.map((bar, index) => {
        const x = xFor(index);
        const isUp = bar.close >= bar.open;
        const yOpen = yFor(bar.open);
        const yClose = yFor(bar.close);
        const bodyTop = Math.min(yOpen, yClose);
        const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));
        return (
          <g className={`candle ${isUp ? "up" : "down"}`} key={`${bar.date}-${index}`}>
            <line x1={x} x2={x} y1={yFor(bar.high)} y2={yFor(bar.low)} />
            <rect
              x={x - candleWidth / 2}
              y={bodyTop}
              width={candleWidth}
              height={bodyHeight}
              rx="1.5"
            />
          </g>
        );
      })}
      <line x1={leftPad} x2={width - rightPad} y1={ma20Y} y2={ma20Y} className="ma-line ma20" />
      <line x1={leftPad} x2={width - rightPad} y1={ma60Y} y2={ma60Y} className="ma-line ma60" />
      <line x1={leftPad} x2={width - rightPad} y1={supportY} y2={supportY} className="level-line support" />
      <line x1={leftPad} x2={width - rightPad} y1={resistanceY} y2={resistanceY} className="level-line resistance" />
      <polyline points={line} fill="none" stroke="rgba(23, 28, 25, 0.72)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1={leftPad} x2={width - rightPad} y1={plotHeight + 1} y2={plotHeight + 1} className="chart-axis-line" />
      {xTicks.map((index) => (
        <g key={`${bars[index]?.date}-${index}`}>
          <line x1={xFor(index)} x2={xFor(index)} y1={plotHeight + 1} y2={plotHeight + 6} className="chart-axis-line" />
          <text x={xFor(index)} y={plotHeight + 24} textAnchor={index === 0 ? "start" : index === bars.length - 1 ? "end" : "middle"} className="chart-axis-label">
            {formatKlineDateLabel(bars[index]?.date ?? "", kline?.period)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function VolumeBars({ data }: { data: number[] }) {
  const max = Math.max(...data);
  return (
    <div className="volume-bars" aria-label="成交量">
      {data.map((value, index) => (
        <span
          key={`${value}-${index}`}
          style={{ height: `${max > 0 ? Math.max(16, (value / max) * 100) : 16}%` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function ScoreDial({ score, label }: { score: number; label: string }) {
  return (
    <div className="score-dial" style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}>
      <div>
        <strong>{score}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  helper,
  mode = "neutral"
}: {
  label: string;
  value: string;
  helper: string;
  mode?: MetricMode;
}) {
  return (
    <div className={`metric-tile ${mode}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  );
}

function stockReasonLine(item: CompanyResearch, stock?: StockProfile) {
  const primaryTheme = item.themes[0] ?? item.sector;
  if (stock) {
    return `${primaryTheme}：实时${formatPct(stock.changePct)}，${item.reportTrend}共识与行情同步观察`;
  }
  if (item.reportTrend === "上修") {
    return `${primaryTheme}：研报/业绩预期上修，题材兑现度较高`;
  }
  if (item.reportTrend === "下修") {
    return `${primaryTheme}：盈利预测下修，先等风险出清`;
  }
  if (item.reportTrend === "分歧") {
    return `${primaryTheme}：逻辑仍在，但机构分歧需要验证`;
  }
  return `${primaryTheme}：趋势维持，重点看催化是否重新增强`;
}

function securityReasonLine(item: MarketSecurity, stock?: StockProfile) {
  const theme = item.themes[0] ?? item.sector;
  if (stock) {
    return `${theme}：已拉取多源快照，${stock.action}，可信度 ${stock.dataQuality?.quoteConfidence ?? "--"}/100`;
  }
  return `${theme}：来自全市场股票池，选中后拉取实时快照、K线和交易计划`;
}

function buildRecommendation(research?: CompanyResearch, stock?: StockProfile, reports: ResearchReportDigest[] = []) {
  if (!research) {
    return {
      score: stock?.score ?? 0,
      verdict: stock?.action ?? "待补全",
      tone: "watch" as const,
      reasons: stock ? [stock.thesis] : ["等待研报、题材和行情数据源补全。"],
      watch: ["研报覆盖", "实时行情", "财务指标"],
      risks: ["数据源缺口"]
    };
  }

  const trendScore = { 上修: 90, 维持: 70, 分歧: 58, 下修: 35 }[research.reportTrend];
  const score = Math.round(
    research.themeScore * 0.34 +
      research.fundamentalScore * 0.24 +
      trendScore * 0.24 +
      (100 - research.riskScore) * 0.18
  );
  const verdict =
    score >= 82 ? "优先跟踪" : score >= 72 ? "分批观察" : score >= 60 ? "等待确认" : "风险警惕";
  const tone = score >= 82 ? "good" : score >= 72 ? "watch" : score >= 60 ? "neutral" : "risk";
  const reportRisk = reports.flatMap((report) => report.risks).slice(0, 4);
  const risks = reportRisk.length > 0 ? Array.from(new Set(reportRisk)) : ["估值拥挤", "业绩兑现不及预期"];
  const reasons = [
    `研报趋势：${research.reportTrend}，${research.reportCount} 份公开资料形成“${research.consensus}”。`,
    `题材位置：${research.themes.slice(0, 3).join(" / ")}，公司定位是${research.role}。`,
    `质量与风险：基本面分 ${research.fundamentalScore}，风险折扣 ${research.riskScore}，决定仓位节奏。`,
    stock
      ? `行情确认：当前 ${currencyFormatter.format(stock.price)}，${formatPct(stock.changePct)}，${stock.dataQuality ? `${stock.dataQuality.quoteConsensus}、可信度 ${stock.dataQuality.quoteConfidence}` : "等待多源校验"}。`
      : "行情确认：等待数据网关快照，当前只依据研报和题材做研究排序。"
  ];

  return {
    score,
    verdict,
    tone,
    reasons,
    watch: research.monitor,
    risks
  };
}

type HoldingAnalysis = {
  holding: PortfolioHolding;
  stock?: StockProfile;
  livePrice: number;
  marketValueCny: number;
  costBasisCny: number;
  pnl: number;
  pnlPct: number;
  dayPnl: number;
  weight: number;
  action: "停止补仓" | "等待修复" | "反弹降风险" | "纪律止损" | "分批止盈" | "保留核心" | "持有观察";
  tone: "good" | "watch" | "risk" | "neutral";
  priority: number;
  reasons: string[];
  execution: string[];
};

function holdingValueCny(holding: PortfolioHolding, price: number) {
  return holding.shares * price * holding.fxRateToCny;
}

function buildHoldingBase(holding: PortfolioHolding, stock?: StockProfile) {
  const livePrice = stock?.price ?? holding.screenshotPrice;
  const marketValueCny = holdingValueCny(holding, livePrice);
  const costBasisCny = holdingValueCny(holding, holding.costPrice);
  const pnl = marketValueCny - costBasisCny;
  const pnlPct = costBasisCny ? (pnl / costBasisCny) * 100 : holding.brokerTotalPnlPct;
  const changePct = stock?.changePct ?? 0;
  const previousValue = changePct === -100 ? marketValueCny : marketValueCny / (1 + changePct / 100);
  const dayPnl = stock ? marketValueCny - previousValue : 0;

  return {
    holding,
    stock,
    livePrice,
    marketValueCny,
    costBasisCny,
    pnl,
    pnlPct,
    dayPnl
  };
}

function completeHoldingAnalysis(
  base: ReturnType<typeof buildHoldingBase>,
  totalMarketValueCny: number
): HoldingAnalysis {
  const { holding, stock, livePrice, marketValueCny, costBasisCny, pnl, pnlPct, dayPnl } = base;
  const weight = totalMarketValueCny ? (marketValueCny / totalMarketValueCny) * 100 : 0;
  const technicals = stock?.technicals;
  const quoteConfidence = stock?.dataQuality?.quoteConfidence ?? 0;
  const belowMa60 = Boolean(stock && technicals && technicals.ma60 > 0 && livePrice < technicals.ma60);
  const aboveMa20 = Boolean(stock && technicals && technicals.ma20 > 0 && livePrice >= technicals.ma20);
  const belowMa20 = Boolean(stock && technicals && technicals.ma20 > 0 && livePrice < technicals.ma20);
  const brokenSupport = Boolean(stock && technicals && technicals.support > 0 && livePrice < technicals.support * 0.995);
  const weakMomentum = Boolean(technicals && technicals.macd < 0 && technicals.rsi < 45);
  const rsiHot = Boolean(technicals && technicals.rsi >= 70);
  const deepLoss = pnlPct <= -35;
  const largeLoss = pnlPct <= -20;
  const highProfit = pnlPct >= 50;
  const concentrated = weight >= 28;
  const thesisAtRisk = Boolean(stock?.tradingPlan?.action === "风险警惕" && quoteConfidence >= 72);

  let action: HoldingAnalysis["action"] = "持有观察";
  let tone: HoldingAnalysis["tone"] = "neutral";
  let priority = 40;

  if (quoteConfidence > 0 && quoteConfidence < 72) {
    action = "持有观察";
    tone = "watch";
    priority = 74;
  } else if (highProfit && (rsiHot || weight >= 12)) {
    action = "分批止盈";
    tone = "watch";
    priority = 78;
  } else if (deepLoss && thesisAtRisk && (brokenSupport || weakMomentum)) {
    action = "纪律止损";
    tone = "risk";
    priority = concentrated ? 94 : 86;
  } else if (deepLoss && concentrated) {
    action = "反弹降风险";
    tone = "watch";
    priority = 90;
  } else if (deepLoss && (belowMa60 || belowMa20)) {
    action = "等待修复";
    tone = "watch";
    priority = 82;
  } else if (largeLoss && belowMa20) {
    action = "停止补仓";
    tone = "watch";
    priority = 72;
  } else if (stock?.tradingPlan?.action === "分批关注" && pnlPct > -10) {
    action = "保留核心";
    tone = "good";
    priority = 55;
  }

  const reasons = [
    `组合权重 ${weight.toFixed(1)}%，${weight >= 28 ? "集中度偏高" : weight <= 5 ? "仓位较低" : "仓位中等"}。`,
    `成本价口径盈亏 ${formatPct(pnlPct)}，浮盈亏 ${formatMoney(pnl)}。`,
    stock && technicals
      ? `趋势结构：${livePrice >= technicals.ma20 ? "站上" : "低于"} MA20，${livePrice >= technicals.ma60 ? "站上" : "低于"} MA60，RSI ${technicals.rsi}。`
      : "趋势结构：等待网关快照后刷新均线和RSI。",
    stock?.dataQuality
      ? `数据校验：${stock.dataQuality.quoteConsensus}，可信度 ${stock.dataQuality.quoteConfidence}/100。`
      : "数据校验：尚未返回多源报价，不放大操作权重。",
    holding.market === "HK"
      ? `港股市值按截图隐含汇率 ${holding.fxRateToCny.toFixed(4)} 折人民币，真实交易需同步券商汇率。`
      : `${holding.channel} 持仓，市值按人民币计。`
  ];

  if (deepLoss) {
    reasons.push("深套本身不是立即卖出的理由；只有基本面证伪、继续破位或仓位过度集中，才把卖出放到执行层。");
  }
  if (thesisAtRisk) {
    reasons.push("交易计划提示趋势风险，需回看财报/研报是否同步下修，避免只按成本价做决策。");
  }

  const averageCostGapPct = holding.averageBuyPrice
    ? (Math.abs(holding.averageBuyPrice - holding.costPrice) / Math.abs(holding.averageBuyPrice)) * 100
    : 0;
  if (averageCostGapPct >= 15) {
    reasons.push("该行成本价与买入均价差异明显，调仓前要先核对券商成本口径。");
  }

  const executionByAction: Record<HoldingAnalysis["action"], string[]> = {
    停止补仓: [
      "在重新站回 MA20 前不继续摊低成本，先防止仓位失控。",
      "若放量站回 MA20 且研报/业绩没有下修，再评估是否保留或小幅修复。"
    ],
    等待修复: [
      "不在深亏低位机械砍仓，先观察是否止跌、缩量企稳并重新站回 MA20。",
      "若反弹到 MA20/MA60 附近无法突破，再考虑降低非核心仓。"
    ],
    反弹降风险: [
      "核心不是现在一刀卖出，而是利用反弹把单票权重降到可承受范围。",
      "若继续创新低且基本面同步恶化，则从反弹降风险切换为纪律止损。"
    ],
    纪律止损: [
      "这是逻辑证伪或结构破位后的风控动作，不是因为亏损比例大就卖。",
      "执行前复核公告、业绩指引、研报下修和流动性需求，避免日内恐慌成交。"
    ],
    分批止盈: [
      "高浮盈或过热时只做分批兑现，保留核心仓跟踪趋势延续。",
      "若跌破 MA20 且量能走弱，提高止盈执行优先级。"
    ],
    保留核心: [
      "趋势和数据质量允许保留核心仓，回撤到支撑位附近再评估是否加减。",
      "若研报共识转弱或多源报价分歧扩大，降低操作权重。"
    ],
    持有观察: [
      "当前数据可信度或趋势信号不足，先保持观察，不做方向性放大。",
      "等待多源报价、K线和基本面资料形成一致信号后再执行。"
    ]
  };

  return {
    holding,
    stock,
    livePrice,
    marketValueCny,
    costBasisCny,
    pnl,
    pnlPct,
    dayPnl,
    weight,
    action,
    tone,
    priority,
    reasons,
    execution: executionByAction[action]
  };
}

function buildPortfolioAnalyses(holdings: PortfolioHolding[], snapshotByCode: Record<string, StockProfile>) {
  const bases = holdings.map((holding) => buildHoldingBase(holding, snapshotByCode[holding.code]));
  const totalMarketValueCny = bases.reduce((sum, item) => sum + item.marketValueCny, 0);
  return bases.map((base) => completeHoldingAnalysis(base, totalMarketValueCny));
}

function mergeSnapshots(current: StockProfile[], incoming: StockProfile[]) {
  const byCode = new Map(current.map((item) => [item.code, item]));
  incoming.forEach((item) => byCode.set(item.code, item));
  return Array.from(byCode.values());
}

function normalizeDisplayCode(code: string) {
  return code.startsWith("H") ? code.slice(1) : code;
}

function exchangeDisclosureUrl(target: ResearchCoverageTarget) {
  if (target.market === "HK") return "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh";
  return target.code.startsWith("6")
    ? "https://www.sse.com.cn/disclosure/listedinfo/announcement/"
    : "https://www.szse.cn/disclosure/listed/notice/index.html";
}

function researchSourceCards(target: ResearchCoverageTarget) {
  const displayCode = normalizeDisplayCode(target.code);
  if (target.market === "HK") {
    return [
      {
        name: "HKEXnews 披露易",
        status: "官方事实源",
        detail: "年报、中报、业绩公告、回购和权益披露先从披露易校验。",
        url: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh"
      },
      {
        name: "AAStocks AAFN",
        status: "公开观点索引",
        detail: `按 ${displayCode} 查看港股新闻、大行观点和研究报告索引。`,
        url: `https://www.aastocks.com/en/stocks/analysis/stock-aafn/${displayCode}/0/hk-stock-news/1`
      },
      {
        name: "公司 IR / 公告",
        status: "事实核验",
        detail: "用公司投资者关系页与披露易公告核对管理层指引和财报口径。",
        url: "https://www.hkexnews.hk/"
      },
      {
        name: "授权研报终端",
        status: "待授权接入",
        detail: "完整卖方全文、目标价历史和一致预期需 Wind、Choice、iFinD、FactSet 等授权库。",
        url: "https://www.51ifind.com/"
      }
    ];
  }

  return [
    {
      name: "巨潮资讯 CNINFO",
      status: "官方公告",
      detail: `检索 ${target.name || displayCode} 的公告、定期报告、问询和回复。`,
      url: `https://www.cninfo.com.cn/new/fulltextSearch?notautosubmit=&keyWord=${encodeURIComponent(target.name || displayCode)}`
    },
    {
      name: target.code.startsWith("6") ? "上交所公告" : "深交所公告",
      status: "交易所事实源",
      detail: "用交易所披露文件复核监管问询、停复牌、分红和重大事项。",
      url: exchangeDisclosureUrl(target)
    },
    {
      name: "东方财富研报中心",
      status: "公开研报索引",
      detail: "用于报告标题、机构、发布日期和评级变化索引，全文需合规来源。",
      url: "https://data.eastmoney.com/report/"
    },
    {
      name: "Tushare / AKShare / 自建库",
      status: "服务端待接",
      detail: "接入后抽取盈利预测、评级修正、目标价和机构覆盖历史。",
      url: "https://tushare.pro/"
    }
  ];
}

function PortfolioPanel({
  analyses,
  holdings,
  brokerSnapshot,
  account,
  selectedCode,
  refreshMeta,
  now,
  onSelect,
  onRefresh,
  onAddHolding,
  onEditHolding,
  onDeleteHolding
}: {
  analyses: HoldingAnalysis[];
  holdings: PortfolioHolding[];
  brokerSnapshot: PortfolioBrokerSnapshot;
  account: NonNullable<AccountSession["account"]>;
  selectedCode: string;
  refreshMeta: PortfolioRefreshMeta;
  now: number;
  onSelect: (code: string) => void;
  onRefresh: () => void;
  onAddHolding: () => void;
  onEditHolding: (holding: PortfolioHolding) => void;
  onDeleteHolding: (holding: PortfolioHolding) => void;
}) {
  const totalMarketValue = analyses.reduce((sum, item) => sum + item.marketValueCny, 0);
  const totalPnl = analyses.reduce((sum, item) => sum + item.pnl, 0);
  const todayPnl = analyses.reduce((sum, item) => sum + item.dayPnl, 0);
  const hkWeight = analyses
    .filter((item) => item.holding.market === "HK")
    .reduce((sum, item) => sum + item.weight, 0);
  const topPriorities = [...analyses].sort((a, b) => b.priority - a.priority).slice(0, 3);

  return (
    <section className="portfolio-panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">My Portfolio</span>
          <h2>我的持仓与每日调仓建议</h2>
        </div>
        <div className="panel-actions">
          <button type="button" className="secondary-action-button" onClick={onAddHolding}>
            <Plus size={16} />
            添加持仓
          </button>
          <Target size={19} />
        </div>
      </div>
      <div className="portfolio-account-strip">
        <div>
          <span>登录用户</span>
          <strong>{account.email ?? account.username}</strong>
          <small>UID {shortId(account.userId)}</small>
        </div>
        <div>
          <span>组合账户</span>
          <strong>{account.name}</strong>
          <small>账户ID {shortId(account.accountId)}</small>
        </div>
        <div>
          <span>券商/来源</span>
          <strong>{account.broker ?? brokerSnapshot.source}</strong>
          <small>{account.holdingsCount} 个持仓标的</small>
        </div>
      </div>
      <div className="portfolio-summary">
        <MetricTile label="实时估算市值" value={formatMoney(totalMarketValue)} helper={`${brokerSnapshot.source}基准 ${formatMoney(brokerSnapshot.totalMarketValueCny)}`} mode="neutral" />
        <MetricTile label="实时估算盈亏" value={formatMoney(totalPnl)} helper={`截图总盈亏 ${formatMoney(brokerSnapshot.totalPnl)}`} mode={totalPnl >= 0 ? "good" : "risk"} />
        <MetricTile label="今日估算" value={formatMoney(todayPnl)} helper={`券商截图 ${formatMoney(brokerSnapshot.todayPnl)} / ${formatPct(brokerSnapshot.todayPnlPct)}`} mode={todayPnl >= 0 ? "good" : "risk"} />
        <MetricTile label="港股权重" value={`${hkWeight.toFixed(1)}%`} helper="腾讯/小米/阿里" mode={hkWeight > 50 ? "watch" : "neutral"} />
      </div>
      <div className="portfolio-source-note">
        <strong>事实边界</strong>
        <span>数量、成本价、截图汇总来自你上传的券商页面；现价、涨跌、K线和趋势由本地多源行情网关刷新。深套仓位不会机械提示割肉，会先看逻辑证伪、趋势破位和仓位集中度。</span>
      </div>
      <div className="update-console">
        <div className="update-status">
          <span className={`refresh-light ${refreshMeta.state}`} aria-hidden="true" />
          <div>
            <strong>
              {refreshMeta.state === "refreshing"
                ? `${refreshMeta.reason}中`
                : refreshMeta.state === "error"
                  ? "最近刷新失败"
                  : "持仓快照已更新"}
            </strong>
            <small>
              上次 {formatTime(refreshMeta.lastCompletedAt)} · 下一轮 {formatCountdown(refreshMeta.nextRefreshAt, now)}
            </small>
          </div>
        </div>
        <div className="update-cadence">
          <span><b>持仓快照</b>60秒轮询</span>
          <span><b>K线</b>选股/切周期刷新</span>
          <span><b>信息流</b>SSE盘中推送</span>
          <span><b>结果</b>{refreshMeta.successCount}/{holdings.length} 成功</span>
        </div>
        <button
          type="button"
          className="refresh-button"
          onClick={onRefresh}
          disabled={refreshMeta.state === "refreshing"}
        >
          <RefreshCw size={16} />
          立即刷新
        </button>
      </div>
      {refreshMeta.error ? <p className="refresh-error">{refreshMeta.error}</p> : null}
      <div className="rebalance-strip">
        {topPriorities.map((item) => (
          <article className={`rebalance-card ${item.tone}`} key={item.holding.code}>
            <strong>{item.holding.name}</strong>
            <span>{item.action}</span>
            <p>{item.reasons[0]} {item.execution[0]}</p>
          </article>
        ))}
      </div>
      <div className="holding-list">
        {analyses.map((item) => (
          <article
            className={`holding-row ${selectedCode === item.holding.code ? "active" : ""}`}
            key={item.holding.code}
            onClick={() => onSelect(item.holding.code)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(item.holding.code);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <span className="holding-name">
              <strong>{item.holding.name}</strong>
              <small>{item.holding.code} · {item.holding.channel} · {item.holding.sector}</small>
            </span>
            <span>
              <small>现价</small>
              <strong>{formatPrice(item.livePrice, item.holding.currency)}</strong>
              <em className={toneClass(item.stock?.changePct ?? 0)}>{item.stock ? formatPct(item.stock.changePct) : "待网关"}</em>
            </span>
            <span>
              <small>市值/权重</small>
              <strong>{formatMoney(item.marketValueCny)}</strong>
              <em>{item.weight.toFixed(1)}%</em>
            </span>
            <span>
              <small>成本盈亏</small>
              <strong className={toneClass(item.pnlPct)}>{formatPct(item.pnlPct)}</strong>
              <em className={toneClass(item.pnl)}>{formatMoney(item.pnl)}</em>
            </span>
            <span className={`holding-action ${item.tone}`}>
              <strong>{item.action}</strong>
              <em>优先级 {item.priority}</em>
            </span>
            <span className="holding-tools" aria-label={`${item.holding.name} 持仓操作`}>
              <button
                type="button"
                className="holding-tool-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onEditHolding(item.holding);
                }}
              >
                <Pencil size={14} />
                编辑
              </button>
              <button
                type="button"
                className="holding-tool-button danger"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteHolding(item.holding);
                }}
              >
                <Trash2 size={14} />
                删除
              </button>
            </span>
            <p>
              {item.reasons.slice(0, 4).join(" ")}
              <br />
              执行条件：{item.execution.join(" ")}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function AccountModal({
  state,
  error,
  configured,
  account,
  onClose,
  onLogout,
  onLogin
}: {
  state: "checking" | "locked" | "loading" | "ready" | "error";
  error: string | null;
  configured: boolean;
  account: AccountSession["account"];
  onClose: () => void;
  onLogout: () => void;
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const isBusy = state === "checking" || state === "loading" || !configured;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;
    await onLogin(username, password);
  }

  return (
    <div className="account-modal-backdrop" role="presentation">
      <section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-login-title">
        <div className="account-modal-head">
          <div>
            <span className="eyebrow">Secure Portfolio</span>
            <h2 id="account-login-title">{account ? "账户详情" : "账户登录"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭账户登录">
            <X size={18} />
          </button>
        </div>
        {account ? (
          <div className="account-detail-card">
            <div className="account-detail-identity">
              <strong>{account.email ?? account.username}</strong>
              <span>UID {shortId(account.userId)}</span>
            </div>
            <div className="account-detail-grid">
              <div>
                <span>组合账户</span>
                <strong>{account.name}</strong>
              </div>
              <div>
                <span>账户ID</span>
                <strong>{shortId(account.accountId)}</strong>
              </div>
              <div>
                <span>券商</span>
                <strong>{account.broker ?? "未绑定"}</strong>
              </div>
              <div>
                <span>持仓数</span>
                <strong>{account.holdingsCount}</strong>
              </div>
            </div>
            <button type="button" className="logout-wide-button" onClick={onLogout}>
              <LogOut size={15} />
              退出账户
            </button>
          </div>
        ) : (
          <>
            <div className="account-dialog-copy">
              <strong>登录后查看个人组合</strong>
              <p>持仓、成本、盈亏和调仓建议由 Supabase Auth 与 RLS 权限保护；公共市场数据保持独立展示。</p>
              <div className="account-security-tags compact">
                <span>身份认证</span>
                <span>行级权限</span>
                <span>私有持仓</span>
              </div>
            </div>
            <form className="login-form" onSubmit={handleSubmit}>
              <label>
                <span>邮箱</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="邮箱地址"
                />
              </label>
              <label>
                <span>密码</span>
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                  placeholder="账户密码"
                />
              </label>
              {!configured ? (
                <p className="login-error">Supabase 尚未配置。请在 `.env` 设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。</p>
              ) : null}
              {error ? <p className="login-error">{error}</p> : null}
              <button type="submit" disabled={isBusy}>
                {state === "checking" || state === "loading" ? "验证中" : configured ? "登录" : "等待配置"}
              </button>
              <small>本地行情网关不保存账户密码，也不保存个人持仓。</small>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

const emptyHoldingInput: AddPortfolioHoldingInput = {
  code: "",
  name: "",
  market: "A",
  channel: "A股",
  sector: "",
  themes: [],
  currency: "CNY",
  shares: 0,
  availableShares: 0,
  screenshotPrice: 0,
  costPrice: 0,
  averageBuyPrice: 0,
  fxRateToCny: 1,
  thesis: "",
  watch: []
};

function holdingToInput(holding: PortfolioHolding): AddPortfolioHoldingInput {
  return {
    code: holding.code,
    name: holding.name,
    market: holding.market,
    channel: holding.channel,
    sector: holding.sector,
    themes: [...holding.themes],
    currency: holding.currency,
    shares: holding.shares,
    availableShares: holding.availableShares,
    screenshotPrice: holding.screenshotPrice,
    costPrice: holding.costPrice,
    averageBuyPrice: holding.averageBuyPrice,
    fxRateToCny: holding.fxRateToCny,
    thesis: holding.thesis,
    watch: [...holding.watch]
  };
}

function AddHoldingModal({
  mode = "create",
  initialHolding,
  onClose,
  onSave
}: {
  mode?: "create" | "edit";
  initialHolding?: PortfolioHolding;
  onClose: () => void;
  onSave: (input: AddPortfolioHoldingInput) => Promise<void>;
}) {
  const [form, setForm] = useState<AddPortfolioHoldingInput>(() =>
    initialHolding
      ? holdingToInput(initialHolding)
      : { ...emptyHoldingInput, themes: [], watch: [] }
  );
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = mode === "edit";

  function updateForm(patch: Partial<AddPortfolioHoldingInput>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateMarket(market: "A" | "HK") {
    updateForm({
      market,
      currency: market === "HK" ? "HKD" : "CNY",
      channel: market === "HK" ? "港股通/港股" : "A股",
      fxRateToCny: market === "HK" ? 0.9 : 1
    });
  }

  async function lookupSecurity() {
    const query = form.code.trim() || form.name.trim();
    if (!query) {
      setError("请先输入代码或名称。");
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      const payload = await fetchMarketUniverse({ query, limit: 8 });
      const security = payload?.items[0];
      if (!security) throw new Error("股票池没有找到匹配标的。");
      updateForm({
        code: security.code,
        name: security.name,
        market: security.market,
        channel: security.market === "HK" ? "港股通/港股" : "A股",
        sector: security.sector,
        themes: security.themes.slice(0, 6),
        currency: security.market === "HK" ? "HKD" : "CNY",
        screenshotPrice: security.price || form.screenshotPrice,
        costPrice: form.costPrice || security.price || 0,
        averageBuyPrice: form.averageBuyPrice || form.costPrice || security.price || 0,
        fxRateToCny: security.market === "HK" ? form.fxRateToCny || 0.9 : 1,
        thesis: form.thesis || `${security.name} 手动加入持仓，后续按行情、K线和研报数据跟踪。`,
        watch: form.watch.length ? form.watch : security.themes.slice(0, 4)
      });
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : String(lookupError));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      await onSave(form);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="account-modal-backdrop" role="presentation">
      <section className="account-modal holding-modal" role="dialog" aria-modal="true" aria-labelledby="add-holding-title">
        <div className="account-modal-head">
          <div>
            <span className="eyebrow">Private Portfolio</span>
            <h2 id="add-holding-title">{isEdit ? "编辑持仓" : "添加持仓"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={isEdit ? "关闭编辑持仓" : "关闭添加持仓"}>
            <X size={18} />
          </button>
        </div>
        <form className="login-form holding-form" onSubmit={handleSubmit}>
          <div className="holding-form-grid">
            <label>
              <span>代码</span>
              <input
                value={form.code}
                onChange={(event) => updateForm({ code: event.target.value })}
                placeholder="600519 / H00700"
              />
            </label>
            <label>
              <span>市场</span>
              <select value={form.market} onChange={(event) => updateMarket(event.target.value === "HK" ? "HK" : "A")}>
                <option value="A">A股</option>
                <option value="HK">港股</option>
              </select>
            </label>
            <label className="wide">
              <span>名称</span>
              <input
                value={form.name}
                onChange={(event) => updateForm({ name: event.target.value })}
                placeholder="可从股票池补全"
              />
            </label>
            <label>
              <span>持仓数量</span>
              <input
                value={form.shares || ""}
                onChange={(event) => updateForm({ shares: Number(event.target.value) })}
                type="number"
                min="0"
                step="1"
              />
            </label>
            <label>
              <span>可用数量</span>
              <input
                value={form.availableShares || ""}
                onChange={(event) => updateForm({ availableShares: Number(event.target.value) })}
                type="number"
                min="0"
                step="1"
              />
            </label>
            <label>
              <span>现价/截图价</span>
              <input
                value={form.screenshotPrice || ""}
                onChange={(event) => updateForm({ screenshotPrice: Number(event.target.value) })}
                type="number"
                min="0"
                step="0.001"
              />
            </label>
            <label>
              <span>成本价</span>
              <input
                value={form.costPrice || ""}
                onChange={(event) => updateForm({ costPrice: Number(event.target.value) })}
                type="number"
                min="0"
                step="0.001"
              />
            </label>
            <label>
              <span>买入均价</span>
              <input
                value={form.averageBuyPrice || ""}
                onChange={(event) => updateForm({ averageBuyPrice: Number(event.target.value) })}
                type="number"
                min="0"
                step="0.001"
              />
            </label>
            <label>
              <span>汇率到人民币</span>
              <input
                value={form.fxRateToCny || ""}
                onChange={(event) => updateForm({ fxRateToCny: Number(event.target.value) })}
                type="number"
                min="0"
                step="0.0001"
              />
            </label>
            <label>
              <span>行业</span>
              <input value={form.sector} onChange={(event) => updateForm({ sector: event.target.value })} />
            </label>
            <label>
              <span>题材</span>
              <input
                value={form.themes.join(",")}
                onChange={(event) => updateForm({ themes: event.target.value.split(/[,，]/) })}
                placeholder="逗号分隔"
              />
            </label>
            <label className="wide">
              <span>持仓逻辑</span>
              <textarea
                value={form.thesis}
                onChange={(event) => updateForm({ thesis: event.target.value })}
                rows={3}
                placeholder="这笔仓位为什么存在，什么条件下调整"
              />
            </label>
            <label className="wide">
              <span>监控项</span>
              <input
                value={form.watch.join(",")}
                onChange={(event) => updateForm({ watch: event.target.value.split(/[,，]/) })}
                placeholder="逗号分隔，例如 回购,业绩公告,技术位"
              />
            </label>
          </div>
          {error ? <p className="login-error">{error}</p> : null}
          <div className="holding-form-actions">
            <button type="button" className="lookup-button" onClick={lookupSecurity} disabled={isBusy}>
              <Search size={15} />
              从股票池补全
            </button>
            <button type="submit" disabled={isBusy}>
              {isBusy ? "保存中" : isEdit ? "更新持仓" : "保存持仓"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DeleteHoldingModal({
  holding,
  onClose,
  onDelete
}: {
  holding: PortfolioHolding;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setIsBusy(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="account-modal-backdrop" role="presentation">
      <section className="account-modal delete-holding-modal" role="dialog" aria-modal="true" aria-labelledby="delete-holding-title">
        <div className="account-modal-head">
          <div>
            <span className="eyebrow">Private Portfolio</span>
            <h2 id="delete-holding-title">删除持仓</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭删除持仓">
            <X size={18} />
          </button>
        </div>
        <div className="delete-holding-copy">
          <strong>{holding.name}</strong>
          <span>{holding.code} · {holding.market === "HK" ? "港股" : "A股"} · {integerFormatter.format(holding.shares)} 股</span>
          <p>删除后该标的会从当前登录账户的私有持仓列表移除，不影响公共股票池、行情、研报或其他用户数据。</p>
        </div>
        {error ? <p className="login-error">{error}</p> : null}
        <div className="delete-holding-actions">
          <button type="button" className="lookup-button" onClick={onClose} disabled={isBusy}>
            取消
          </button>
          <button type="button" className="danger-action-button" onClick={handleDelete} disabled={isBusy}>
            <Trash2 size={15} />
            {isBusy ? "删除中" : "确认删除"}
          </button>
        </div>
      </section>
    </div>
  );
}

function Watchlist({
  selectedCode,
  snapshots,
  onSelect
}: {
  selectedCode: string;
  snapshots: StockProfile[];
  onSelect: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [universe, setUniverse] = useState<MarketSecurity[]>([]);
  const [universeState, setUniverseState] = useState<"loading" | "ready" | "error">("loading");
  const [universeMeta, setUniverseMeta] = useState<{
    total: number;
    matched: number;
    coverage: { A: number; HK: number };
    source: string;
  }>({
    total: 0,
    matched: 0,
    coverage: { A: 0, HK: 0 },
    source: "等待股票池"
  });

  useEffect(() => {
    let isMounted = true;
    const timer = window.setTimeout(() => {
      setUniverseState("loading");
      fetchMarketUniverse({ query, market: "ALL", limit: query.trim() ? 100 : 70 })
        .then((payload) => {
          if (!payload || !isMounted) return;
          setUniverse(payload.items);
          setUniverseMeta({
            total: payload.total,
            matched: payload.matched,
            coverage: payload.coverage,
            source: payload.source
          });
          setUniverseState("ready");
        })
        .catch(() => {
          if (!isMounted) return;
          setUniverseState("error");
        });
    }, query.trim() ? 220 : 0);

    return () => {
      isMounted = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const filteredResearch = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return companyResearch.slice(0, 14);
    return companyResearch.filter((item) =>
      `${item.code}${item.name}${item.sector}${item.themes.join("")}`.toLowerCase().includes(needle)
    );
  }, [query]);
  const researchCodes = useMemo(() => new Set(filteredResearch.map((item) => item.code)), [filteredResearch]);
  const marketRows = useMemo(
    () => universe.filter((item) => !researchCodes.has(item.code)).slice(0, query.trim() ? 80 : 28),
    [query, researchCodes, universe]
  );

  return (
    <aside className="watchlist panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Universe + Research Pool</span>
          <h2>全市场股票池</h2>
        </div>
        <SlidersHorizontal size={18} />
      </div>
      <label className="search-box">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="代码 / 名称 / 行业 / 题材（A/H）"
        />
      </label>
      <div className={`universe-meta ${universeState}`}>
        <span>{universeState === "loading" ? "同步股票池" : universeState === "error" ? "股票池暂不可用" : "股票池已同步"}</span>
        <small>
          A股 {universeMeta.coverage.A || "--"} · 港股 {universeMeta.coverage.HK || "--"} · 匹配 {universeMeta.matched || filteredResearch.length}
        </small>
      </div>
      <div className="watchlist-rows">
        {filteredResearch.map((item) => {
          const stock = snapshots.find((snapshot) => snapshot.code === item.code);
          return (
            <button
              type="button"
              className={`stock-row research-row ${item.code === selectedCode ? "active" : ""}`}
              key={item.code}
              onClick={() => onSelect(item.code)}
            >
              <span className="stock-row-main">
                <strong>{item.name}</strong>
                <small>{item.code} · {item.sector}</small>
                <em>{stockReasonLine(item, stock)}</em>
              </span>
              {stock ? (
                <Sparkline data={stock.technicals.close} accent={stock.changePct >= 0 ? "var(--rise)" : "var(--fall)"} />
              ) : (
                <span className="research-mini">{item.consensus}</span>
              )}
              <span className="stock-row-price">
                <strong>{stock ? currencyFormatter.format(stock.price) : item.reportTrend}</strong>
                <small className={stock ? toneClass(stock.changePct) : ""}>
                  {stock ? formatPct(stock.changePct) : `${item.reportCount} 份研报`}
                </small>
              </span>
              <span className="stock-row-score">{item.themeScore}</span>
            </button>
          );
        })}
        {marketRows.map((item) => {
          const stock = snapshots.find((snapshot) => snapshot.code === item.code);
          return (
            <button
              type="button"
              className={`stock-row market-row ${item.code === selectedCode ? "active" : ""}`}
              key={item.code}
              onClick={() => onSelect(item.code)}
            >
              <span className="stock-row-main">
                <strong>{item.name}</strong>
                <small>{item.code} · {item.market === "HK" ? "港股" : "A股"} · {item.sector}</small>
                <em>{securityReasonLine(item, stock)}</em>
              </span>
              {stock ? (
                <Sparkline data={stock.technicals.close} accent={stock.changePct >= 0 ? "var(--rise)" : "var(--fall)"} />
              ) : (
                <span className="research-mini">股票池</span>
              )}
              <span className="stock-row-price">
                <strong>{currencyFormatter.format(stock?.price ?? item.price)}</strong>
                <small className={toneClass(stock?.changePct ?? item.changePct)}>
                  {formatPct(stock?.changePct ?? item.changePct)}
                </small>
              </span>
              <span className="stock-row-score">{item.market}</span>
            </button>
          );
        })}
        {filteredResearch.length === 0 && marketRows.length === 0 ? (
          <div className="empty-state compact">
            <strong>没有匹配结果</strong>
            <p>可输入 600519、00700、宁德时代、半导体、AI 等代码、名称、行业或题材。</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function MarketStrip({ indexes }: { indexes: typeof marketIndexes }) {
  return (
    <section className="market-strip" aria-label="市场指数">
      {indexes.map((item) => (
        <div className="index-tile" key={item.name}>
          <span>{item.name}</span>
          <strong>{integerFormatter.format(item.value)}</strong>
          <small className={toneClass(item.changePct)}>
            {formatPct(item.changePct)} · {integerFormatter.format(item.turnover)} 亿
          </small>
        </div>
      ))}
    </section>
  );
}

function FrameworkPanel() {
  return (
    <section className="framework-panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Research Framework</span>
          <h2>六层分析框架</h2>
        </div>
        <Layers size={19} />
      </div>
      <div className="framework-steps">
        {analysisFramework.map((step) => (
          <article className="framework-step" key={step.name}>
            <div>
              <strong>{step.name}</strong>
              <span>{step.weight}%</span>
            </div>
            <p>{step.objective}</p>
            <small>{step.metrics.join(" / ")}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function DataSourcePanel({
  gatewayState,
  streamState,
  providers
}: {
  gatewayState: IfindConnectionState;
  streamState: IfindConnectionState;
  providers: DataProvider[];
}) {
  const connectedProvider = providers.find((provider) => provider.status === "connected");
  const gatewayReady = gatewayState === "connected" || Boolean(connectedProvider);
  const statusTitle = gatewayReady
    ? "实时行情网关已接入"
    : gatewayState === "connecting"
      ? "正在连接本地行情网关"
      : gatewayState === "error"
        ? "行情网关连接异常"
        : "研报种子库模式";
  const statusBadge = gatewayReady
    ? "可用"
    : gatewayState === "connecting"
      ? "探测中"
      : gatewayState === "error"
        ? "异常"
        : "待接入";
  const statusItems = [
    {
      label: "行情",
      value: gatewayReady ? "多源校验" : "等待网关",
      detail: gatewayReady ? "东方财富 / 腾讯 / 新浪" : "不填假价格"
    },
    {
      label: "K线",
      value: gatewayReady ? "日周月年" : "待刷新",
      detail: gatewayReady ? "Push2His + 腾讯兜底" : "需行情网关"
    },
    {
      label: "信息流",
      value: streamLabel(streamState).replace("SSE通道", "SSE"),
      detail: streamState === "connected" ? "实时事件通道" : "研报事件回放"
    },
    {
      label: "研报",
      value: "全文解析",
      detail: "公开PDF/HTML；授权预测待接"
    }
  ];
  const sourceRows =
    providers.length > 0
      ? providers.map((provider) => ({
          name: provider.name,
          stateClass: provider.health?.state ?? provider.status,
          stateLabel: providerStateLabel(provider),
          coverage: provider.coverage.join(" / "),
          evidenceLine: providerEvidenceLine(provider),
          evidenceTags: Array.isArray(provider.health?.evidence) ? provider.health.evidence.slice(0, 2) : []
        }))
      : dataSourceLayers.map((layer) => ({
          name: layer.name,
          stateClass: "",
          stateLabel: layer.status,
          coverage: layer.fields.join(" / "),
          evidenceLine: "本地模型登记源，待网关探测校验",
          evidenceTags: []
        }));

  return (
    <section className="data-source-panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Data Integrity</span>
          <h2>数据源状态</h2>
        </div>
        <Database size={19} />
      </div>
      <div className={`source-status-card ${gatewayState}`}>
        <div className="source-status-head">
          <strong>{statusTitle}</strong>
          <span>{statusBadge}</span>
        </div>
        <div className="source-status-grid">
          {statusItems.map((item) => (
            <span key={item.label}>
              <b>{item.label}</b>
              <strong>{item.value}</strong>
              <em>{item.detail}</em>
            </span>
          ))}
        </div>
      </div>
      <div className="source-list">
        {sourceRows.map((source) => (
          <article className="source-row" key={source.name}>
            <div className="source-row-head">
              <strong title={source.name}>{source.name}</strong>
              <span className={`source-state ${source.stateClass}`}>{source.stateLabel}</span>
            </div>
            <small className="source-coverage">{source.coverage}</small>
            <div className="source-evidence">
              <p>{source.evidenceLine}</p>
              {source.evidenceTags.length > 0 ? (
                <ul>
                  {source.evidenceTags.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function hkSourceTone(source: HkResearchSource) {
  if (source.status === "已在线探测") return "good";
  if (source.status === "需要授权") return "risk";
  if (source.status === "本机探测失败") return "risk";
  return "watch";
}

function HkResearchSourcePanel() {
  return (
    <section className="panel hk-source-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">HK Research Sources</span>
          <h2>港股研报与事实源</h2>
        </div>
        <FileText size={19} />
      </div>
      <div className="hk-source-note">
        <strong>港股数据口径</strong>
        <div className="hk-source-brief">
          <span><b>事实</b>HKEXnews / 公司IR</span>
          <span><b>观点</b>AAStocks AAFN 索引</span>
          <span><b>预测</b>授权库待接入</span>
        </div>
      </div>
      <div className="hk-source-list">
        {hkResearchSources.map((source) => (
          <article className="hk-source-card" key={source.name}>
            <div className="hk-source-head">
              <strong>{source.name}</strong>
              <span className={`hk-source-status ${hkSourceTone(source)}`}>{source.status}</span>
            </div>
            <small>{source.layer} · {source.coverage.join(" / ")}</small>
            <p>{source.useCase}</p>
            <div className="source-link-list" aria-label={`${source.name} links`}>
              {source.links.map((link) => (
                <a className="source-link" href={link.url} target="_blank" rel="noreferrer" key={link.url}>
                  {link.label} <ExternalLink size={14} />
                </a>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function providerStateLabel(provider: DataProvider) {
  if (provider.health?.state === "verified") return "已探测验证";
  if (provider.health?.state === "degraded") return "部分可用";
  if (provider.health?.state === "failed") return "探测失败";
  if (provider.health?.state === "not-configured") return "未配置";
  if (provider.health?.state === "reserved") return "扩展位未运行";
  if (provider.status === "connected") return "已连接";
  if (provider.status === "needs-token") return "需要 Token";
  if (provider.status === "extension-ready") return "扩展位";
  return "待探测";
}

function providerEvidenceLine(provider: DataProvider) {
  const health = provider.health;
  if (!health) return provider.note;
  const checkedAt = new Date(health.checkedAt).toLocaleTimeString("zh-CN", { hour12: false });
  if (health.state === "verified") {
    return `${checkedAt} · ${health.sampleCode ?? "样本"} ${health.sampleName ?? ""} · ${health.latencyMs ?? 0}ms`;
  }
  if (health.state === "degraded") {
    return `${checkedAt} · ${health.sampleCode ?? "样本"} · 部分可用 · ${health.latencyMs ?? 0}ms`;
  }
  if (health.state === "failed") {
    return `${checkedAt} · 探测失败 · ${health.error ?? "未返回可用数据"}`;
  }
  if (health.state === "not-configured") {
    return `${checkedAt} · 未配置授权`;
  }
  return `${checkedAt} · 扩展位待接入`;
}

function DataQualityPanel({ stock }: { stock: StockProfile }) {
  const quality = stock.dataQuality;
  if (!quality) {
    return (
      <section className="panel data-quality-panel empty-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Data Verification</span>
            <h2>多源校验等待网关</h2>
          </div>
          <Database size={19} />
        </div>
        <p>当前股票尚未返回多源校验结果。连接数据网关后会显示各源报价、偏差、失败源和可信度。</p>
      </section>
    );
  }

  const confidenceMode = quality.quoteConfidence >= 88 ? "good" : quality.quoteConfidence >= 72 ? "watch" : "risk";

  return (
    <section className="panel data-quality-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Data Verification</span>
          <h2>多源报价校验</h2>
        </div>
        <Database size={19} />
      </div>
      <div className="quality-topline">
        <MetricTile
          label="可信度"
          value={`${quality.quoteConfidence}/100`}
          helper={quality.quoteConsensus}
          mode={confidenceMode}
        />
        <MetricTile
          label="价差"
          value={`${quality.priceSpreadPct.toFixed(3)}%`}
          helper={`${quality.verifiedSourceCount}/${quality.sourceCount} 源通过`}
          mode={quality.priceSpreadPct <= 0.18 ? "good" : "risk"}
        />
        <MetricTile
          label="共识价"
          value={currencyFormatter.format(quality.consensusPrice)}
          helper={`${formatPct(quality.consensusChangePct)} 共识涨跌幅`}
          mode={quality.consensusChangePct >= 0 ? "good" : "risk"}
        />
      </div>
      <div className="quality-source-list">
        {quality.sources.map((source) => (
          <article className={`quality-source ${source.status}`} key={source.providerId}>
            <div>
              <strong>{source.providerName}</strong>
              <span>{source.status === "verified" ? "已校验" : source.status === "disagreed" ? "有分歧" : "失败"}</span>
            </div>
            <p>
              {source.price
                ? `${currencyFormatter.format(source.price)} · ${formatPct(source.changePct ?? 0)} · 偏差 ${source.priceDiffPct ?? 0}%`
                : source.error ?? "未返回报价"}
            </p>
            <small>{source.timestamp ?? "无时间戳"}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function FundamentalPanel({ stock }: { stock: StockProfile }) {
  const metrics = [
    fundamentalMetric(
      stock,
      "pe",
      "PE TTM",
      (value) => `${value.toFixed(1)}x`,
      "行情估值字段",
      "行情源未返回",
      (value) => (value < 25 ? "good" : "watch")
    ),
    fundamentalMetric(
      stock,
      "pb",
      "PB",
      (value) => `${value.toFixed(2)}x`,
      "行情估值字段",
      "行情源未返回",
      (value) => (value < 3 ? "good" : "watch")
    ),
    fundamentalMetric(
      stock,
      "roe",
      "ROE",
      (value) => `${value.toFixed(1)}%`,
      "净资产回报",
      "财报源待接入",
      (value) => (value > 18 ? "good" : "neutral")
    ),
    fundamentalMetric(
      stock,
      "revenueYoy",
      "营收 YoY",
      formatPct,
      "成长速度",
      "财报源待接入",
      (value) => (value > 10 ? "good" : value < 0 ? "risk" : "neutral")
    ),
    fundamentalMetric(
      stock,
      "profitYoy",
      "净利 YoY",
      formatPct,
      "利润弹性",
      "财报源待接入",
      (value) => (value > 15 ? "good" : value < 0 ? "risk" : "neutral")
    ),
    fundamentalMetric(
      stock,
      "ocfToProfit",
      "现金含量",
      (value) => `${value.toFixed(2)}x`,
      "经营现金流/净利",
      "现金流待接入",
      (value) => (value >= 1 ? "good" : "watch")
    )
  ];

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Fundamental</span>
          <h2>基本面质量</h2>
        </div>
        <BarChart3 size={19} />
      </div>
      <div className="metric-grid">
        {metrics.map((metric) => (
          <MetricTile
            key={metric.label}
            label={metric.label}
            value={metric.value}
            helper={metric.helper}
            mode={metric.mode}
          />
        ))}
      </div>
      <div className="fundamental-source-strip">
        <span>估值：行情源快照</span>
        <span>质量：财报/一致预期待接入后显示</span>
      </div>
    </section>
  );
}

function TechnicalPanel({
  stock,
  kline,
  period,
  onPeriodChange
}: {
  stock: StockProfile;
  kline?: KlinePayload | null;
  period: KlinePeriod;
  onPeriodChange: (period: KlinePeriod) => void;
}) {
  const t = kline?.technicals ?? stock.technicals;
  const volume = kline?.items?.length ? kline.items.map((item) => item.volume) : t.volume;
  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Technical</span>
          <h2>多周期 K 线与买点区间</h2>
        </div>
        <div className="chart-actions">
          <div className="period-switcher" aria-label="K线周期">
            {klinePeriods.map((item) => (
              <button
                type="button"
                key={item.value}
                className={period === item.value ? "active" : ""}
                onClick={() => onPeriodChange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <LineChart size={19} />
        </div>
      </div>
      <PriceChart stock={stock} kline={kline} />
      <div className="chart-legend">
        <span><i className="legend-dot rise" />阳线</span>
        <span><i className="legend-dot fall" />阴线</span>
        <span><i className="legend-line ma20" />MA20 {t.ma20.toFixed(2)}</span>
        <span><i className="legend-line ma60" />MA60 {t.ma60.toFixed(2)}</span>
        <span>支撑 {t.support.toFixed(2)}</span>
        <span>压力 {t.resistance.toFixed(2)}</span>
      </div>
      <div className="kline-source-row">
        <span>{kline?.label ?? "日K"} · {kline?.providerName ?? "本地快照"}</span>
        <strong>历史K线可信度 {kline?.confidence ?? 0}/100</strong>
        <small>{kline ? `更新 ${new Date(kline.lastUpdatedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "等待数据网关"}</small>
      </div>
      <div className="technical-band">
        <MetricTile label="RSI" value={String(t.rsi)} helper={t.rsi > 70 ? "过热" : t.rsi < 40 ? "偏弱" : "健康区间"} mode={t.rsi > 70 ? "risk" : "good"} />
        <MetricTile label="MACD" value={t.macd.toFixed(2)} helper="趋势动量" mode={t.macd > 0 ? "good" : "risk"} />
        <MetricTile label="换手率" value={`${t.turnoverRate.toFixed(2)}%`} helper="资金活跃度" mode={t.turnoverRate > 2.5 ? "watch" : "neutral"} />
        <MetricTile label="波动率" value={`${t.volatility.toFixed(1)}%`} helper="20 日年化" mode={t.volatility > 35 ? "risk" : "neutral"} />
      </div>
      <VolumeBars data={volume} />
    </section>
  );
}

function SentimentPanel({ stock }: { stock: StockProfile }) {
  const sentiment = stock.sentiment;
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Sentiment</span>
          <h2>资金与市场情绪</h2>
        </div>
        <Radio size={19} />
      </div>
      <div className="sentiment-layout">
        <ScoreDial score={sentiment.score} label="情绪分" />
        <div className="sentiment-bars">
          <Progress label="新闻倾向" value={sentiment.newsTone} />
          <Progress label="讨论热度" value={sentiment.socialHeat} />
          <Progress label="风险折扣" value={100 - Math.min(95, Math.abs(sentiment.mainNetInflow) * 8 + 22)} />
        </div>
      </div>
      <div className="capital-grid">
        <MetricTile label="北向净流入" value={`${sentiment.northbound.toFixed(1)} 亿`} helper="实时估算" mode={sentiment.northbound > 0 ? "good" : "risk"} />
        <MetricTile label="主力净额" value={`${sentiment.mainNetInflow.toFixed(1)} 亿`} helper="盘中资金" mode={sentiment.mainNetInflow > 0 ? "good" : "risk"} />
        <MetricTile label="融资变化" value={formatPct(sentiment.marginBalanceChange)} helper="杠杆情绪" mode={sentiment.marginBalanceChange > 3 ? "watch" : "neutral"} />
      </div>
      <div className="risk-tags">
        {sentiment.riskTags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
    </section>
  );
}

function RecommendationPanel({
  research,
  stock,
  reports
}: {
  research?: CompanyResearch;
  stock?: StockProfile;
  reports: ResearchReportDigest[];
}) {
  const recommendation = buildRecommendation(research, stock, reports);

  return (
    <section className="panel recommendation-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Why This Name</span>
          <h2>推荐理由（研究优先级）</h2>
        </div>
        <Target size={19} />
      </div>
      <div className="recommendation-head">
        <div className={`recommendation-score ${recommendation.tone}`}>
          <strong>{recommendation.score}</strong>
          <span>{recommendation.verdict}</span>
        </div>
        <div className="recommendation-copy">
          {recommendation.reasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
        </div>
      </div>
      <div className="recommendation-grid">
        <div>
          <strong>观察条件</strong>
          <div className="monitor-list compact">
            {recommendation.watch.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
        <div>
          <strong>降级风险</strong>
          <div className="risk-tags compact">
            {recommendation.risks.map((risk) => (
              <span key={risk}>{risk}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ResearchConsensusPanel({
  research,
  target
}: {
  research?: CompanyResearch;
  target: ResearchCoverageTarget;
}) {
  if (!research) {
    return (
      <section className="panel research-gap-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Research Consensus</span>
            <h2>研报覆盖缺口</h2>
          </div>
          <FileText size={19} />
        </div>
        <div className="coverage-target-card">
          <div>
            <span>{target.market === "HK" ? "港股" : "A股"} · {target.sector}</span>
            <strong>{target.name}</strong>
            <small>{target.code}</small>
          </div>
          <div className="coverage-status-pill">未进入研报库</div>
        </div>
        <div className="coverage-gap-grid">
          <MetricTile label="研报全文" value="缺口" helper="未抓取 PDF/HTML 全文" mode="risk" />
          <MetricTile label="机构覆盖" value="缺口" helper="未形成机构与评级历史" mode="risk" />
          <MetricTile label="盈利预测" value="缺口" helper="EPS/收入/利润修正未抽取" mode="risk" />
        </div>
        <div className="coverage-rule-list">
          <span><CheckIcon /> 行情、K线和持仓风控仍可用，但不把空研报当作负面结论。</span>
          <span><WarnIcon /> 调仓建议会降低基本面权重，等待公告、财报和授权研报源补齐后再提高结论强度。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="panel research-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Research Consensus</span>
          <h2>研报共识与题材定位</h2>
        </div>
        <FileText size={19} />
      </div>
      <div className="research-topline">
        <ScoreDial score={research.themeScore} label="题材分" />
        <div>
          <span className={`signal-pill signal-${research.reportTrend}`}>{research.reportTrend}</span>
          <span className="consensus-pill">{research.consensus}</span>
          <h3>{research.role}</h3>
          <p>{research.thesis}</p>
        </div>
      </div>
      <div className="research-score-grid">
        <MetricTile label="研报覆盖" value={`${research.reportCount} 份`} helper="近 12-18 个月种子库" mode="neutral" />
        <MetricTile label="基本面分" value={String(research.fundamentalScore)} helper="业绩与质量" mode={research.fundamentalScore >= 80 ? "good" : "watch"} />
        <MetricTile label="风险折扣" value={String(research.riskScore)} helper="越高越需警惕" mode={research.riskScore >= 45 ? "risk" : "neutral"} />
      </div>
      <div className="theme-tags">
        {research.themes.map((theme) => (
          <span key={theme}>{theme}</span>
        ))}
      </div>
      <div className="monitor-list">
        {research.monitor.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </section>
  );
}

function hkLayerLabel(layer: string) {
  const labels: Record<string, string> = {
    "official-filing": "官方公告",
    "research-index": "研报索引",
    "public-view": "公开观点",
    "public-news": "公开新闻"
  };
  return labels[layer] ?? layer;
}

function hkSourceStatusLabel(status: string) {
  const labels: Record<string, string> = {
    verified: "已校验",
    failed: "失败",
    reserved: "预留",
    "not-configured": "未配置"
  };
  return labels[status] ?? status;
}

function isExtractableResearchUrl(url: string) {
  try {
    const parsed = new URL(url);
    return [
      "pdf.dfcfw.com",
      "static.cninfo.com.cn",
      "www1.hkexnews.hk",
      "www.hkexnews.hk",
      "www.aastocks.com",
      "www.hengrui.com",
      "www.fii-foxconn.com",
      "www.stcn.com",
      "m.hibor.com.cn",
      "finance.sina.com.cn"
    ].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function formatTextCount(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万字`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)} 千字`;
  return `${value} 字`;
}

function DocumentInsight({ entry }: { entry?: DocumentExtractionEntry }) {
  if (!entry) return null;

  if (entry.state === "loading") {
    return (
      <div className="document-insight loading">
        <strong>原文解析中</strong>
        <span>正在抓取 PDF/HTML，并抽取正文与预测表候选行。</span>
      </div>
    );
  }

  if (entry.state === "error") {
    return (
      <div className="document-insight error">
        <strong>原文解析失败</strong>
        <span>{entry.error}</span>
      </div>
    );
  }

  const data = entry.data;
  if (!data) return null;
  const forecastRows = data.forecast.rows.slice(0, 3);

  return (
    <div className="document-insight ready">
      <div className="document-insight-head">
        <strong>{data.format.toUpperCase()} 全文已解析</strong>
        <span>{data.pageCount ? `${data.pageCount} 页` : "HTML"}</span>
        <span>{formatTextCount(data.textChars)}</span>
        <span>预测表 {data.forecast.rows.length} 行</span>
      </div>
      {data.excerpt ? <p>{data.excerpt}</p> : null}
      {forecastRows.length > 0 ? (
        <div className="document-forecast-grid">
          {forecastRows.map((row) => (
            <span key={`${data.url}-${row.raw}`}>
              <strong>{row.metric}</strong>
              {row.raw}
            </span>
          ))}
        </div>
      ) : (
        <small>未识别到盈利预测表候选行，可能是扫描件、公告类 PDF 或正文未包含预测表。</small>
      )}
      {data.ratingLines.length > 0 ? (
        <div className="document-rating-lines">
          {data.ratingLines.slice(0, 2).map((line) => (
            <span key={`${data.url}-${line}`}>{line}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HkResearchIndexView({
  index,
  documentExtractions
}: {
  index: HkResearchIndex;
  documentExtractions: Record<string, DocumentExtractionEntry>;
}) {
  return (
    <div className="hk-research-index">
      <div className="hk-index-summary">
        <div>
          <span className="eyebrow">HK Public Research Index</span>
          <strong>{index.name} · {index.items.length} 条公开索引</strong>
          <p>{index.analysis.notes[0]}</p>
        </div>
        <div className="hk-index-counts">
          <span>公告 {index.analysis.filingCount}</span>
          <span>研报/观点 {index.analysis.researchCount}</span>
          <span>同业 {index.analysis.sectorCount}</span>
        </div>
      </div>

      {index.analysis.themes.length > 0 ? (
        <div className="hk-theme-strip">
          {index.analysis.themes.map((theme) => (
            <span key={theme}>{theme}</span>
          ))}
        </div>
      ) : null}

      <div className="hk-index-list">
        {index.items.slice(0, 10).map((item) => (
          <article className="hk-index-card" key={item.id}>
            <div className="hk-index-card-head">
              <time>{item.date || "日期待核"}</time>
              <span>{hkLayerLabel(item.layer)}</span>
              <span>{item.relevance === "direct" ? "个股直接" : "板块/同业"}</span>
              <span className={`signal-pill signal-${item.signal}`}>{item.signal}</span>
            </div>
            <h3>{item.title}</h3>
            <p>{item.summary}</p>
            <div className="report-meta">
              <span>{item.source}</span>
              <span>置信度 {item.confidence}</span>
            </div>
            {item.risks.length > 0 ? (
              <div className="risk-tags compact">
                {item.risks.map((risk) => (
                  <span key={`${item.id}-${risk}`}>{risk}</span>
                ))}
              </div>
            ) : null}
            <DocumentInsight entry={documentExtractions[item.url]} />
            <a className="source-link" href={item.url} target="_blank" rel="noreferrer">
              打开原文 <ExternalLink size={14} />
            </a>
          </article>
        ))}
      </div>

      <div className="hk-index-source-strip">
        {index.sources.map((source) => (
          <a
            className={`hk-source-chip status-${source.status}`}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            key={`${index.code}-${source.name}`}
          >
            <span>{hkSourceStatusLabel(source.status)}</span>
            <strong>{source.name}</strong>
            <small>{source.error ?? source.evidence[0]}</small>
          </a>
        ))}
      </div>

      <div className="hk-index-limitations">
        {index.limitations.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function ReportDigestPanel({
  reports,
  target,
  hkResearchIndex,
  documentExtractions,
  hkResearchLoading = false,
  hkResearchError
}: {
  reports: ResearchReportDigest[];
  target: ResearchCoverageTarget;
  hkResearchIndex?: HkResearchIndex | null;
  documentExtractions: Record<string, DocumentExtractionEntry>;
  hkResearchLoading?: boolean;
  hkResearchError?: string | null;
}) {
  const sourceCards = researchSourceCards(target);
  const hasHkResearchIndex = target.market === "HK" && Boolean(hkResearchIndex?.items.length);
  return (
    <section className="panel report-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Last 12-18 Months</span>
          <h2>近一年多研报与公告摘要</h2>
        </div>
        <Newspaper size={19} />
      </div>
      <div className="report-source-note">
        <strong>{hasHkResearchIndex ? "港股公开索引已拉取" : "研报分析状态"}</strong>
        <p>
          {hasHkResearchIndex
            ? "当前展示 HKEXnews 披露易、AAStocks 分类页和公司 IR 的可核验索引；已对可抓取 PDF/HTML 自动抽取正文和预测表候选行，授权一致预期仍需单独接入。"
            : "已把首批公司近 12-18 个月公开研报/公告摘要结构化为日期、来源、评级、信号、风险标签；可抓取 PDF/HTML 会自动抽取正文、评级线索和盈利预测表候选行。"}
        </p>
      </div>
      <div className="report-list">
        {reports.length > 0 ? (
          reports.map((report) => (
            <article className="report-card" key={report.id}>
              <div className="report-card-head">
                <time>{report.date}</time>
                <span className={`signal-pill signal-${report.signal}`}>{report.signal}</span>
              </div>
              <h3>{report.title}</h3>
              <p>{report.summary}</p>
              <div className="report-meta">
                <span>{report.source}</span>
                <span>{report.rating}</span>
              </div>
              <div className="risk-tags compact">
                {report.risks.map((risk) => (
                  <span key={risk}>{risk}</span>
                ))}
              </div>
              <DocumentInsight entry={documentExtractions[report.url]} />
              <a className="source-link" href={report.url} target="_blank" rel="noreferrer">
                打开来源 <ExternalLink size={14} />
              </a>
          </article>
          ))
        ) : hasHkResearchIndex && hkResearchIndex ? (
          <HkResearchIndexView index={hkResearchIndex} documentExtractions={documentExtractions} />
        ) : (
          <div className="research-gap-state">
            <div className="research-gap-header">
              <div>
                <strong>{target.name} 还没有结构化研报摘要</strong>
                <p>
                  {target.market === "HK" && hkResearchLoading
                    ? "正在拉取港股公开研究索引，本轮会优先校验 HKEXnews、AAStocks 和公司 IR。"
                    : target.market === "HK" && hkResearchError
                      ? `港股公开索引本轮失败：${hkResearchError}`
                      : "这是覆盖缺口，不是负面评级。当前只能用行情、公告事实源和持仓风控做低置信度观察。"}
                </p>
              </div>
              <span>{target.code}</span>
            </div>
            <div className="source-action-grid">
              {sourceCards.map((source) => (
                <a className="source-action-card" href={source.url} target="_blank" rel="noreferrer" key={`${target.code}-${source.name}`}>
                  <span>{source.status}</span>
                  <strong>{source.name}</strong>
                  <p>{source.detail}</p>
                  <em>打开入口 <ExternalLink size={13} /></em>
                </a>
              ))}
            </div>
            <div className="coverage-ingestion-plan">
              <strong>入库后才会参与评分</strong>
              <span>报告日期</span>
              <span>机构/作者</span>
              <span>评级/目标价</span>
              <span>盈利预测修正</span>
              <span>风险标签</span>
              <span>原文链接</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MarketSnapshotPanel({
  stock,
  kline,
  period,
  onPeriodChange
}: {
  stock?: StockProfile;
  kline?: KlinePayload | null;
  period: KlinePeriod;
  onPeriodChange: (period: KlinePeriod) => void;
}) {
  if (!stock) {
    return (
      <section className="panel empty-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Market Snapshot</span>
            <h2>行情与技术面等待数据网关快照</h2>
          </div>
          <LineChart size={19} />
        </div>
        <p>
          该公司已纳入研报与题材研究池。连接本地数据网关后，前端会按代码拉取实时价格、K 线、资金流和技术指标。
        </p>
      </section>
    );
  }

  return (
    <>
      <TechnicalPanel stock={stock} kline={kline} period={period} onPeriodChange={onPeriodChange} />
      <FundamentalPanel stock={stock} />
      <SentimentPanel stock={stock} />
    </>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div className="progress-row">
      <span>{label}</span>
      <strong>{Math.round(value)}</strong>
      <div className="progress-track">
        <i style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function StrategyPanel({ stock }: { stock: StockProfile }) {
  const plan = stock.tradingPlan;
  return (
    <section className="panel strategy-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Decision</span>
          <h2>综合操作辅助</h2>
        </div>
        <Target size={19} />
      </div>
      <div className="strategy-topline">
        <ScoreDial score={stock.score} label={scoreBand(stock.score)} />
        <div>
          <span className={`action-pill action-${stock.action}`}>{stock.action}</span>
          <p>{plan ? `${plan.trend}：${plan.setup}` : stock.thesis}</p>
        </div>
      </div>
      {plan ? (
        <div className="trading-plan-grid">
          <MetricTile label="入场区" value={plan.entryZone} helper="靠近支撑/均线" mode="watch" />
          <MetricTile label="止损" value={plan.stopLoss} helper="结构失效价" mode="risk" />
          <MetricTile label="止盈" value={plan.takeProfit} helper={`R/R ${plan.riskReward}`} mode="good" />
          <MetricTile label="仓位" value={plan.positionSizing} helper="按可信度与趋势" mode="neutral" />
        </div>
      ) : null}
      <div className="weights">
        {strategyWeights.map((item) => (
          <div className={`weight-row ${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <div className="weight-track">
              <i style={{ width: `${item.value * 3}%` }} />
            </div>
            <strong>{item.value}%</strong>
          </div>
        ))}
      </div>
      <div className="decision-rules">
        {plan ? (
          <>
            <span><CheckIcon /> {plan.addCondition}</span>
            <span><CheckIcon /> {plan.positionSizing}</span>
            <span><WarnIcon /> {plan.invalidation}</span>
          </>
        ) : (
          <>
            <span><CheckIcon /> 价格高于 MA20 且 MACD 为正，允许小仓位试探</span>
            <span><CheckIcon /> 基本面分数高于 75，回撤到支撑区优先观察</span>
            <span><WarnIcon /> RSI 超过 70 或舆情热度过高时降低追涨权重</span>
          </>
        )}
      </div>
    </section>
  );
}

function CheckIcon() {
  return <span className="rule-icon ok" aria-hidden="true" />;
}

function WarnIcon() {
  return <span className="rule-icon warn" aria-hidden="true" />;
}

function SectorPanel() {
  return (
    <section className="panel sector-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Market Mood</span>
          <h2>板块热力</h2>
        </div>
        <Gauge size={19} />
      </div>
      <div className="sector-map">
        {sectorHeat.map((sector) => (
          <div
            className={`sector-cell ${sector.changePct >= 0 ? "hot" : "cold"}`}
            key={sector.name}
            style={{ "--heat": sector.heat } as React.CSSProperties}
          >
            <strong>{sector.name}</strong>
            <span>{formatPct(sector.changePct)}</span>
            <small>上涨家数 {sector.breadth}%</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function themeRecommendation(theme: ThemeCluster) {
  if (theme.recommendation) return theme.recommendation;
  if (theme.heat >= 86) return "重点跟踪";
  if (theme.heat >= 72) return "趋势观察";
  if (theme.heat >= 92) return "过热等待";
  return "低优先级";
}

function themeRecommendationTone(theme: ThemeCluster) {
  const recommendation = themeRecommendation(theme);
  if (recommendation === "重点跟踪") return "good";
  if (recommendation === "过热等待") return "risk";
  if (recommendation === "低优先级") return "neutral";
  return "watch";
}

function themeDefaultReason(theme: ThemeCluster, isDynamic: boolean) {
  if (theme.reason) return theme.reason;
  return isDynamic
    ? `${theme.name} 来自实时板块榜，热度 ${theme.heat}/100；仍需用龙头走势、成交额和研报/公告继续验证。`
    : `研究种子库主线：${theme.catalysts.slice(0, 2).join("，")}。当前不是实时推荐，需要等待行情网关确认。`;
}

function themeDefaultAction(theme: ThemeCluster) {
  if (theme.action) return theme.action;
  const recommendation = themeRecommendation(theme);
  if (recommendation === "重点跟踪") return "优先观察龙头回踩承接和放量突破，避免追高尾部补涨。";
  if (recommendation === "趋势观察") return "放入候选池，等成交和龙头强度二次确认。";
  if (recommendation === "过热等待") return "先等分歧和缩量回踩，不追板块一致高潮。";
  return "仅保留观察，不作为当日买入主线。";
}

function ThemeClusterPanel({
  themes,
  isDynamic
}: {
  themes: ThemeCluster[];
  isDynamic: boolean;
}) {
  return (
    <section className="panel theme-cluster-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{isDynamic ? "Live Theme Radar" : "Theme Radar"}</span>
          <h2>题材与板块主线</h2>
        </div>
        <Gauge size={19} />
      </div>
      <div className="theme-source-line">
        <span>{isDynamic ? "实时板块榜，不是硬编码" : "研究种子库兜底"}</span>
        <strong>{isDynamic ? "按涨幅、成交、主力净额、龙头强度综合排序" : "等待数据网关后切换实时推荐"}</strong>
      </div>
      <div className="theme-cluster-list">
        {themes.map((theme) => (
          <article className="theme-cluster-card" key={theme.name}>
            <div className="theme-cluster-head">
              <div>
                <strong>{theme.name}</strong>
                <small>{theme.stage} · {theme.leaders.join(" / ") || "龙头待校验"}</small>
              </div>
              <span className={`theme-recommendation ${themeRecommendationTone(theme)}`}>
                {themeRecommendation(theme)}
                <b>{theme.recommendationScore ?? theme.heat}</b>
              </span>
            </div>
            <p className="theme-reason">{themeDefaultReason(theme, isDynamic)}</p>
            <div className="theme-metrics">
              {(theme.metrics ?? [
                { label: "热度", value: `${theme.heat}/100`, tone: "watch" as const },
                { label: "龙头数", value: `${theme.leaders.length}`, tone: "neutral" as const },
                { label: "来源", value: isDynamic ? "实时榜" : "种子库", tone: isDynamic ? "good" as const : "neutral" as const }
              ]).map((metric) => (
                <span className={metric.tone ?? "neutral"} key={`${theme.name}-${metric.label}`}>
                  <b>{metric.label}</b>{metric.value}
                </span>
              ))}
            </div>
            <div className="theme-progress">
              <i style={{ width: `${theme.heat}%` }} />
            </div>
            <div className="theme-action">
              <b>交易结论</b>
              <span>{themeDefaultAction(theme)}</span>
            </div>
            {theme.trigger ? (
              <div className="theme-trigger">
                <b>触发条件</b>
                <span>{theme.trigger}</span>
              </div>
            ) : null}
            <p>{theme.catalysts.join("，")}</p>
            <div className="risk-tags compact">
              {theme.risks.slice(0, 3).map((risk) => (
                <span key={risk}>{risk}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function LiveFeed({
  events,
  selectedCode,
  gatewayState,
  streamState
}: {
  events: LiveEvent[];
  selectedCode: string;
  gatewayState: IfindConnectionState;
  streamState: IfindConnectionState;
}) {
  const statusText =
    streamState === "connected"
      ? "SSE 行情信息流已连接，盘中事件来自本地数据网关。"
      : gatewayState === "connected"
        ? "行情快照已接入，信息流正在连接或重试；当前混合展示研报事件和已收到的网关事件。"
        : "未检测到可用信息流，当前展示研报/公告事件回放。";

  return (
    <section className="panel live-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Live Stream</span>
          <h2>实时信息流</h2>
        </div>
        <span className={`stream-pill ${streamState}`}>
          <Newspaper size={15} />
          {streamLabel(streamState)}
        </span>
      </div>
      <p className="feed-status-line">{statusText}</p>
      <div className="feed-list">
        {events.map((event) => (
          <article
            className={`feed-item ${event.stockCode === selectedCode ? "focused" : ""} ${event.tone}`}
            key={event.id}
          >
            <time>{event.time}</time>
            <span className="feed-source">{event.source}</span>
            <div>
              <strong>{event.stockName ? `${event.stockName} · ` : ""}{event.title}</strong>
              <small>影响度 {event.impact}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AlertPanel({ stock }: { stock: StockProfile }) {
  const alerts = [
    {
      label: `突破压力位 ${stock.technicals.resistance.toFixed(2)}`,
      active: stock.price > stock.technicals.resistance * 0.98
    },
    {
      label: `跌破 MA60 ${stock.technicals.ma60.toFixed(2)}`,
      active: stock.price < stock.technicals.ma60
    },
    {
      label: "舆情分低于 45",
      active: stock.sentiment.score < 45
    },
    {
      label: "主力净流入转负",
      active: stock.sentiment.mainNetInflow < 0
    }
  ];

  return (
    <section className="panel alert-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Monitor</span>
          <h2>监控触发器</h2>
        </div>
        <Bell size={19} />
      </div>
      <div className="alert-list">
        {alerts.map((alert) => (
          <label className="alert-row" key={alert.label}>
            <input type="checkbox" defaultChecked={alert.active} />
            <span>{alert.label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function App() {
  const [selectedCode, setSelectedCode] = useState(stocks[1].code);
  const requestedDocumentUrls = useRef<Set<string>>(new Set());
  const [selectedPeriod, setSelectedPeriod] = useState<KlinePeriod>("day");
  const [snapshots, setSnapshots] = useState(stocks);
  const [holdingSnapshots, setHoldingSnapshots] = useState<Record<string, StockProfile>>({});
  const [klineSeries, setKlineSeries] = useState<Record<string, KlinePayload>>({});
  const [indexes, setIndexes] = useState(marketIndexes);
  const [providers, setProviders] = useState<DataProvider[]>([]);
  const [hkResearchIndexes, setHkResearchIndexes] = useState<Record<string, HkResearchIndex>>({});
  const [hkResearchLoadState, setHkResearchLoadState] = useState<Record<string, HkResearchLoadState>>({});
  const [documentExtractions, setDocumentExtractions] = useState<Record<string, DocumentExtractionEntry>>({});
  const [events, setEvents] = useState<LiveEvent[]>(() => reportDigests.map(reportToEvent).slice(0, 12));
  const [dynamicThemes, setDynamicThemes] = useState<ThemeCluster[]>(themeClusters);
  const [isDynamicThemeReady, setIsDynamicThemeReady] = useState(false);
  const [gatewayState, setGatewayState] = useState<IfindConnectionState>("seed");
  const [streamState, setStreamState] = useState<IfindConnectionState>("seed");
  const [accountSession, setAccountSession] = useState<AccountSession>({ authenticated: false, account: null });
  const [accountPortfolio, setAccountPortfolio] = useState<AccountPortfolio | null>(null);
  const [accountState, setAccountState] = useState<"checking" | "locked" | "loading" | "ready" | "error">("checking");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [holdingEditor, setHoldingEditor] = useState<HoldingEditorState>(null);
  const [holdingToDelete, setHoldingToDelete] = useState<PortfolioHolding | null>(null);
  const supabaseReady = isSupabaseConfigured();
  const [now, setNow] = useState(() => Date.now());
  const [portfolioRefreshMeta, setPortfolioRefreshMeta] = useState<PortfolioRefreshMeta>({
    state: "idle",
    lastStartedAt: null,
    lastCompletedAt: null,
    nextRefreshAt: null,
    successCount: 0,
    failedCount: 0,
    reason: "启动刷新",
    error: null
  });
  const selectedStock = snapshots.find((stock) => stock.code === selectedCode) ?? holdingSnapshots[selectedCode];
  const selectedKline = klineSeries[`${selectedCode}-${selectedPeriod}`];
  const selectedResearch = getResearchByCode(selectedCode);
  const portfolioHoldings = useMemo(() => accountPortfolio?.holdings ?? [], [accountPortfolio]);
  const portfolioBrokerSnapshot = accountPortfolio?.brokerSnapshot ?? null;
  const selectedHolding = portfolioHoldings.find((holding) => holding.code === selectedCode);
  const selectedReports = getReportsByCode(selectedCode);
  const researchTarget = useMemo<ResearchCoverageTarget>(() => {
    const code = selectedResearch?.code ?? selectedStock?.code ?? selectedHolding?.code ?? selectedCode;
    return {
      code,
      name: selectedResearch?.name ?? selectedStock?.name ?? selectedHolding?.name ?? code,
      market: selectedHolding?.market ?? selectedStock?.market ?? (code.startsWith("H") ? "HK" : "A"),
      sector: selectedResearch?.sector ?? selectedStock?.sector ?? selectedHolding?.sector ?? "未分类"
    };
  }, [selectedResearch, selectedStock, selectedHolding, selectedCode]);
  const selectedHkResearchIndex = researchTarget.market === "HK" ? hkResearchIndexes[researchTarget.code] : null;
  const selectedHkResearchLoadState = researchTarget.market === "HK"
    ? hkResearchLoadState[researchTarget.code]
    : undefined;
  const selectedDocumentTargets = useMemo<ResearchDocumentRequest[]>(() => {
    const targets: ResearchDocumentRequest[] = [
      ...selectedReports.map((report) => ({
        url: report.url,
        code: report.code,
        title: report.title,
        source: report.source
      })),
      ...(selectedHkResearchIndex?.items ?? []).slice(0, 8).map((item) => ({
        url: item.url,
        code: item.code,
        title: item.title,
        source: item.source
      }))
    ].filter((item) => isExtractableResearchUrl(item.url));

    return Array.from(
      targets.reduce((map, item) => {
        if (!map.has(item.url)) map.set(item.url, item);
        return map;
      }, new Map<string, ResearchDocumentRequest>()).values()
    ).slice(0, 8);
  }, [selectedReports, selectedHkResearchIndex]);
  const portfolioAnalyses = useMemo(() => buildPortfolioAnalyses(portfolioHoldings, holdingSnapshots), [portfolioHoldings, holdingSnapshots]);
  const publicEvents = useMemo(() => reportDigests.map(reportToEvent), []);
  const displayedEvents = streamState === "connected"
    ? events
    : [...selectedReports.map(reportToEvent), ...publicEvents.filter((event) => event.stockCode !== selectedCode)]
      .slice(0, 12);

  const loadAccountPortfolio = useCallback(async () => {
    setAccountState("loading");
    setAccountError(null);
    const portfolio = await fetchAccountPortfolio();
    setAccountPortfolio(portfolio);
    setAccountSession({ authenticated: true, account: portfolio.account });
    setAccountState("ready");
    setSelectedCode((current) =>
      portfolio.holdings.some((holding) => holding.code === current)
        ? current
        : portfolio.holdings[0]?.code ?? current
    );
    return portfolio;
  }, []);

  const handleAccountLogin = useCallback(async (username: string, password: string) => {
    setAccountState("loading");
    setAccountError(null);
    try {
      const session = await loginAccount(username, password);
      setAccountSession(session);
      await loadAccountPortfolio();
      setIsAccountModalOpen(false);
    } catch (error) {
      setAccountState("error");
      setAccountError(error instanceof Error ? error.message : String(error));
      setIsAccountModalOpen(true);
    }
  }, [loadAccountPortfolio]);

  const handleAccountLogout = useCallback(async () => {
    await logoutAccount();
    setAccountSession({ authenticated: false, account: null });
    setAccountPortfolio(null);
    setHoldingSnapshots({});
    setHoldingEditor(null);
    setHoldingToDelete(null);
    setPortfolioRefreshMeta({
      state: "idle",
      lastStartedAt: null,
      lastCompletedAt: null,
      nextRefreshAt: null,
      successCount: 0,
      failedCount: 0,
      reason: "启动刷新",
      error: null
    });
    setAccountState("locked");
    setSelectedCode(stocks[1].code);
  }, []);

  const handleSaveHolding = useCallback(async (input: AddPortfolioHoldingInput) => {
    const savedCode =
      holdingEditor?.mode === "edit"
        ? await updatePortfolioHolding(holdingEditor.holding.code, input)
        : await addPortfolioHolding(input);
    await loadAccountPortfolio();
    setSelectedCode(savedCode);

    try {
      const snapshot = await fetchIfindSnapshot(savedCode);
      if (!snapshot) return;
      setGatewayState("connected");
      setHoldingSnapshots((current) => ({ ...current, [snapshot.code]: snapshot }));
      setSnapshots((current) => mergeSnapshots(current, [snapshot]));
    } catch {
      // Saving the private holding should not fail just because the public quote gateway is unavailable.
    }
  }, [holdingEditor, loadAccountPortfolio]);

  const handleDeleteHolding = useCallback(async (holding: PortfolioHolding) => {
    await deletePortfolioHolding(holding.code);
    const portfolio = await loadAccountPortfolio();
    setHoldingSnapshots((current) => {
      const next = { ...current };
      delete next[holding.code];
      return next;
    });
    setSelectedCode((current) =>
      current === holding.code
        ? portfolio.holdings[0]?.code ?? stocks[1].code
        : current
    );
  }, [loadAccountPortfolio]);

  const refreshPortfolioSnapshots = useCallback(async (reason: PortfolioRefreshMeta["reason"]) => {
    if (!accountSession.authenticated || !portfolioHoldings.length) return;
    const startedAt = new Date().toISOString();
    setPortfolioRefreshMeta((current) => ({
      ...current,
      state: "refreshing",
      reason,
      lastStartedAt: startedAt,
      error: null
    }));

    const results = await Promise.allSettled(portfolioHoldings.map((holding) => fetchIfindSnapshot(holding.code)));
    const fulfilled = results
      .filter((result): result is PromiseFulfilledResult<StockProfile | null> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((snapshot): snapshot is StockProfile => Boolean(snapshot));
    const failedCount = results.length - fulfilled.length;
    const completedAt = new Date().toISOString();

    if (fulfilled.length > 0) {
      setGatewayState("connected");
      setHoldingSnapshots((current) => {
        const next = { ...current };
        fulfilled.forEach((snapshot) => {
          next[snapshot.code] = snapshot;
        });
        return next;
      });
      setSnapshots((current) => mergeSnapshots(current, fulfilled));
    }

    setPortfolioRefreshMeta({
      state: fulfilled.length > 0 ? "idle" : "error",
      lastStartedAt: startedAt,
      lastCompletedAt: fulfilled.length > 0 ? completedAt : null,
      nextRefreshAt: new Date(Date.now() + PORTFOLIO_REFRESH_MS).toISOString(),
      successCount: fulfilled.length,
      failedCount,
      reason,
      error:
        fulfilled.length > 0
          ? failedCount > 0
            ? `${failedCount} 个持仓快照暂未返回，已保留上一轮可用数据。`
            : null
          : "本轮持仓行情源全部失败，页面保留上一轮可用数据。"
    });
  }, [accountSession.authenticated, portfolioHoldings]);

  useEffect(() => {
    setGatewayState("connecting");
    Promise.allSettled([fetchDataProviders(selectedCode), fetchMarketIndexes()]).then(([providerResult, indexResult]) => {
      let hasGatewayData = false;

      if (providerResult.status === "fulfilled" && providerResult.value) {
        setProviders(providerResult.value);
        hasGatewayData = true;
      }

      if (indexResult.status === "fulfilled" && indexResult.value) {
        setIndexes(indexResult.value);
        hasGatewayData = true;
      }

      setGatewayState(hasGatewayData ? "connected" : "error");
    });
  }, [selectedCode]);

  useEffect(() => {
    if (researchTarget.market !== "HK") return undefined;
    const code = researchTarget.code;
    if (hkResearchIndexes[code]) return undefined;

    let isMounted = true;
    setHkResearchLoadState((current) => ({
      ...current,
      [code]: { loading: true, error: null }
    }));

    fetchHkResearchIndex(code)
      .then((index) => {
        if (!isMounted || !index) return;
        setHkResearchIndexes((current) => ({ ...current, [code]: index }));
        setHkResearchLoadState((current) => ({
          ...current,
          [code]: { loading: false, error: null }
        }));
      })
      .catch((error) => {
        if (!isMounted) return;
        setHkResearchLoadState((current) => ({
          ...current,
          [code]: {
            loading: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }));
      });

    return () => {
      isMounted = false;
    };
  }, [researchTarget.code, researchTarget.market]);

  useEffect(() => {
    const missingTargets = selectedDocumentTargets.filter((target) => !requestedDocumentUrls.current.has(target.url));
    if (!missingTargets.length) return undefined;

    missingTargets.forEach((target) => requestedDocumentUrls.current.add(target.url));
    setDocumentExtractions((current) => {
      const next = { ...current };
      missingTargets.forEach((target) => {
        next[target.url] = { state: "loading" };
      });
      return next;
    });

    missingTargets.forEach((target) => {
      fetchResearchDocument(target)
        .then((data) => {
          if (!data) return;
          setDocumentExtractions((current) => ({
            ...current,
            [target.url]: { state: "ready", data }
          }));
        })
        .catch((error) => {
          setDocumentExtractions((current) => ({
            ...current,
            [target.url]: {
              state: "error",
              error: error instanceof Error ? error.message : String(error)
            }
          }));
        });
    });

    return undefined;
  }, [selectedDocumentTargets]);

  useEffect(() => {
    let isMounted = true;
    fetchIfindThemes()
      .then((themes) => {
        if (!isMounted || !themes?.length) return;
        setDynamicThemes(themes);
        setIsDynamicThemeReady(true);
      })
      .catch(() => {
        if (!isMounted) return;
        setDynamicThemes(themeClusters);
        setIsDynamicThemeReady(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    fetchAccountSession()
      .then(async (session) => {
        if (!isMounted) return;
        setAccountSession(session);
        if (session.authenticated) {
          try {
            await loadAccountPortfolio();
          } catch (error) {
            if (!isMounted) return;
            setAccountState("error");
            setAccountError(error instanceof Error ? error.message : String(error));
            setIsAccountModalOpen(true);
          }
        } else {
          setAccountState("locked");
        }
      })
      .catch((error) => {
        if (!isMounted) return;
        setAccountState("error");
        setAccountError(error instanceof Error ? error.message : String(error));
        setIsAccountModalOpen(true);
      });

    return () => {
      isMounted = false;
    };
  }, [loadAccountPortfolio]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!accountSession.authenticated || !portfolioHoldings.length) return undefined;
    refreshPortfolioSnapshots("启动刷新");
    const refreshTimer = window.setInterval(() => {
      refreshPortfolioSnapshots("自动刷新");
    }, PORTFOLIO_REFRESH_MS);

    return () => window.clearInterval(refreshTimer);
  }, [accountSession.authenticated, portfolioHoldings.length, refreshPortfolioSnapshots]);

  useEffect(() => {
    let isMounted = true;
    fetchIfindSnapshot(selectedCode)
      .then((snapshot) => {
        if (!snapshot || !isMounted) return;
        setGatewayState("connected");
        if (portfolioHoldings.some((holding) => holding.code === snapshot.code)) {
          setHoldingSnapshots((current) => ({ ...current, [snapshot.code]: snapshot }));
        }
        setSnapshots((current) =>
          current.some((stock) => stock.code === snapshot.code)
            ? current.map((stock) => (stock.code === snapshot.code ? snapshot : stock))
            : [...current, snapshot]
        );
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, [selectedCode]);

  useEffect(() => {
    let isMounted = true;
    fetchMarketKline(selectedCode, selectedPeriod)
      .then((payload) => {
        if (!payload || !isMounted) return;
        setKlineSeries((current) => ({
          ...current,
          [`${selectedCode}-${selectedPeriod}`]: payload
        }));
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, [selectedCode, selectedPeriod]);

  useEffect(() => {
    if (!hasIfindEndpoint()) {
      setStreamState("seed");
      return;
    }

    if (gatewayState !== "connected") {
      return;
    }

    const disconnect = connectIfindStream(
      Array.from(new Set([
        ...(accountSession.authenticated ? portfolioHoldings.map((item) => item.code) : []),
        ...companyResearch.map((item) => item.code)
      ])),
      (event) => setEvents((current) => [event, ...current].slice(0, 12)),
      setStreamState
    );

    return disconnect;
  }, [gatewayState, accountSession.authenticated, portfolioHoldings]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">
            <Activity size={22} />
          </div>
          <div>
            <span className="eyebrow">Multi-Source A/H-Share Research</span>
            <h1>stockarena</h1>
          </div>
        </div>
        <div className="topbar-actions">
          {accountSession.authenticated ? (
            <button type="button" className="account-button connected" onClick={() => setIsAccountModalOpen(true)}>
              <Lock size={16} />
              {accountSession.account?.email ?? accountSession.account?.username ?? "已登录"}
              <small>UID {shortId(accountSession.account?.userId)}</small>
            </button>
          ) : (
            <button type="button" className="account-button" onClick={() => setIsAccountModalOpen(true)}>
              <Lock size={16} />
              登录 / 持仓
            </button>
          )}
          {accountSession.authenticated ? (
            <button type="button" className="logout-button" onClick={handleAccountLogout}>
              <LogOut size={15} />
              退出
            </button>
          ) : null}
          <span className={`connection-pill ${gatewayState}`}>
            <Database size={16} />
            {connectionLabel(gatewayState)}
          </span>
          <span className="time-pill">
            <Clock size={16} />
            {new Date().toLocaleDateString("zh-CN")} 盘中
          </span>
        </div>
      </header>

      <MarketStrip indexes={indexes} />

      <div className="research-overview-grid">
        <FrameworkPanel />
        <DataSourcePanel gatewayState={gatewayState} streamState={streamState} providers={providers} />
        <HkResearchSourcePanel />
      </div>

      {accountSession.authenticated && accountSession.account && portfolioBrokerSnapshot ? (
        <PortfolioPanel
          analyses={portfolioAnalyses}
          holdings={portfolioHoldings}
          brokerSnapshot={portfolioBrokerSnapshot}
          account={accountSession.account}
          selectedCode={selectedCode}
          refreshMeta={portfolioRefreshMeta}
          now={now}
          onSelect={setSelectedCode}
          onRefresh={() => refreshPortfolioSnapshots("手动刷新")}
          onAddHolding={() => setHoldingEditor({ mode: "create" })}
          onEditHolding={(holding) => setHoldingEditor({ mode: "edit", holding })}
          onDeleteHolding={setHoldingToDelete}
        />
      ) : null}

      {isAccountModalOpen ? (
        <AccountModal
          state={accountState}
          error={accountError}
          configured={supabaseReady}
          account={accountSession.account}
          onClose={() => setIsAccountModalOpen(false)}
          onLogout={handleAccountLogout}
          onLogin={handleAccountLogin}
        />
      ) : null}

      {holdingEditor && accountSession.authenticated ? (
        <AddHoldingModal
          key={holdingEditor.mode === "edit" ? `edit-${holdingEditor.holding.code}` : "create"}
          mode={holdingEditor.mode}
          initialHolding={holdingEditor.mode === "edit" ? holdingEditor.holding : undefined}
          onClose={() => setHoldingEditor(null)}
          onSave={handleSaveHolding}
        />
      ) : null}

      {holdingToDelete && accountSession.authenticated ? (
        <DeleteHoldingModal
          holding={holdingToDelete}
          onClose={() => setHoldingToDelete(null)}
          onDelete={() => handleDeleteHolding(holdingToDelete)}
        />
      ) : null}

      <div className="dashboard-grid">
        <Watchlist selectedCode={selectedCode} snapshots={snapshots} onSelect={setSelectedCode} />

        <div className="main-column">
          <section className="stock-hero panel">
            <div className="stock-hero-main">
              <div>
                <span className="eyebrow">
                  {selectedResearch?.code ?? selectedStock?.code ?? selectedHolding?.code ?? selectedCode} · {selectedResearch?.sector ?? selectedStock?.sector ?? selectedHolding?.sector ?? "快照加载中"}
                </span>
                <h2>{selectedResearch?.name ?? selectedStock?.name ?? selectedHolding?.name ?? selectedCode}</h2>
              </div>
              {selectedStock ? (
                <div className="price-block">
                  <strong>{currencyFormatter.format(selectedStock.price)}</strong>
                  <span className={toneClass(selectedStock.changePct)}>
                    {selectedStock.changePct >= 0 ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
                    {formatPct(selectedStock.changePct)}
                  </span>
                </div>
              ) : (
                <div className="price-block research-only">
                  <strong>{selectedResearch?.reportTrend ?? "待接入"}</strong>
                  <span>行情等数据网关快照</span>
                </div>
              )}
            </div>
            <div className="hero-stats">
              <MetricTile
                label="市场快照"
                value={selectedStock ? `${integerFormatter.format(selectedStock.marketCap)} 亿` : "待网关"}
                helper={selectedStock ? "总市值口径" : "不使用假行情"}
              />
              <MetricTile
                label="题材评分"
                value={`${selectedResearch?.themeScore ?? selectedStock?.score ?? 0}/100`}
                helper={selectedResearch?.consensus ?? "基本面 + 技术 + 情绪"}
                mode={(selectedResearch?.themeScore ?? selectedStock?.score ?? 0) >= 75 ? "good" : "watch"}
              />
              <MetricTile
                label="研报趋势"
                value={selectedResearch?.reportTrend ?? selectedStock?.action ?? "待补全"}
                helper={selectedResearch ? `${selectedResearch.reportCount} 份公开资料` : "等待研报库"}
                mode={selectedResearch?.reportTrend === "下修" ? "risk" : selectedResearch?.reportTrend === "分歧" ? "watch" : "good"}
              />
            </div>
          </section>

          <RecommendationPanel research={selectedResearch} stock={selectedStock} reports={selectedReports} />
          {selectedStock ? <DataQualityPanel stock={selectedStock} /> : null}
          <ResearchConsensusPanel research={selectedResearch} target={researchTarget} />
          <ReportDigestPanel
            reports={selectedReports}
            target={researchTarget}
            hkResearchIndex={selectedHkResearchIndex}
            documentExtractions={documentExtractions}
            hkResearchLoading={selectedHkResearchLoadState?.loading}
            hkResearchError={selectedHkResearchLoadState?.error}
          />
          <MarketSnapshotPanel
            stock={selectedStock}
            kline={selectedKline}
            period={selectedPeriod}
            onPeriodChange={setSelectedPeriod}
          />
        </div>

        <div className="side-column">
          {selectedStock ? <StrategyPanel stock={selectedStock} /> : <ResearchConsensusPanel research={selectedResearch} target={researchTarget} />}
          <LiveFeed
            events={displayedEvents}
            selectedCode={selectedCode}
            gatewayState={gatewayState}
            streamState={streamState}
          />
          <ThemeClusterPanel themes={dynamicThemes} isDynamic={isDynamicThemeReady} />
          <SectorPanel />
          {selectedStock ? <AlertPanel stock={selectedStock} /> : null}
        </div>
      </div>

      <footer className="risk-footer">
        <ShieldAlert size={16} />
        数据与信号用于研究和风控展示，不构成任何投资建议；真实交易前请以交易所公告、券商系统和授权数据源为准。
      </footer>
    </main>
  );
}

export default App;
