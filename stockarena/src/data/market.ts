export type FundamentalProfile = {
  pe: number | null;
  pb: number | null;
  roe: number | null;
  revenueYoy: number | null;
  profitYoy: number | null;
  grossMargin: number | null;
  debtRatio: number | null;
  ocfToProfit: number | null;
  dividendYield: number | null;
};

export type TechnicalProfile = {
  close: number[];
  volume: number[];
  ma20: number;
  ma60: number;
  rsi: number;
  macd: number;
  support: number;
  resistance: number;
  turnoverRate: number;
  volatility: number;
};

export type KlinePeriod = "day" | "week" | "month" | "year";

export type KlineBar = {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  amplitude: number;
  pct: number;
  change: number;
  turnover: number;
};

export type KlinePayload = {
  code: string;
  market?: "A" | "HK";
  period: KlinePeriod;
  label: string;
  providerId: string;
  providerName: string;
  confidence: number;
  verifiedSources: string[];
  upstreamWarning?: string | null;
  lastUpdatedAt: string;
  items: KlineBar[];
  technicals: TechnicalProfile;
};

export type SentimentProfile = {
  score: number;
  newsTone: number;
  socialHeat: number;
  northbound: number;
  marginBalanceChange: number;
  mainNetInflow: number;
  riskTags: string[];
};

export type LiveEvent = {
  id: string;
  time: string;
  source: "公告" | "新闻" | "资金" | "研报" | "舆情" | "技术";
  stockCode?: string;
  stockName?: string;
  title: string;
  tone: "positive" | "neutral" | "negative";
  impact: number;
};

export type QuoteSourceCheck = {
  providerId: string;
  providerName: string;
  status: "verified" | "disagreed" | "failed" | "received";
  price: number | null;
  changePct: number | null;
  timestamp: string | null;
  priceDiffPct: number | null;
  changeDiffPct: number | null;
  error: string | null;
};

export type DataQualityProfile = {
  quoteConfidence: number;
  quoteConsensus: string;
  consensusPrice: number;
  consensusChangePct: number;
  priceSpreadPct: number;
  sourceCount: number;
  verifiedSourceCount: number;
  failedSourceCount: number;
  verifiedSources: string[];
  failedSources: string[];
  disagreedSources: string[];
  lastVerifiedAt: string;
  sources: QuoteSourceCheck[];
};

export type TradingPlan = {
  action: "分批关注" | "等待回调" | "继续观察" | "风险警惕";
  trend: string;
  setup: string;
  entryZone: string;
  addCondition: string;
  stopLoss: string;
  takeProfit: string;
  riskReward: number;
  positionSizing: string;
  invalidation: string;
  notes: string[];
};

export type StockProfile = {
  code: string;
  market?: "A" | "HK";
  name: string;
  sector: string;
  price: number;
  changePct: number;
  marketCap: number;
  score: number;
  action: "分批关注" | "等待回调" | "继续观察" | "风险警惕";
  thesis: string;
  fundamentals: FundamentalProfile;
  technicals: TechnicalProfile;
  sentiment: SentimentProfile;
  dataQuality?: DataQualityProfile;
  tradingPlan?: TradingPlan;
  events: LiveEvent[];
};

export type MarketSecurity = {
  code: string;
  rawCode: string;
  name: string;
  market: "A" | "HK";
  sector: string;
  region: string;
  themes: string[];
  price: number;
  changePct: number;
  turnover: number;
  marketCap: number;
  source: string;
  isInResearchPool?: boolean;
};

export type MarketIndex = {
  name: string;
  value: number;
  changePct: number;
  turnover: number;
};

export type SectorHeat = {
  name: string;
  changePct: number;
  heat: number;
  breadth: number;
};

export const marketIndexes: MarketIndex[] = [
  { name: "上证指数", value: 3314.72, changePct: 0.42, turnover: 4120 },
  { name: "深证成指", value: 10588.31, changePct: 0.88, turnover: 5364 },
  { name: "创业板指", value: 2187.65, changePct: -0.18, turnover: 2178 },
  { name: "科创50", value: 913.44, changePct: 1.16, turnover: 831 }
];

