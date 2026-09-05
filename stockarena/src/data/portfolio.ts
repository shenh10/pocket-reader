export type HoldingMarket = "A" | "HK";
export type HoldingCurrency = "CNY" | "HKD";

export type PortfolioHolding = {
  code: string;
  name: string;
  market: HoldingMarket;
  channel: string;
  sector: string;
  themes: string[];
  currency: HoldingCurrency;
  shares: number;
  availableShares: number;
  screenshotPrice: number;
  costPrice: number;
  averageBuyPrice: number;
  brokerMarketValueCny: number;
  brokerTotalPnl: number;
  brokerTotalPnlPct: number;
  fxRateToCny: number;
  thesis: string;
  watch: string[];
};

export type PortfolioBrokerSnapshot = {
  source: string;
  asOf: string;
  todayPnl: number;
  todayPnlPct: number;
  totalMarketValueCny: number;
  totalPnl: number;
};