export const sectorHeat: SectorHeat[] = [
  { name: "半导体", changePct: 2.74, heat: 92, breadth: 78 },
  { name: "电力设备", changePct: 1.83, heat: 81, breadth: 65 },
  { name: "白酒", changePct: 0.66, heat: 54, breadth: 48 },
  { name: "银行", changePct: -0.21, heat: 39, breadth: 42 },
  { name: "医药", changePct: 1.12, heat: 68, breadth: 61 },
  { name: "人工智能", changePct: 2.31, heat: 88, breadth: 73 },
  { name: "地产链", changePct: -1.04, heat: 31, breadth: 29 },
  { name: "券商", changePct: 0.34, heat: 47, breadth: 52 },
  { name: "新能源车", changePct: 1.45, heat: 76, breadth: 67 },
  { name: "军工", changePct: 0.93, heat: 62, breadth: 58 }
];

const baseEvents: LiveEvent[] = [
  {
    id: "ev-001",
    time: "09:33:12",
    source: "资金",
    stockCode: "300750",
    stockName: "宁德时代",
    title: "北向资金连续 3 笔净流入，新能源车链情绪升温",
    tone: "positive",
    impact: 86
  },
  {
    id: "ev-002",
    time: "09:41:28",
    source: "技术",
    stockCode: "688981",
    stockName: "中芯国际",
    title: "价格站上 20 日均线，量能较 5 日均值放大",
    tone: "positive",
    impact: 79
  },
  {
    id: "ev-003",
    time: "09:52:44",
    source: "公告",
    stockCode: "600519",
    stockName: "贵州茅台",
    title: "核心产品批价保持平稳，渠道库存压力继续回落",
    tone: "neutral",
    impact: 58
  },
  {
    id: "ev-004",
    time: "10:06:17",
    source: "舆情",
    stockCode: "002594",
    stockName: "比亚迪",
    title: "新车型关注度升至行业前 5，但短线拥挤度同步抬升",
    tone: "positive",
    impact: 72
  },
  {
    id: "ev-005",
    time: "10:18:06",
    source: "新闻",
    stockCode: "000001",
    stockName: "平安银行",
    title: "银行板块成交占比下降，市场风险偏好转向成长方向",
    tone: "negative",
    impact: 63
  },
  {
    id: "ev-006",
    time: "10:27:33",
    source: "研报",
    stockCode: "600276",
    stockName: "恒瑞医药",
    title: "创新药出海预期强化，机构上修未来两年利润弹性",
    tone: "positive",
    impact: 82
  }
];

export const stocks: StockProfile[] = [
  {
    code: "600519",
    name: "贵州茅台",
    sector: "白酒",
    price: 1518.2,
    changePct: 0.64,
    marketCap: 19080,
    score: 81,
    action: "分批关注",
    thesis: "盈利质量稳定、现金流强，估值处于近三年偏低分位；短线弹性一般，适合作为核心资产观察。",
    fundamentals: {
      pe: 24.8,
      pb: 8.5,
      roe: 31.6,
      revenueYoy: 16.4,
      profitYoy: 17.2,
      grossMargin: 91.4,
      debtRatio: 15.7,
      ocfToProfit: 1.18,
      dividendYield: 2.1
    },
    technicals: {
      close: [1450, 1468, 1461, 1480, 1476, 1492, 1501, 1496, 1514, 1518, 1523, 1518],
      volume: [82, 86, 78, 91, 88, 94, 101, 95, 106, 112, 109, 103],
      ma20: 1492.4,
      ma60: 1511.7,
      rsi: 57,
      macd: 0.34,
      support: 1460,
      resistance: 1548,
      turnoverRate: 0.34,
      volatility: 18.6
    },
    sentiment: {
      score: 67,
      newsTone: 58,
      socialHeat: 46,
      northbound: 2.8,
      marginBalanceChange: -0.4,
      mainNetInflow: 1.2,
      riskTags: ["短线量能一般", "估值修复依赖业绩兑现"]
    },
    events: [baseEvents[2]]
  },
  {
    code: "300750",
    name: "宁德时代",
    sector: "电力设备",
    price: 226.74,
    changePct: 1.92,
    marketCap: 9970,
    score: 86,
    action: "分批关注",
    thesis: "龙头份额与现金流韧性较强，海外储能与动力电池订单提供中期支撑；关注原材料价格与产能利用率。",
    fundamentals: {
      pe: 19.6,
      pb: 4.2,
      roe: 24.1,
      revenueYoy: 10.8,
      profitYoy: 18.9,
      grossMargin: 24.6,
      debtRatio: 68.8,
      ocfToProfit: 1.06,
      dividendYield: 1.0
    },
    technicals: {
      close: [205, 207, 211, 214, 212, 216, 219, 221, 220, 223, 225, 226.7],
      volume: [118, 124, 130, 144, 136, 151, 163, 170, 154, 177, 189, 201],
      ma20: 216.3,
      ma60: 209.2,
      rsi: 64,
      macd: 1.42,
      support: 214.5,
      resistance: 232.8,
      turnoverRate: 1.42,
      volatility: 31.2
    },
    sentiment: {
      score: 82,
      newsTone: 76,
      socialHeat: 84,
      northbound: 8.7,
      marginBalanceChange: 2.4,
      mainNetInflow: 4.9,
      riskTags: ["短线热度偏高", "板块轮动速度快"]
    },
    events: [baseEvents[0]]
  },
  {
    code: "688981",
    name: "中芯国际",
    sector: "半导体",
    price: 52.39,
    changePct: 3.28,
    marketCap: 4160,
    score: 78,
    action: "等待回调",
    thesis: "国产替代与先进封装预期驱动估值扩张，基本面仍处于修复过程；价格突破后需要观察换手承接。",
    fundamentals: {
      pe: 63.4,
      pb: 2.9,
      roe: 4.7,
      revenueYoy: 12.6,
      profitYoy: -8.2,
      grossMargin: 18.1,
      debtRatio: 36.8,
      ocfToProfit: 1.42,
      dividendYield: 0.2
    },
    technicals: {
      close: [45.4, 46.1, 45.8, 47.2, 48.1, 48.6, 49.2, 49.8, 50.6, 51.8, 52.1, 52.39],
      volume: [96, 102, 98, 115, 139, 147, 152, 166, 188, 223, 236, 250],
      ma20: 49.2,
      ma60: 47.6,
      rsi: 71,
      macd: 1.08,
      support: 49.6,
      resistance: 54.2,
      turnoverRate: 2.86,
      volatility: 38.4
    },
    sentiment: {
      score: 89,
      newsTone: 82,
      socialHeat: 91,
      northbound: 3.2,
      marginBalanceChange: 4.6,
      mainNetInflow: 6.3,
      riskTags: ["RSI 偏热", "利润增速仍待确认"]
    },
    events: [baseEvents[1]]
  },
  {
    code: "002594",
    name: "比亚迪",
    sector: "新能源车",
    price: 258.16,
    changePct: 1.38,
    marketCap: 7515,
    score: 83,
    action: "继续观察",
    thesis: "销量与出口结构改善，品牌矩阵进入新品周期；技术面趋势向上，但同业价格竞争仍需跟踪。",
    fundamentals: {
      pe: 21.7,
      pb: 4.7,
      roe: 22.9,
      revenueYoy: 18.4,
      profitYoy: 25.7,
      grossMargin: 20.8,
      debtRatio: 75.1,
      ocfToProfit: 0.92,
      dividendYield: 1.3
    },
    technicals: {
      close: [239, 242, 241, 245, 247, 249, 251, 253, 252, 256, 257, 258.2],
      volume: [121, 119, 128, 132, 140, 156, 151, 158, 149, 171, 176, 183],
      ma20: 249.1,
      ma60: 242.7,
      rsi: 62,
      macd: 1.2,
      support: 247.2,
      resistance: 264.8,
      turnoverRate: 1.66,
      volatility: 29.5
    },
    sentiment: {
      score: 75,
      newsTone: 70,
      socialHeat: 86,
      northbound: 5.4,
      marginBalanceChange: 1.7,
      mainNetInflow: 2.9,
      riskTags: ["竞争格局波动", "舆情热度升温"]
    },
    events: [baseEvents[3]]
  },
  {
    code: "600276",
    name: "恒瑞医药",
    sector: "医药",
    price: 48.32,
    changePct: 2.08,
    marketCap: 3082,
    score: 80,
    action: "分批关注",
    thesis: "创新药管线进入兑现期，利润增速修复；医药板块机构配置处于低位，具备中期再定价空间。",
    fundamentals: {
      pe: 39.8,
      pb: 5.8,
      roe: 14.9,
      revenueYoy: 14.2,
      profitYoy: 21.5,
      grossMargin: 84.6,
      debtRatio: 12.3,
      ocfToProfit: 0.98,
      dividendYield: 0.5
    },
    technicals: {
      close: [42.8, 43.2, 44.1, 44.6, 45.2, 45.8, 46.1, 46.9, 47.4, 47.8, 48.1, 48.32],
      volume: [84, 88, 96, 101, 104, 115, 112, 124, 131, 139, 147, 151],
      ma20: 46.2,
      ma60: 44.8,
      rsi: 66,
      macd: 0.72,
      support: 45.6,
      resistance: 50.4,
      turnoverRate: 1.04,
      volatility: 25.2
    },
    sentiment: {
      score: 78,
      newsTone: 86,
      socialHeat: 62,
      northbound: 1.9,
      marginBalanceChange: 0.8,
      mainNetInflow: 2.6,
      riskTags: ["研发兑现节奏", "集采政策扰动"]
    },
    events: [baseEvents[5]]
  },
  {
    code: "000001",
    name: "平安银行",
    sector: "银行",
    price: 11.26,
    changePct: -0.72,
    marketCap: 2185,
    score: 61,
    action: "风险警惕",
    thesis: "估值低位但资产质量预期仍压制板块弹性；除非成交与净息差预期改善，否则短期偏防守。",
    fundamentals: {
      pe: 4.8,
      pb: 0.48,
      roe: 10.2,
      revenueYoy: -3.4,
      profitYoy: 2.1,
      grossMargin: 0,
      debtRatio: 91.2,
      ocfToProfit: 0.75,
      dividendYield: 5.6
    },
    technicals: {
      close: [11.8, 11.7, 11.62, 11.54, 11.48, 11.5, 11.41, 11.36, 11.32, 11.3, 11.28, 11.26],
      volume: [132, 126, 121, 118, 111, 109, 106, 102, 99, 101, 96, 94],
      ma20: 11.46,
      ma60: 11.88,
      rsi: 39,
      macd: -0.18,
      support: 11.02,
      resistance: 11.62,
      turnoverRate: 0.52,
      volatility: 17.8
    },
    sentiment: {
      score: 38,
      newsTone: 42,
      socialHeat: 31,
      northbound: -2.6,
      marginBalanceChange: -1.8,
      mainNetInflow: -2.1,
      riskTags: ["趋势偏弱", "板块成交降温"]
    },
    events: [baseEvents[4]]
  }
];

export const liveEvents: LiveEvent[] = baseEvents;

export const strategyWeights = [
  { label: "盈利质量", value: 28, tone: "good" },
  { label: "估值安全边际", value: 20, tone: "watch" },
  { label: "趋势强度", value: 24, tone: "good" },
  { label: "资金与舆情", value: 18, tone: "hot" },
  { label: "风险折扣", value: 10, tone: "risk" }
];
