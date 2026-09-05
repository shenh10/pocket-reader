import http from "node:http";
import { URL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.DATA_GATEWAY_PORT ?? 8787);
const EASTMONEY_REFERER = "https://quote.eastmoney.com/";
const SINA_REFERER = "https://finance.sina.com.cn/";
const USER_AGENT = "Mozilla/5.0";
const QUOTE_PRICE_TOLERANCE_PCT = 0.18;
const QUOTE_CHANGE_TOLERANCE_PCT = 0.12;
const MARKET_UNIVERSE_CACHE_MS = 10 * 60 * 1000;
const HK_RESEARCH_CACHE_MS = 5 * 60 * 1000;
const EASTMONEY_CLIST_FIELDS = "f12,f14,f2,f3,f6,f20,f100,f102,f103";
const A_SHARE_FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
const HK_SHARE_FS = "m:128+t:3";
const HKEX_REFERER = "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en";
const AASTOCKS_REFERER = "https://www.aastocks.com/";
const RESEARCH_DOCUMENT_CACHE_DIR = path.join(os.tmpdir(), "stockarena-research-cache");
const DOCUMENT_EXTRACTION_CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_DOCUMENT_BYTES = 28 * 1024 * 1024;

const aastocksCategories = [
  {
    category: "research-report",
    source: "AAStocks Research Report",
    layer: "research-index",
    confidence: 76
  },
  {
    category: "analysts-views",
    source: "AAStocks Analysts' Views",
    layer: "public-view",
    confidence: 70
  },
  {
    category: "result-announcement",
    source: "AAStocks Result Announcements",
    layer: "public-news",
    confidence: 66
  },
  {
    category: "hk-stock-news",
    source: "AAStocks Stock News",
    layer: "public-news",
    confidence: 62
  }
];

const hkCompanyIrLinks = {
  H00700: {
    name: "腾讯控股 IR",
    url: "https://www.tencent.com/en-us/investors.html",
    evidence: "用于核对业绩公告、回购、管理层指引和业绩材料。"
  },
  H09988: {
    name: "阿里巴巴 IR",
    url: "https://www.alibabagroup.com/en-US/ir/home",
    evidence: "用于核对阿里财报、回购、云业务和资本配置披露。"
  },
  H01810: {
    name: "小米集团 IR",
    url: "https://ir.mi.com/investor-relations/",
    evidence: "用于核对小米手机、IoT、汽车业务和公告通函。"
  },
  H03690: {
    name: "美团 IR",
    url: "https://about.meituan.com/en/investor-relations",
    evidence: "用于核对即时零售、本地生活、到店酒旅和财报材料。"
  },
  H09618: {
    name: "京东集团 IR",
    url: "https://ir.jd.com/",
    evidence: "用于核对零售、物流、回购和财报材料。"
  },
  H09868: {
    name: "小鹏汽车 IR",
    url: "https://ir.xiaopeng.com/",
    evidence: "用于核对交付、车型周期、毛利率和财报材料。"
  },
  H02015: {
    name: "理想汽车 IR",
    url: "https://ir.lixiang.com/",
    evidence: "用于核对交付、车型周期、毛利率和财报材料。"
  },
  H09863: {
    name: "零跑汽车 IR",
    url: "https://ir.leapmotor.com/",
    evidence: "用于核对交付、车型周期、毛利率和财报材料。"
  }
};

const allowedResearchHosts = new Set([
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
]);

const providers = [
  {
    id: "eastmoney",
    name: "东方财富 Push2",
    status: "standby",
    coverage: ["A股/港股实时快照", "指数", "日/周/月/年K线", "成交额", "估值基础字段"],
    auth: "none",
    note: "主行情与历史 K 线源，状态由实时探测决定。"
  },
  {
    id: "tencent",
    name: "腾讯行情",
    status: "standby",
    coverage: ["A股/港股报价", "盘口字段", "成交额", "估值字段"],
    auth: "none",
    note: "交叉验证源，状态由实时探测决定。"
  },
  {
    id: "sina",
    name: "新浪行情",
    status: "standby",
    coverage: ["A股/港股报价", "五档盘口", "成交量", "成交额"],
    auth: "none",
    note: "交叉验证源，状态由实时探测决定。"
  },
  {
    id: "tushare",
    name: "Tushare Pro",
    status: process.env.TUSHARE_TOKEN ? "configured" : "needs-token",
    coverage: ["财务指标", "日线历史", "股票基础资料", "部分公告与复权因子"],
    auth: "TUSHARE_TOKEN",
    note: "官方结构化数据源，适合财务和历史数据增强。"
  },
  {
    id: "akshare",
    name: "AKShare",
    status: "extension-ready",
    coverage: ["行情聚合", "宏观", "研报索引", "行业数据"],
    auth: "none",
    note: "Python 数据管道扩展位，当前未作为在线网关运行。"
  },
  {
    id: "baostock",
    name: "BaoStock",
    status: "extension-ready",
    coverage: ["历史行情", "复权", "财务季频数据"],
    auth: "none",
    note: "离线历史数据扩展位，当前未作为在线网关运行。"
  },
  {
    id: "hkexnews",
    name: "HKEXnews 披露易",
    status: "standby",
    coverage: ["港股公告", "年报/中报", "业绩公告", "回购与权益披露"],
    auth: "none",
    note: "港股事实源，状态由网页探测决定；若 Akamai 拒绝访问则显示失败。"
  },
  {
    id: "aastocks",
    name: "AAStocks AAFN",
    status: "standby",
    coverage: ["港股 Research Report", "Analysts' Views", "个股新闻", "公司公告入口"],
    auth: "none",
    note: "港股公开研报/新闻入口，适合索引事件，不等同完整卖方研报库。"
  },
  {
    id: "eastmoney-research",
    name: "东方财富研报中心",
    status: "standby",
    coverage: ["个股研报", "行业研报", "盈利预测", "券商 PDF 入口"],
    auth: "none",
    note: "A股覆盖较强，港股覆盖需按个股实测确认。"
  },
  {
    id: "eastmoney-universe",
    name: "东方财富股票池/板块榜",
    status: "standby",
    coverage: ["A/H股票池", "代码搜索", "行业/概念标签", "热门板块", "板块领涨股"],
    auth: "none",
    note: "用于全市场检索和动态题材榜，状态由 clist 样本探测决定。"
  },
  {
    id: "futu-opend",
    name: "富途 OpenD",
    status: process.env.FUTU_OPEND_HOST ? "configured" : "needs-token",
    coverage: ["港股行情扩展", "账户/交易接口", "新闻与讨论热度"],
    auth: "FUTU_OPEND_HOST",
    note: "行情、账户和交易扩展位；不作为研报事实源，当前不抓取登录态内容。"
  },
  {
    id: "licensed-research",
    name: "授权研报库",
    status: process.env.RESEARCH_VENDOR_TOKEN ? "configured" : "needs-token",
    coverage: ["完整券商研报全文", "盈利预测", "目标价历史", "一致预期"],
    auth: "RESEARCH_VENDOR_TOKEN",
    note: "Wind/Choice/iFinD/FactSet/LSEG/Bloomberg 等授权库扩展位。"
  }
];

const execFileAsync = promisify(execFile);
let marketUniverseCache = null;
const hkResearchCache = new Map();
const documentExtractionCache = new Map();

const indexSecids = [
  { name: "上证指数", secid: "1.000001" },
  { name: "深证成指", secid: "0.399001" },
  { name: "创业板指", secid: "0.399006" },
  { name: "科创50", secid: "1.000688" }
];

const klinePeriodConfig = {
  day: { klt: 101, label: "日K", defaultLimit: 90 },
  week: { klt: 102, label: "周K", defaultLimit: 120 },
  month: { klt: 103, label: "月K", defaultLimit: 120 },
  year: { klt: 106, label: "年K", defaultLimit: 30 }
};

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function normalizeCode(input) {
  const value = decodeURIComponent(String(input ?? "")).trim().toUpperCase();
  const compact = value.replace(/\s+/g, "");
  const hkMatch = compact.match(/^(?:HK|H)?(\d{5})$/);
  if (hkMatch) return `H${hkMatch[1]}`;
  if (/^\d{6}$/.test(compact)) return compact;
  throw new Error(`unsupported security code: ${input}`);
}

function instrumentOf(input) {
  const code = normalizeCode(input);
  if (code.startsWith("H")) {
    const rawCode = code.slice(1);
    return {
      code,
      rawCode,
      market: "HK",
      exchange: "HKEX",
      secid: `116.${rawCode}`,
      symbol: `hk${rawCode}`,
      priceScale: 1000,
      quoteSourceIds: ["eastmoney", "tencent", "sina"]
    };
  }

  const market = /^(6|9)/.test(code) ? "1" : "0";
  return {
    code,
    rawCode: code,
    market: "A",
    exchange: market === "1" ? "SH" : "SZ",
    secid: `${market}.${code}`,
    symbol: `${market === "1" ? "sh" : "sz"}${code}`,
    priceScale: 100,
    quoteSourceIds: ["eastmoney", "tencent", "sina"]
  };
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "-") return fallback;
  const numeric = Number(String(value).trim());
  if (!Number.isFinite(numeric)) return fallback;
  return numeric;
}

function toScaled(value, scale = 1, fallback = 0) {
  if (value === undefined || value === null || value === "-") return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric / scale;
}

async function fetchJson(url) {
  const text = await fetchText(url, EASTMONEY_REFERER);
  return JSON.parse(text);
}

async function fetchText(url, referer = EASTMONEY_REFERER, encoding = "utf-8") {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-sL",
      "--max-time",
      "15",
      "--retry",
      "2",
      "--retry-delay",
      "1",
      "-A",
      USER_AGENT,
      "-e",
      referer,
      url
    ],
    { encoding: "buffer", maxBuffer: 4 * 1024 * 1024 }
  );

  if (!stdout.length || !stdout.toString("binary").trim()) {
    throw new Error("empty upstream response");
  }

  return new TextDecoder(encoding).decode(stdout);
}

async function fetchBinary(url, referer = EASTMONEY_REFERER) {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-sL",
      "--max-time",
      "25",
      "--retry",
      "1",
      "--retry-delay",
      "1",
      "--max-filesize",
      String(MAX_DOCUMENT_BYTES),
      "-A",
      USER_AGENT,
      "-e",
      referer,
      url
    ],
    { encoding: "buffer", maxBuffer: MAX_DOCUMENT_BYTES + 1024 * 1024 }
  );

  if (!stdout.length) throw new Error("empty upstream document response");
  return stdout;
}

function decodeHtmlEntities(value) {
  let output = String(value ?? "");
  for (let index = 0; index < 2; index += 1) {
    output = output
      .replace(/&amp;/gi, "&")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(parseInt(number, 10)))
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&nbsp;/gi, " ");
  }
  return output;
}

function stripHtml(value) {
  return decodeHtmlEntities(
    String(value ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " / ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function absoluteUrl(path, baseUrl) {
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return path;
  }
}

function formatDateYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizeAastocksDate(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})(?:\s+(\d{2}:\d{2}))?/);
  if (!match) return raw;
  return `${match[1]}-${match[2]}-${match[3]}${match[4] ? ` ${match[4]}` : ""}`;
}

function normalizeHkexDate(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?/);
  if (!match) return raw;
  return `${match[3]}-${match[2]}-${match[1]}${match[4] ? ` ${match[4]}` : ""}`;
}

function inferResearchSignal(text, layer) {
  const value = String(text ?? "").toLowerCase();
  if (layer === "official-filing") return "事实";
  if (/(downgrade|cut|lower|slash|bearish|miss|below|concern|pressure|risk)/i.test(value)) return "下修";
  if (/(upgrade|raise|hike|beat|outperform|buy|positive|recovery|upside|strong)/i.test(value)) return "上修";
  if (/(mixed|divergen|uncertain|volatile|watch|neutral)/i.test(value)) return "分歧";
  return "维持";
}

function inferRiskTags(text) {
  const value = String(text ?? "").toLowerCase();
  const tags = [];
  if (/(valuation|target price|multiple)/i.test(value)) tags.push("估值/目标价");
  if (/(buyback|repurchase|issued shares|share buybacks)/i.test(value)) tags.push("回购/股本");
  if (/(ai|llm|agent|cloud|model)/i.test(value)) tags.push("AI/云");
  if (/(margin|profit|revenue|earnings|results)/i.test(value)) tags.push("业绩兑现");
  if (/(regulat|policy|antitrust|compliance)/i.test(value)) tags.push("政策监管");
  if (/(competition|price war|subsidy)/i.test(value)) tags.push("竞争格局");
  return tags.slice(0, 3);
}

function inferThemeSignals(items) {
  const text = items.map((item) => `${item.title} ${item.summary}`).join(" ").toLowerCase();
  const themes = [];
  if (/(ai|llm|agent|cloud|model)/i.test(text)) themes.push("AI应用/云");
  if (/(buyback|repurchase|issued shares|share buybacks)/i.test(text)) themes.push("回购与资本管理");
  if (/(valuation|target price|rating|outperform|buy)/i.test(text)) themes.push("估值与评级");
  if (/(results|earnings|profit|revenue|margin)/i.test(text)) themes.push("业绩兑现");
  if (/(policy|regulat|compliance|antitrust)/i.test(text)) themes.push("政策监管");
  if (/(sector|industry|peers|internet|auto|ev|property)/i.test(text)) themes.push("板块联动");
  return Array.from(new Set(themes)).slice(0, 6);
}

function parseJsonp(text) {
  const body = String(text ?? "").trim().replace(/^\uFEFF/, "");
  const match = body.match(/^[^(]+\(([\s\S]*)\);?$/);
  if (!match) throw new Error("unexpected JSONP response");
  return JSON.parse(match[1]);
}

function assertAllowedResearchUrl(inputUrl) {
  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new Error("invalid research document URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("only http/https research URLs are supported");
  }

  if (!allowedResearchHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error(`research document host is not allowlisted: ${parsed.hostname}`);
  }

  return parsed;
}

function refererForDocument(parsedUrl) {
  const host = parsedUrl.hostname.toLowerCase();
  if (host.includes("aastocks")) return AASTOCKS_REFERER;
  if (host.includes("hkexnews")) return HKEX_REFERER;
  if (host.includes("dfcfw") || host.includes("eastmoney")) return "https://data.eastmoney.com/report/";
  if (host.includes("cninfo")) return "https://www.cninfo.com.cn/";
  if (host.includes("sina")) return SINA_REFERER;
  return parsedUrl.origin;
}

function isPdfUrl(parsedUrl) {
  return /\.pdf$/i.test(parsedUrl.pathname) || parsedUrl.hostname.toLowerCase() === "pdf.dfcfw.com";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function cachedPdfPath(url, buffer) {
  await mkdir(RESEARCH_DOCUMENT_CACHE_DIR, { recursive: true });
  const filename = `${sha256(url).slice(0, 24)}.pdf`;
  const filePath = path.join(RESEARCH_DOCUMENT_CACHE_DIR, filename);
  try {
    await readFile(filePath);
  } catch {
    await writeFile(filePath, buffer);
  }
  return filePath;
}

async function readPdfInfo(filePath) {
  try {
    const { stdout } = await execFileAsync("pdfinfo", [filePath], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    });
    const pages = Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
    const title = stdout.match(/^Title:\s+(.+)$/m)?.[1]?.trim() ?? "";
    return { pages, title };
  } catch (error) {
    return {
      pages: 0,
      title: "",
      warning: error instanceof Error ? error.message.split("\n")[0] : String(error)
    };
  }
}

async function extractPdfText(filePath) {
  const { stdout } = await execFileAsync(
    "pdftotext",
    ["-layout", "-enc", "UTF-8", filePath, "-"],
    { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 }
  );
  return new TextDecoder("utf-8", { fatal: false }).decode(stdout);
}

function normalizeDocumentText(text) {
  return String(text ?? "")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pickArticleText(html) {
  const candidates = [];
  const patterns = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
    /<div\b[^>]*(?:class|id)=["'][^"']*(?:newscontent|news-content|article|detail|content|main)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      const text = stripHtml(match[1]);
      if (text.length > 120) candidates.push(text);
    }
  }

  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  candidates.push(stripHtml(body));
  return normalizeDocumentText(candidates.sort((a, b) => b.length - a.length)[0] ?? "");
}

function detectMetric(line) {
  const matchers = [
    ["营业收入", /(营业收入|营业总收入|营收|收入合计|revenue|sales)/i],
    ["归母净利润", /(归母净利润|归属于母公司.*净利润|net profit attributable|net profit|profit attributable)/i],
    ["净利润", /(净利润|profit)/i],
    ["毛利率", /(毛利率|gross margin)/i],
    ["EPS", /(每股收益|eps|earnings per share)/i],
    ["PE", /(市盈率|pe|p\/e)/i],
    ["ROE", /(净资产收益率|roe)/i]
  ];

  return matchers.find(([, pattern]) => pattern.test(line))?.[0] ?? "";
}

function extractForecastRows(text) {
  const lines = normalizeDocumentText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && line.length <= 260);
  const rows = [];
  let recentPeriods = [];

  for (const line of lines) {
    const periods = Array.from(new Set((line.match(/(?:20\d{2}|FY\d{2,4}|202\d[EF]|202\dE)/gi) ?? []).map((item) => item.toUpperCase())));
    if (periods.length >= 2) recentPeriods = periods.slice(0, 6);

    const metric = detectMetric(line);
    if (!metric) continue;

    const valuesLine = line.replace(/(?:20\d{2}|FY\d{2,4}|202\d[EF]|202\dE)/gi, " ");
    const values = (valuesLine.match(/[-+]?\d{1,4}(?:,\d{3})*(?:\.\d+)?%?/g) ?? [])
      .map((value) => value.replace(/,/g, ""))
      .filter((value) => value !== "");

    if (values.length < 2 && metric !== "评级" && metric !== "目标价") continue;

    const rowPeriods = periods.length >= 2 ? periods : recentPeriods.slice(0, values.length);
    rows.push({
      metric,
      periods: rowPeriods,
      values: values.slice(0, Math.max(2, rowPeriods.length || 4)),
      raw: line
    });

    if (rows.length >= 12) break;
  }

  return rows;
}

function extractRatingLines(text) {
  return normalizeDocumentText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /(目标价|target price|评级|rating|买入|增持|推荐|优于大市|outperform|buy|hold|neutral|维持|下调|上调)/i.test(line))
    .slice(0, 8);
}

function buildDocumentExcerpt(text) {
  const normalized = normalizeDocumentText(text);
  const anchors = /(投资要点|核心观点|盈利预测|风险提示|summary|investment highlights|key points|forecast)/i;
  const anchorIndex = normalized.search(anchors);
  const source = anchorIndex >= 0 ? normalized.slice(anchorIndex) : normalized;
  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 18 && !/免责声明|disclaimer|重要声明/i.test(line));
  return lines.slice(0, 6).join("\n").slice(0, 900);
}

function buildDocumentExtractionPayload({
  url,
  code,
  title,
  source,
  format,
  bytes,
  text,
  pageCount = 0,
  pdfTitle = "",
  warning = null
}) {
  const normalized = normalizeDocumentText(text);
  const forecastRows = extractForecastRows(normalized);
  const ratingLines = extractRatingLines(normalized);
  return {
    url,
    code,
    title,
    source,
    status: normalized.length > 80 ? "parsed" : "empty",
    format,
    fetchedAt: new Date().toISOString(),
    bytes,
    pageCount,
    pdfTitle,
    textChars: normalized.length,
    excerpt: buildDocumentExcerpt(normalized),
    forecast: {
      status: forecastRows.length > 0 ? "found" : "not-found",
      rows: forecastRows,
      confidence: forecastRows.length >= 3 ? 72 : forecastRows.length > 0 ? 54 : 0
    },
    ratingLines,
    warning,
    limitations: [
      "表格为文本层正则抽取候选，扫描件和复杂跨页表格需要 OCR/表格模型增强。",
      "抽取结果用于研究线索，不等同授权终端的一致预期数据库。"
    ]
  };
}

async function extractResearchDocument({ url, code = "", title = "", source = "" }) {
  const parsedUrl = assertAllowedResearchUrl(url);
  const cacheKey = sha256(`${url}|${code}|${title}|${source}`);
  const cached = documentExtractionCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < DOCUMENT_EXTRACTION_CACHE_MS) return cached.payload;

  const referer = refererForDocument(parsedUrl);
  let payload;

  if (isPdfUrl(parsedUrl)) {
    const buffer = await fetchBinary(parsedUrl.toString(), referer);
    if (!buffer.subarray(0, 5).toString("utf8").startsWith("%PDF")) {
      throw new Error("upstream document is not a PDF");
    }

    const filePath = await cachedPdfPath(parsedUrl.toString(), buffer);
    const [info, rawText] = await Promise.all([readPdfInfo(filePath), extractPdfText(filePath)]);
    payload = buildDocumentExtractionPayload({
      url,
      code,
      title,
      source,
      format: "pdf",
      bytes: buffer.length,
      text: rawText,
      pageCount: info.pages,
      pdfTitle: info.title,
      warning: info.warning ?? null
    });
  } else {
    const html = await fetchText(parsedUrl.toString(), referer);
    const text = pickArticleText(html);
    payload = buildDocumentExtractionPayload({
      url,
      code,
      title,
      source,
      format: "html",
      bytes: Buffer.byteLength(html, "utf8"),
      text
    });
  }

  documentExtractionCache.set(cacheKey, { cachedAt: Date.now(), payload });
  return payload;
}

function formatCompactTimestamp(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return raw || new Date().toISOString();
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
}

async function fetchJsonWithFallback(urls) {
  let lastError;
  for (const url of urls) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("all upstreams failed");
}

function eastmoneyDiffRows(json) {
  const diff = json?.data?.diff;
  if (!diff) return [];
  return Array.isArray(diff) ? diff : Object.values(diff);
}

async function fetchEastmoneyClistPage({ fs, page = 1, pageSize = 100, fields = EASTMONEY_CLIST_FIELDS, sortField = "f6" }) {
  const params = new URLSearchParams({
    pn: String(page),
    pz: String(pageSize),
    po: "1",
    np: "1",
    fltt: "2",
    invt: "2",
    fid: sortField,
    fs,
    fields
  });
  const url = `https://push2.eastmoney.com/api/qt/clist/get?${params.toString()}`;
  return fetchJsonWithFallback([
    url,
    url.replace("https://push2.eastmoney.com", "https://push2delay.eastmoney.com")
  ]);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeSecurityName(value) {
  return cleanText(value).replace(/\s+/g, "");
}

function isActiveSecurity(row) {
  const name = normalizeSecurityName(row.f14);
  if (!name) return false;
  if (name.includes("退") || name.startsWith("PT")) return false;
  return toNumber(row.f20) > 0;
}

function normalizeMarketSecurity(row, market) {
  const rawCode = String(row.f12 ?? "").padStart(market === "HK" ? 5 : 6, "0");
  const themes = cleanText(row.f103)
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);

  return {
    code: market === "HK" ? `H${rawCode}` : rawCode,
    rawCode,
    name: normalizeSecurityName(row.f14),
    market,
    sector: cleanText(row.f100) || "未分类",
    region: cleanText(row.f102),
    themes,
    price: toNumber(row.f2),
    changePct: toNumber(row.f3),
    turnover: toScaled(row.f6, 100000000),
    marketCap: toScaled(row.f20, 100000000),
    source: "东方财富 Push2 clist"
  };
}

async function fetchEastmoneyUniverseByMarket(market) {
  const fs = market === "HK" ? HK_SHARE_FS : A_SHARE_FS;
  const pageSize = 100;
  const first = await fetchEastmoneyClistPage({ fs, page: 1, pageSize });
  const total = toNumber(first?.data?.total);
  const pageCount = Math.min(Math.ceil(total / pageSize), market === "HK" ? 32 : 80);
  const rows = [...eastmoneyDiffRows(first)];

  for (let page = 2; page <= pageCount; page += 6) {
    const batch = Array.from({ length: Math.min(6, pageCount - page + 1) }, (_, index) => page + index);
    const results = await Promise.allSettled(batch.map((pageNumber) => fetchEastmoneyClistPage({ fs, page: pageNumber, pageSize })));
    results.forEach((result) => {
      if (result.status === "fulfilled") rows.push(...eastmoneyDiffRows(result.value));
    });
  }

  const seen = new Set();
  return rows
    .filter(isActiveSecurity)
    .map((row) => normalizeMarketSecurity(row, market))
    .filter((item) => {
      if (seen.has(item.code)) return false;
      seen.add(item.code);
      return true;
    });
}

async function buildMarketUniverse() {
  const now = Date.now();
  if (marketUniverseCache && now - marketUniverseCache.loadedAt < MARKET_UNIVERSE_CACHE_MS) {
    return marketUniverseCache;
  }

  const [aShares, hkShares] = await Promise.all([
    fetchEastmoneyUniverseByMarket("A"),
    fetchEastmoneyUniverseByMarket("HK")
  ]);
  const items = [...aShares, ...hkShares].sort((left, right) => right.turnover - left.turnover);

  marketUniverseCache = {
    loadedAt: now,
    refreshedAt: new Date(now).toISOString(),
    items,
    coverage: {
      A: aShares.length,
      HK: hkShares.length
    }
  };
  return marketUniverseCache;
}

function searchMarketUniverse(items, { query = "", market = "ALL", limit = 80 } = {}) {
  const needle = normalizeSecurityName(query).toLowerCase();
  const normalizedLimit = Math.max(10, Math.min(Number(limit) || 80, 200));
  const filtered = items.filter((item) => {
    if (market !== "ALL" && item.market !== market) return false;
    if (!needle) return true;
    const haystack = normalizeSecurityName(
      `${item.code}${item.rawCode}${item.name}${item.sector}${item.region}${item.themes.join("")}`
    ).toLowerCase();
    return haystack.includes(needle);
  });

  filtered.sort((left, right) => {
    if (needle) {
      const leftExact = left.code.toLowerCase() === needle || left.rawCode.toLowerCase() === needle || left.name.toLowerCase() === needle;
      const rightExact = right.code.toLowerCase() === needle || right.rawCode.toLowerCase() === needle || right.name.toLowerCase() === needle;
      if (leftExact !== rightExact) return leftExact ? -1 : 1;
      const leftStarts = left.code.toLowerCase().startsWith(needle) || left.rawCode.toLowerCase().startsWith(needle) || left.name.toLowerCase().startsWith(needle);
      const rightStarts = right.code.toLowerCase().startsWith(needle) || right.rawCode.toLowerCase().startsWith(needle) || right.name.toLowerCase().startsWith(needle);
      if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
    }
    return right.turnover - left.turnover;
  });

  return {
    items: filtered.slice(0, normalizedLimit),
    matched: filtered.length
  };
}

function normalizeBoard(row, layer) {
  return {
    code: String(row.f12 ?? ""),
    name: normalizeSecurityName(row.f14),
    layer,
    changePct: toScaled(row.f3, 100),
    turnover: toScaled(row.f6, 100000000),
    turnoverRate: toScaled(row.f8, 100),
    marketCap: toScaled(row.f20, 100000000),
    mainNetInflow: toScaled(row.f62, 100000000)
  };
}

async function fetchBoardLeaders(boardCode) {
  const json = await fetchEastmoneyClistPage({
    fs: `b:${boardCode}`,
    page: 1,
    pageSize: 5,
    fields: EASTMONEY_CLIST_FIELDS,
    sortField: "f3"
  });
  return eastmoneyDiffRows(json)
    .filter(isActiveSecurity)
    .map((row) => normalizeMarketSecurity(row, "A"))
    .slice(0, 4);
}

function themeRecommendation(board, leaders) {
  const leaderStrength = leaders.filter((item) => item.changePct > board.changePct).length;
  const liquidityScore = Math.min(22, Math.max(0, board.turnover / 18));
  const flowScore = board.mainNetInflow > 0 ? Math.min(20, board.mainNetInflow * 0.9) : Math.max(-16, board.mainNetInflow * 1.2);
  const momentumScore = board.changePct > 0 ? Math.min(24, board.changePct * 7) : Math.max(-20, board.changePct * 8);
  const breadthScore = leaderStrength >= 3 ? 12 : leaderStrength >= 2 ? 8 : leaderStrength >= 1 ? 4 : -4;
  const crowdingPenalty = board.changePct >= 6 ? 18 : board.turnoverRate >= 8 ? 12 : board.changePct >= 4 ? 8 : 0;
  const score = Math.round(Math.max(20, Math.min(95, 48 + liquidityScore + flowScore + momentumScore + breadthScore - crowdingPenalty)));
  const isOverheated = board.changePct >= 6 || board.turnoverRate >= 8;
  const isTradable = board.turnover >= 40 && board.mainNetInflow > 0 && board.changePct > 0 && leaderStrength >= 1;
  const recommendation = isOverheated
    ? "过热等待"
    : score >= 72 && isTradable
      ? "重点跟踪"
      : score >= 58 && board.changePct >= 0
        ? "趋势观察"
        : "低优先级";

  const action =
    recommendation === "重点跟踪"
      ? "只跟龙头和强趋势个股，等回踩均线或放量突破再分批，不追板块尾部。"
      : recommendation === "趋势观察"
        ? "先观察能否连续两日放量、主力净额保持为正，再进入候选池。"
        : recommendation === "过热等待"
          ? "短线涨速或换手偏高，等分歧回落后再看承接，不追高。"
          : "当前只是榜单异动，缺少成交或资金确认，暂不作为买入主线。";
  const trigger =
    recommendation === "重点跟踪"
      ? "触发：板块成交额继续扩大、龙头涨幅强于板块且未跌破日内均线。"
      : recommendation === "趋势观察"
        ? "触发：涨幅扩大到 1% 以上且主力净额继续流入。"
        : recommendation === "过热等待"
          ? "触发：回落后成交缩量、龙头先于板块企稳。"
          : "触发：重新进入涨幅榜前列并出现正向资金流。";

  return {
    recommendation,
    recommendationScore: score,
    reason: `${board.layer}榜异动：涨幅 ${board.changePct.toFixed(2)}%，成交额 ${board.turnover.toFixed(1)} 亿，主力净额 ${board.mainNetInflow.toFixed(1)} 亿；${leaderStrength}/4 个龙头强于板块。`,
    action,
    trigger,
    metrics: [
      { label: "涨幅", value: `${board.changePct.toFixed(2)}%`, tone: board.changePct >= 4 ? "risk" : board.changePct > 0 ? "good" : "neutral" },
      { label: "成交", value: `${board.turnover.toFixed(1)}亿`, tone: board.turnover >= 80 ? "good" : board.turnover >= 25 ? "watch" : "neutral" },
      { label: "主力", value: `${board.mainNetInflow.toFixed(1)}亿`, tone: board.mainNetInflow > 0 ? "good" : "risk" },
      { label: "龙头强度", value: `${leaderStrength}/4`, tone: leaderStrength >= 2 ? "good" : "watch" }
    ]
  };
}

async function buildMarketThemes(limit = 8) {
  const normalizedLimit = Math.max(4, Math.min(Number(limit) || 8, 12));
  const [conceptJson, industryJson] = await Promise.all([
    fetchEastmoneyClistPage({
      fs: "m:90+t:3",
      page: 1,
      pageSize: 18,
      fields: "f12,f14,f2,f3,f6,f8,f20,f62",
      sortField: "f3"
    }),
    fetchEastmoneyClistPage({
      fs: "m:90+t:2",
      page: 1,
      pageSize: 12,
      fields: "f12,f14,f2,f3,f6,f8,f20,f62",
      sortField: "f3"
    })
  ]);

  const boards = [
    ...eastmoneyDiffRows(conceptJson).map((row) => normalizeBoard(row, "概念")),
    ...eastmoneyDiffRows(industryJson).map((row) => normalizeBoard(row, "行业"))
  ]
    .filter((board) => board.code && board.name)
    .sort((left, right) => right.changePct - left.changePct || right.turnover - left.turnover)
    .slice(0, Math.max(normalizedLimit * 3, normalizedLimit));

  const leaderResults = await Promise.allSettled(boards.map((board) => fetchBoardLeaders(board.code)));

  return boards
    .map((board, index) => {
      const leaders =
        leaderResults[index].status === "fulfilled"
          ? leaderResults[index].value.slice(0, 4)
          : [];
      const recommendation = themeRecommendation(board, leaders);
      const heat = Math.round(
        Math.max(
          38,
          Math.min(99, 54 + board.changePct * 5 + Math.min(12, board.turnover / 120) + (board.mainNetInflow > 0 ? 6 : -4))
        )
      );

      return {
        name: `${board.name}${board.layer === "行业" ? "" : ""}`,
        heat,
        stage: board.layer === "行业" ? "业绩兑现" : "主题发酵",
        leaders: leaders.map((item) => item.name),
        source: "东方财富概念/行业板块榜",
        updatedAt: new Date().toISOString(),
        ...recommendation,
        catalysts: [
          `${board.layer}榜涨幅 ${board.changePct.toFixed(2)}%`,
          `成交额 ${board.turnover.toFixed(1)} 亿`,
          `主力净额 ${board.mainNetInflow.toFixed(1)} 亿`
        ],
        risks: [
          board.changePct >= 6 ? "短线涨幅偏快" : "注意持续性验证",
          board.turnoverRate >= 5 ? "换手偏高" : "量能仍需跟踪",
          "板块数据来自公开行情榜，需结合公告与研报校验"
        ]
      };
    })
    .sort(
      (left, right) =>
        (right.recommendationScore ?? right.heat) - (left.recommendationScore ?? left.heat) ||
        Number(right.metrics?.find((item) => item.label === "成交")?.value.replace(/[^\d.]/g, "") ?? 0) -
          Number(left.metrics?.find((item) => item.label === "成交")?.value.replace(/[^\d.]/g, "") ?? 0)
    )
    .slice(0, normalizedLimit);
}

async function fetchEastmoneyQuote(code) {
  const instrument = instrumentOf(code);
  const fields = [
    "f43",
    "f44",
    "f45",
    "f46",
    "f47",
    "f48",
    "f57",
    "f58",
    "f60",
    "f116",
    "f162",
    "f167",
    "f168",
    "f169",
    "f170"
  ].join(",");
  const path = `/api/qt/stock/get?secid=${instrument.secid}&fields=${fields}`;
  const json = await fetchJsonWithFallback([
    `https://push2.eastmoney.com${path}`,
    `https://push2delay.eastmoney.com${path}`
  ]);
  if (!json?.data) throw new Error(`empty quote for ${instrument.code}`);
  return json.data;
}

function normalizeEastmoneyQuote(code, quote) {
  const instrument = instrumentOf(code);
  return {
    providerId: "eastmoney",
    providerName: "东方财富 Push2",
    code: instrument.code,
    market: instrument.market,
    name: quote.f58 ?? code,
    price: toScaled(quote.f43, instrument.priceScale),
    changePct: toScaled(quote.f170, 100),
    previousClose: toScaled(quote.f60, instrument.priceScale),
    open: toScaled(quote.f46, instrument.priceScale),
    high: toScaled(quote.f44, instrument.priceScale),
    low: toScaled(quote.f45, instrument.priceScale),
    volume: toNumber(quote.f47),
    amount: toNumber(quote.f48),
    marketCap: toScaled(quote.f116, 100000000),
    pe: toScaled(quote.f162, 100),
    pb: toScaled(quote.f167, 100),
    turnoverRate: toScaled(quote.f168, 100),
    timestamp: new Date().toISOString()
  };
}

async function fetchEastmoneyQuoteNormalized(code) {
  return normalizeEastmoneyQuote(code, await fetchEastmoneyQuote(code));
}

async function fetchSinaQuoteNormalized(code) {
  const instrument = instrumentOf(code);
  const text = await fetchText(`https://hq.sinajs.cn/list=${instrument.symbol}`, SINA_REFERER, "gb18030");
  const match = text.match(/="([^"]*)"/);
  if (!match?.[1]) throw new Error(`empty sina quote for ${code}`);
  const parts = match[1].split(",");

  if (instrument.market === "HK") {
    const price = toNumber(parts[6]);
    const previousClose = toNumber(parts[3]);
    if (!price || !previousClose) throw new Error(`invalid sina quote for ${instrument.code}`);

    return {
      providerId: "sina",
      providerName: "新浪行情",
      code: instrument.code,
      market: instrument.market,
      name: parts[1] || parts[0] || instrument.code,
      price,
      changePct: toNumber(parts[8], previousClose ? ((price - previousClose) / previousClose) * 100 : 0),
      previousClose,
      open: toNumber(parts[2]),
      high: toNumber(parts[4]),
      low: toNumber(parts[5]),
      volume: toNumber(parts[12]),
      amount: toNumber(parts[11]),
      marketCap: 0,
      pe: 0,
      pb: 0,
      turnoverRate: 0,
      timestamp: `${parts[17] ?? ""} ${parts[18] ?? ""}`.trim() || new Date().toISOString()
    };
  }

  const price = toNumber(parts[3]);
  const previousClose = toNumber(parts[2]);
  if (!price || !previousClose) throw new Error(`invalid sina quote for ${code}`);

  return {
    providerId: "sina",
    providerName: "新浪行情",
    code: instrument.code,
    market: instrument.market,
    name: parts[0] || code,
    price,
    changePct: previousClose ? ((price - previousClose) / previousClose) * 100 : 0,
    previousClose,
    open: toNumber(parts[1]),
    high: toNumber(parts[4]),
    low: toNumber(parts[5]),
    volume: toNumber(parts[8]) / 100,
    amount: toNumber(parts[9]),
    marketCap: 0,
    pe: 0,
    pb: 0,
    turnoverRate: 0,
    timestamp: `${parts[30] ?? ""} ${parts[31] ?? ""}`.trim() || new Date().toISOString()
  };
}

async function fetchTencentQuoteNormalized(code) {
  const instrument = instrumentOf(code);
  const text = await fetchText(`https://qt.gtimg.cn/q=${instrument.symbol}`, "https://gu.qq.com/", "gb18030");
  const match = text.match(/="([^"]*)"/);
  if (!match?.[1]) throw new Error(`empty tencent quote for ${code}`);
  const parts = match[1].split("~");
  const price = toNumber(parts[3]);
  const previousClose = toNumber(parts[4]);
  if (!price || !previousClose) throw new Error(`invalid tencent quote for ${instrument.code}`);

  return {
    providerId: "tencent",
    providerName: "腾讯行情",
    code: instrument.code,
    market: instrument.market,
    name: instrument.market === "HK" ? parts[46] || parts[1] || instrument.code : parts[1] || instrument.code,
    price,
    changePct: toNumber(parts[32], previousClose ? ((price - previousClose) / previousClose) * 100 : 0),
    previousClose,
    open: toNumber(parts[5]),
    high: toNumber(parts[33]),
    low: toNumber(parts[34]),
    volume: toNumber(parts[6]),
    amount: toNumber(parts[37]) * 10000,
    marketCap: instrument.market === "HK" ? toNumber(parts[44], toNumber(parts[45], 0)) : toNumber(parts[45], 0),
    pe: instrument.market === "HK" ? toNumber(parts[39], 0) : toNumber(parts[52], 0),
    pb: instrument.market === "HK" ? toNumber(parts[58], 0) : toNumber(parts[46], 0),
    turnoverRate: instrument.market === "HK" ? toNumber(parts[43], 0) : toNumber(parts[38], 0),
    timestamp: formatCompactTimestamp(parts[30])
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

async function timedProbe(probe) {
  const startedAt = Date.now();
  try {
    const evidence = await probe();
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      evidence
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: formatProbeError(error)
    };
  }
}

function formatProbeError(error) {
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === 52) return "上游连接返回空响应，等待下次探测重试";
    return `上游请求失败，退出码 ${error.code}`;
  }

  if (error instanceof Error) {
    return error.message.split("\n")[0].replace(/^Command failed: .+$/, "上游请求失败");
  }

  return String(error);
}

async function probePageContains(url, patterns, referer) {
  const text = await fetchText(url, referer);
  const missing = patterns.filter((pattern) => !text.includes(pattern));
  if (missing.length) {
    throw new Error(`页面已返回但缺少关键字: ${missing.join("/")}`);
  }
  return text.length;
}

function providerWithHealth(provider, health) {
  const checkedAt = new Date().toISOString();
  if (health.kind === "degraded") {
    return {
      ...provider,
      status: "standby",
      health: {
        state: "degraded",
        checkedAt,
        latencyMs: health.latencyMs,
        sampleCode: health.sampleCode,
        sampleName: health.sampleName ?? null,
        evidence: health.evidence,
        error: health.error ?? null
      }
    };
  }

  if (health.kind === "not-configured") {
    return {
      ...provider,
      status: "needs-token",
      health: {
        state: "not-configured",
        checkedAt,
        evidence: health.evidence,
        sampleCode: health.sampleCode ?? null
      }
    };
  }

  if (health.kind === "reserved") {
    return {
      ...provider,
      status: "extension-ready",
      health: {
        state: "reserved",
        checkedAt,
        evidence: health.evidence,
        sampleCode: health.sampleCode ?? null
      }
    };
  }

  return {
    ...provider,
    status: health.ok ? "connected" : "standby",
    health: {
      state: health.ok ? "verified" : "failed",
      checkedAt,
      latencyMs: health.latencyMs,
      sampleCode: health.sampleCode,
      sampleName: health.evidence?.sampleName ?? null,
      evidence: health.evidence?.evidence ?? [],
      error: health.error ?? null
    }
  };
}

async function buildProviderStatus(sampleCode = "300750") {
  const instrument = instrumentOf(sampleCode);
  const normalizedSampleCode = instrument.code;
  const hkSampleCode = instrument.market === "HK" ? instrument.rawCode : "00700";
  const [
    eastmoneyQuoteProbe,
    eastmoneyKlineProbe,
    tencentProbe,
    sinaProbe,
    hkexNewsProbe,
    aaStocksProbe,
    eastmoneyResearchProbe,
    eastmoneyUniverseProbe
  ] = await Promise.all([
    timedProbe(async () => {
      const quote = await fetchEastmoneyQuoteNormalized(normalizedSampleCode);
      return {
        sampleName: quote.name,
        evidence: [
          `报价 ${quote.price.toFixed(2)} / ${quote.changePct.toFixed(2)}%`,
          "字段: price/change/amount/PE/PB"
        ]
      };
    }),
    timedProbe(async () => {
      const kline = await fetchEastmoneyKline(normalizedSampleCode, { period: "day", limit: 3 });
      return {
        evidence: [
          `日K ${kline.at(-1)?.date ?? "无日期"}`,
          "字段: open/high/low/close/volume/amount"
        ]
      };
    }),
    timedProbe(async () => {
      const quote = await fetchTencentQuoteNormalized(normalizedSampleCode);
      return {
        sampleName: quote.name,
        evidence: [
          `报价 ${quote.price.toFixed(2)} / ${quote.changePct.toFixed(2)}%`,
          `时间戳 ${quote.timestamp}`,
          "字段: price/change/amount/PE/PB"
        ]
      };
    }),
    timedProbe(async () => {
      const quote = await fetchSinaQuoteNormalized(normalizedSampleCode);
      return {
        sampleName: quote.name,
        evidence: [
          `报价 ${quote.price.toFixed(2)} / ${quote.changePct.toFixed(2)}%`,
          `时间戳 ${quote.timestamp}`,
          "字段: price/change/volume/amount"
        ]
      };
    }),
    timedProbe(async () => {
      const length = await probePageContains(
        "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en",
        ["HKEXnews"],
        "https://www.hkexnews.hk/"
      );
      return {
        sampleName: "HKEXnews",
        evidence: [`披露易标题搜索页返回 ${length} 字节`, "字段: announcements/annual/interim/results"]
      };
    }),
    timedProbe(async () => {
      const length = await probePageContains(
        `https://www.aastocks.com/en/stocks/analysis/stock-aafn/${hkSampleCode}/0/hk-stock-news/1`,
        ["AASTOCKS", hkSampleCode],
        "https://www.aastocks.com/"
      );
      return {
        sampleName: `${hkSampleCode}.HK`,
        evidence: [`AAFN 个股页返回 ${length} 字节`, "字段: research-report/news/analysts-views入口"]
      };
    }),
    timedProbe(async () => {
      const length = await probePageContains(
        "https://data.eastmoney.com/report/stock.jshtml",
        ["个股研报", "盈利预测"],
        "https://data.eastmoney.com/report/"
      );
      return {
        sampleName: "研报中心",
        evidence: [`东方财富研报页返回 ${length} 字节`, "字段: stock-report/industry-report/profit-forecast入口"]
      };
    }),
    timedProbe(async () => {
      const universe = await buildMarketUniverse();
      return {
        sampleName: "A/H 股票池",
        evidence: [
          `A股 ${universe.coverage.A} 只 / 港股 ${universe.coverage.HK} 只`,
          "字段: code/name/sector/themes/price/change/turnover/marketCap"
        ]
      };
    })
  ]);

  const eastmoneyProbe =
    eastmoneyQuoteProbe.ok && eastmoneyKlineProbe.ok
      ? {
          ok: true,
          latencyMs: eastmoneyQuoteProbe.latencyMs + eastmoneyKlineProbe.latencyMs,
          sampleCode: normalizedSampleCode,
          evidence: {
            sampleName: eastmoneyQuoteProbe.evidence.sampleName,
            evidence: [
              ...eastmoneyQuoteProbe.evidence.evidence,
              ...eastmoneyKlineProbe.evidence.evidence
            ]
          }
        }
      : eastmoneyQuoteProbe.ok || eastmoneyKlineProbe.ok
        ? {
            kind: "degraded",
            latencyMs: eastmoneyQuoteProbe.latencyMs + eastmoneyKlineProbe.latencyMs,
            sampleCode: normalizedSampleCode,
            sampleName: eastmoneyQuoteProbe.evidence?.sampleName ?? null,
            evidence: [
              ...(eastmoneyQuoteProbe.ok ? eastmoneyQuoteProbe.evidence.evidence : [`报价探测失败: ${eastmoneyQuoteProbe.error}`]),
              ...(eastmoneyKlineProbe.ok ? eastmoneyKlineProbe.evidence.evidence : [`历史K线探测失败: ${eastmoneyKlineProbe.error}`])
            ],
            error: [
              eastmoneyQuoteProbe.ok ? null : eastmoneyQuoteProbe.error,
              eastmoneyKlineProbe.ok ? null : eastmoneyKlineProbe.error
            ].filter(Boolean).join("；")
          }
        : {
            ok: false,
            latencyMs: eastmoneyQuoteProbe.latencyMs + eastmoneyKlineProbe.latencyMs,
            sampleCode: normalizedSampleCode,
            error: [eastmoneyQuoteProbe.error, eastmoneyKlineProbe.error].filter(Boolean).join("；")
          };

  const healthById = {
    eastmoney: eastmoneyProbe,
    tencent: { ...tencentProbe, sampleCode: normalizedSampleCode },
    sina: { ...sinaProbe, sampleCode: normalizedSampleCode },
    tushare: process.env.TUSHARE_TOKEN
      ? {
          kind: "reserved",
          sampleCode: normalizedSampleCode,
          evidence: "已检测到 TUSHARE_TOKEN，但当前网关还未调用 Tushare 接口做在线探测。"
        }
      : {
          kind: "not-configured",
          sampleCode: normalizedSampleCode,
          evidence: "未检测到 TUSHARE_TOKEN，因此不能声明已接入。"
        },
    akshare: {
      kind: "reserved",
      evidence: "扩展位已定义，但当前 Node 网关没有启动 AKShare Python worker。"
    },
    baostock: {
      kind: "reserved",
      evidence: "扩展位已定义，但当前 Node 网关没有启动 BaoStock 离线任务。"
    },
    hkexnews: { ...hkexNewsProbe, sampleCode: "HKEXnews" },
    aastocks: { ...aaStocksProbe, sampleCode: `H${hkSampleCode}` },
    "eastmoney-research": { ...eastmoneyResearchProbe, sampleCode: normalizedSampleCode },
    "eastmoney-universe": { ...eastmoneyUniverseProbe, sampleCode: "ALL" },
    "futu-opend": process.env.FUTU_OPEND_HOST
      ? {
          kind: "reserved",
          sampleCode: `H${hkSampleCode}`,
          evidence: "已检测到 FUTU_OPEND_HOST，但当前网关还未调用富途 OpenD 做行情、账户或交易接口探测。"
        }
      : {
          kind: "not-configured",
          sampleCode: `H${hkSampleCode}`,
          evidence: "未检测到 FUTU_OPEND_HOST；富途 OpenD 只作为行情、账户或交易扩展位，不声明研报接入。"
        },
    "licensed-research": process.env.RESEARCH_VENDOR_TOKEN
      ? {
          kind: "reserved",
          sampleCode: normalizedSampleCode,
          evidence: "已检测到 RESEARCH_VENDOR_TOKEN，但当前尚未绑定具体授权供应商 API。"
        }
      : {
          kind: "not-configured",
          sampleCode: normalizedSampleCode,
          evidence: "未检测到 RESEARCH_VENDOR_TOKEN；完整券商研报、盈利预测和目标价历史不能声明已接入。"
        }
  };

  return providers.map((provider) => providerWithHealth(provider, healthById[provider.id]));
}

function extractAastocksItems(html, { rawCode, stockName, category, source, layer, confidence }) {
  const items = [];
  const seen = new Set();
  const stockNameTokens = String(stockName ?? "")
    .split(/[\s/,-]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 4 && !["holdings", "limited", "class", "inc"].includes(token));
  const blockRegex = /<div\s+ref=["']([^"']+)["']>([\s\S]*?)(?=<div\s+ref=["']NOW\.|<div\s+id=["']cp_ucAAFNSearch|$)/gi;
  let blockMatch;

  while ((blockMatch = blockRegex.exec(html)) && items.length < 8) {
    const newsId = blockMatch[1];
    const block = blockMatch[2];
    const anchorRegex = /<a\b[^>]*href=["']([^"']*stock-aafn-con\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let selectedAnchor = null;
    let anchorMatch;

    while ((anchorMatch = anchorRegex.exec(block))) {
      const href = anchorMatch[1];
      const title = stripHtml(anchorMatch[2]);
      if (!title) continue;
      if (!href.includes(`/${rawCode}/`) || !href.includes(`/${category}`)) continue;
      selectedAnchor = { href, title };
      break;
    }

    if (!selectedAnchor) continue;
    const url = absoluteUrl(selectedAnchor.href, "https://www.aastocks.com/");
    const uniqueKey = `${selectedAnchor.title}|${url}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    const date = normalizeAastocksDate(block.match(/ConvertToLocalTime\(\{dt:'([^']+)'\}\)/)?.[1]);
    const summaryRaw = block.match(/<div\s+class=["'][^"']*newscontent4[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
    const summary = stripHtml(summaryRaw);
    const haystack = `${selectedAnchor.title} ${summary}`.toLowerCase();
    const direct =
      haystack.includes(rawCode) ||
      stockNameTokens.some((token) => token.length >= 4 && haystack.includes(token));

    items.push({
      id: `aastocks-${category}-${newsId}`,
      code: `H${rawCode}`,
      source,
      layer,
      category,
      title: selectedAnchor.title,
      date,
      summary: summary ? `${summary.slice(0, 220)}${summary.length > 220 ? "..." : ""}` : "AAStocks 公开索引条目，需打开原文核对完整语境。",
      url,
      signal: inferResearchSignal(`${selectedAnchor.title} ${summary}`, layer),
      risks: inferRiskTags(`${selectedAnchor.title} ${summary}`),
      relevance: direct ? "direct" : "sector",
      confidence
    });
  }

  return items;
}

async function fetchAastocksCategory(rawCode, stockName, categoryConfig) {
  const url = `https://www.aastocks.com/en/stocks/analysis/stock-aafn/${rawCode}/0/${categoryConfig.category}/1`;
  const html = await fetchText(url, AASTOCKS_REFERER);
  const items = extractAastocksItems(html, { rawCode, stockName, ...categoryConfig });
  return {
    source: {
      name: categoryConfig.source,
      status: "verified",
      url,
      evidence: [
        `页面返回 ${html.length} 字节`,
        `解析 ${items.length} 条 ${categoryConfig.category} 索引`
      ]
    },
    items
  };
}

async function fetchHkexStockInfo(rawCode) {
  const prefixUrl = `https://www1.hkexnews.hk/search/prefix.do?lang=EN&type=A&name=${encodeURIComponent(rawCode)}&market=SEHK&callback=callback`;
  const prefix = parseJsonp(await fetchText(prefixUrl, HKEX_REFERER));
  const exactPrefix = prefix.stockInfo?.find((item) => item.code === rawCode);
  if (exactPrefix) return exactPrefix;

  const partialUrl = `https://www1.hkexnews.hk/search/partial.do?lang=EN&type=A&name=${encodeURIComponent(rawCode)}&market=SEHK&callback=callback`;
  const partial = parseJsonp(await fetchText(partialUrl, HKEX_REFERER));
  const exactPartial = partial.stockInfo?.find((item) => item.code === rawCode);
  if (exactPartial) return exactPartial;

  throw new Error(`HKEXnews 未返回 ${rawCode} 的内部证券 ID`);
}

async function fetchHkexAnnouncements(rawCode) {
  const stockInfo = await fetchHkexStockInfo(rawCode);
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 18);
  const fromDate = formatDateYYYYMMDD(from);
  const toDate = formatDateYYYYMMDD(to);
  const url =
    `https://www1.hkexnews.hk/search/titleSearchServlet.do?sortDir=0&sortByOptions=DateTime&category=0&market=SEHK` +
    `&stockId=${encodeURIComponent(stockInfo.stockId)}&fromDate=${fromDate}&toDate=${toDate}&documentType=-1&lang=EN&rowRange=10`;
  const payload = JSON.parse(await fetchText(url, HKEX_REFERER));
  const rows = payload.result && payload.result !== "null" ? JSON.parse(payload.result) : [];
  const items = rows.slice(0, 8).map((row) => {
    const title = stripHtml(row.TITLE || row.LONG_TEXT || row.SHORT_TEXT || "HKEXnews announcement");
    const summary = stripHtml(row.LONG_TEXT || row.SHORT_TEXT || title);
    return {
      id: `hkex-${row.NEWS_ID}`,
      code: `H${rawCode}`,
      source: "HKEXnews 披露易",
      layer: "official-filing",
      category: "announcement",
      title,
      date: normalizeHkexDate(row.DATE_TIME),
      summary: summary || "港交所披露易公告，需打开 PDF 核对全文。",
      url: absoluteUrl(row.FILE_LINK, "https://www1.hkexnews.hk/"),
      signal: "事实",
      risks: inferRiskTags(`${title} ${summary}`),
      relevance: "direct",
      confidence: 90
    };
  });

  return {
    stockInfo,
    source: {
      name: "HKEXnews 披露易",
      status: "verified",
      url: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en",
      evidence: [
        `内部 stockId ${stockInfo.stockId}`,
        `近 18 个月 ${payload.recordCnt ?? rows[0]?.TOTAL_COUNT ?? rows.length} 条公告，本次返回 ${items.length} 条`
      ]
    },
    items
  };
}

function buildHkResearchAnalysis(items) {
  const directCount = items.filter((item) => item.relevance === "direct").length;
  const sectorCount = items.filter((item) => item.relevance === "sector").length;
  const filingCount = items.filter((item) => item.layer === "official-filing").length;
  const researchCount = items.filter((item) => item.layer === "research-index" || item.layer === "public-view").length;
  const themes = inferThemeSignals(items);

  return {
    directCount,
    sectorCount,
    filingCount,
    researchCount,
    themes,
    notes: [
      `公开索引命中 ${items.length} 条，其中个股直接 ${directCount} 条、板块/同业 ${sectorCount} 条。`,
      `披露易公告 ${filingCount} 条用于事实校验，AAStocks 研报/观点索引 ${researchCount} 条用于观察市场叙事。`,
      "未接授权研报库时，不输出完整卖方一致预期、目标价历史或盈利预测上修结论。"
    ]
  };
}

async function buildHkResearchIndex(input) {
  const instrument = instrumentOf(input);
  if (instrument.market !== "HK") throw new Error("HK research index only supports Hong Kong securities");

  const cached = hkResearchCache.get(instrument.code);
  if (cached && Date.now() - cached.cachedAt < HK_RESEARCH_CACHE_MS) return cached.payload;

  const sources = [];
  const items = [];
  let stockName = instrument.rawCode;

  const hkexResult = await Promise.allSettled([fetchHkexAnnouncements(instrument.rawCode)]);
  const hkex = hkexResult[0];
  if (hkex.status === "fulfilled") {
    stockName = hkex.value.stockInfo.name || stockName;
    sources.push(hkex.value.source);
    items.push(...hkex.value.items);
  } else {
    sources.push({
      name: "HKEXnews 披露易",
      status: "failed",
      url: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en",
      evidence: ["股票级公告接口本轮未返回可用结果"],
      error: hkex.reason instanceof Error ? hkex.reason.message : String(hkex.reason)
    });
  }

  const aastocksResults = await Promise.allSettled(
    aastocksCategories.map((category) => fetchAastocksCategory(instrument.rawCode, stockName, category))
  );
  aastocksResults.forEach((result, index) => {
    const category = aastocksCategories[index];
    if (result.status === "fulfilled") {
      sources.push(result.value.source);
      items.push(...result.value.items);
      return;
    }
    sources.push({
      name: category.source,
      status: "failed",
      url: `https://www.aastocks.com/en/stocks/analysis/stock-aafn/${instrument.rawCode}/0/${category.category}/1`,
      evidence: [`${category.category} 页面本轮未返回可解析结果`],
      error: result.reason instanceof Error ? result.reason.message : String(result.reason)
    });
  });

  const irSource = hkCompanyIrLinks[instrument.code];
  if (irSource) {
    sources.push({
      name: irSource.name,
      status: "verified",
      url: irSource.url,
      evidence: [irSource.evidence]
    });
  } else {
    sources.push({
      name: "公司 IR",
      status: "reserved",
      url: "https://www.hkexnews.hk/",
      evidence: ["当前股票未配置公司 IR 白名单链接，先使用披露易公告核验。"]
    });
  }

  sources.push(
    process.env.RESEARCH_VENDOR_TOKEN
      ? {
          name: "授权研报库",
          status: "reserved",
          url: "https://www.51ifind.com/",
          evidence: ["已检测到 RESEARCH_VENDOR_TOKEN，但尚未绑定具体供应商字段。"]
        }
      : {
          name: "授权研报库",
          status: "not-configured",
          url: "https://www.51ifind.com/",
          evidence: ["未检测到 RESEARCH_VENDOR_TOKEN，不能声明完整券商研报和一致预期已接入。"]
        }
  );

  const dedupedItems = Array.from(
    items
      .sort((a, b) => {
        const relevanceDiff = (a.relevance === "direct" ? 0 : 1) - (b.relevance === "direct" ? 0 : 1);
        if (relevanceDiff) return relevanceDiff;
        return String(b.date).localeCompare(String(a.date));
      })
      .reduce((map, item) => {
        const key = `${item.date}|${item.title}`;
        if (!map.has(key)) map.set(key, item);
        return map;
      }, new Map())
      .values()
  ).slice(0, 18);
  const analysis = buildHkResearchAnalysis(dedupedItems);
  const payload = {
    code: instrument.code,
    rawCode: instrument.rawCode,
    market: "HK",
    name: stockName,
    generatedAt: new Date().toISOString(),
    coverage: {
      quote: "行情快照由 /api/market/snapshot 使用东方财富、腾讯、新浪交叉校验。",
      officialFiling: sources.find((source) => source.name.includes("HKEXnews"))?.status === "verified" ? "HKEXnews 股票级公告已返回" : "HKEXnews 本轮未完成股票级公告校验",
      publicResearch: `AAStocks 分类页已尝试 ${aastocksCategories.length} 个入口。`,
      licensedConsensus: process.env.RESEARCH_VENDOR_TOKEN ? "检测到授权研报扩展 token，待绑定供应商 API。" : "未配置授权研报库，无法给出完整卖方一致预期。"
    },
    analysis,
    items: dedupedItems,
    sources,
    limitations: [
      "AAStocks 是公开新闻/观点索引，可能包含同业或板块报告；页面用“个股直接/板块同业”标识相关性。",
      "HKEXnews 是公告事实源，不代表买卖建议；公告 PDF 仍需打开原文复核。",
      "完整研报全文、目标价历史、盈利预测和一致预期必须接入 Wind、Choice、iFinD、FactSet、LSEG 或 Bloomberg 等授权库。"
    ]
  };

  hkResearchCache.set(instrument.code, { cachedAt: Date.now(), payload });
  return payload;
}

async function fetchQuoteConsensus(code) {
  const instrument = instrumentOf(code);
  const allProviders = [
    { id: "eastmoney", name: "东方财富 Push2", fetcher: fetchEastmoneyQuoteNormalized },
    { id: "tencent", name: "腾讯行情", fetcher: fetchTencentQuoteNormalized },
    { id: "sina", name: "新浪行情", fetcher: fetchSinaQuoteNormalized }
  ];
  const providersToTry = allProviders.filter((provider) => instrument.quoteSourceIds.includes(provider.id));

  const attempts = await Promise.allSettled(providersToTry.map((provider) => provider.fetcher(instrument.code)));
  const sources = attempts.map((result, index) => {
    const provider = providersToTry[index];
    if (result.status === "fulfilled") {
      return {
        ...result.value,
        providerId: provider.id,
        providerName: provider.name,
        status: "received",
        priceDiffPct: 0,
        changeDiffPct: 0
      };
    }

    return {
      providerId: provider.id,
      providerName: provider.name,
      code: instrument.code,
      market: instrument.market,
      status: "failed",
      error: result.reason instanceof Error ? result.reason.message : String(result.reason)
    };
  });

  const usable = sources.filter((source) => source.status === "received" && source.price > 0);
  if (!usable.length) throw new Error(`all quote sources failed for ${instrument.code}`);

  const consensusPrice = median(usable.map((source) => source.price));
  const consensusChangePct = median(usable.map((source) => source.changePct));
  const sourceChecks = sources.map((source) => {
    if (source.status === "failed") return source;
    const priceDiffPct = consensusPrice ? (Math.abs(source.price - consensusPrice) / consensusPrice) * 100 : 0;
    const changeDiffPct = Math.abs(source.changePct - consensusChangePct);
    const verified = priceDiffPct <= QUOTE_PRICE_TOLERANCE_PCT && changeDiffPct <= QUOTE_CHANGE_TOLERANCE_PCT;
    return {
      ...source,
      status: verified ? "verified" : "disagreed",
      priceDiffPct: Number(priceDiffPct.toFixed(3)),
      changeDiffPct: Number(changeDiffPct.toFixed(3))
    };
  });

  const verifiedSources = sourceChecks.filter((source) => source.status === "verified");
  const failedSources = sourceChecks.filter((source) => source.status === "failed");
  const disagreedSources = sourceChecks.filter((source) => source.status === "disagreed");
  const maxPrice = Math.max(...usable.map((source) => source.price));
  const minPrice = Math.min(...usable.map((source) => source.price));
  const priceSpreadPct = consensusPrice ? ((maxPrice - minPrice) / consensusPrice) * 100 : 0;
  const quoteConfidence = Math.round(
    Math.max(
      35,
      Math.min(
        99,
        46 +
          usable.length * 12 +
          verifiedSources.length * 10 -
          failedSources.length * 8 -
          disagreedSources.length * 14 -
          Math.min(18, priceSpreadPct * 12)
      )
    )
  );
  const quoteConsensus =
    usable.length === 1
      ? "单源可用"
      : disagreedSources.length > 0
        ? "存在分歧"
        : verifiedSources.length >= 3
          ? "三源强一致"
          : "双源一致";
  const primary =
    usable.find((source) => source.providerId === "eastmoney") ??
    usable.reduce((closest, source) =>
      Math.abs(source.price - consensusPrice) < Math.abs(closest.price - consensusPrice) ? source : closest
    );

  return {
    quote: primary,
    dataQuality: {
      quoteConfidence,
      quoteConsensus,
      consensusPrice: Number(consensusPrice.toFixed(3)),
      consensusChangePct: Number(consensusChangePct.toFixed(3)),
      priceSpreadPct: Number(priceSpreadPct.toFixed(3)),
      sourceCount: usable.length,
      verifiedSourceCount: verifiedSources.length,
      failedSourceCount: failedSources.length,
      verifiedSources: verifiedSources.map((source) => source.providerName),
      failedSources: failedSources.map((source) => source.providerName),
      disagreedSources: disagreedSources.map((source) => source.providerName),
      lastVerifiedAt: new Date().toISOString(),
      sources: sourceChecks.map((source) => ({
        providerId: source.providerId,
        providerName: source.providerName,
        status: source.status,
        price: source.price ?? null,
        changePct: source.changePct ?? null,
        timestamp: source.timestamp ?? null,
        priceDiffPct: source.priceDiffPct ?? null,
        changeDiffPct: source.changeDiffPct ?? null,
        error: source.error ?? null
      }))
    }
  };
}

async function fetchEastmoneyKline(code, options = {}) {
  const instrument = instrumentOf(code);
  const period = options.period ?? "day";
  const config = klinePeriodConfig[period] ?? klinePeriodConfig.day;
  const limit = Math.max(5, Math.min(Number(options.limit ?? config.defaultLimit), 320));
  const fields1 = "f1,f2,f3,f4,f5,f6";
  const fields2 = "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61";
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${instrument.secid}` +
    `&klt=${config.klt}&fqt=1&end=20500101&lmt=${limit}&fields1=${fields1}&fields2=${fields2}`;
  const json = await fetchJson(url);
  const klines = json?.data?.klines;
  if (!Array.isArray(klines) || !klines.length) throw new Error(`empty kline for ${instrument.code}`);
  return klines.map((line) => {
    const [date, open, close, high, low, volume, amount, amplitude, pct, change, turnover] = line.split(",");
    return {
      date,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      amount: Number(amount),
      amplitude: Number(amplitude),
      pct: Number(pct),
      change: Number(change),
      turnover: Number(turnover)
    };
  });
}

async function fetchTencentKline(code, options = {}) {
  const instrument = instrumentOf(code);
  const period = options.period ?? "day";
  const config = klinePeriodConfig[period] ?? klinePeriodConfig.day;
  const limit = Math.max(5, Math.min(Number(options.limit ?? config.defaultLimit), 320));
  const tencentPeriod = { day: "day", week: "week", month: "month", year: "year" }[period] ?? "day";
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${instrument.symbol},${tencentPeriod},,,${limit},qfq`;
  const json = JSON.parse(await fetchText(url, "https://gu.qq.com/"));
  const payload = json?.data?.[instrument.symbol];
  const rows = payload?.[`qfq${tencentPeriod}`] ?? payload?.[tencentPeriod];
  if (!Array.isArray(rows) || !rows.length) throw new Error(`empty tencent kline for ${instrument.code}`);

  return rows.map((row, index) => {
    const open = Number(row[1]);
    const close = Number(row[2]);
    const high = Number(row[3]);
    const low = Number(row[4]);
    const volume = Number(row[5]);
    const previousClose = index > 0 ? Number(rows[index - 1][2]) : open;
    const change = close - previousClose;
    const pct = previousClose ? (change / previousClose) * 100 : 0;
    const amplitude = previousClose ? ((high - low) / previousClose) * 100 : 0;
    return {
      date: row[0],
      open,
      close,
      high,
      low,
      volume,
      amount: 0,
      amplitude: Number(amplitude.toFixed(2)),
      pct: Number(pct.toFixed(2)),
      change: Number(change.toFixed(3)),
      turnover: 0
    };
  });
}

async function fetchPreferredKline(code, options = {}) {
  try {
    return {
      providerId: "eastmoney",
      providerName: "东方财富 Push2His",
      confidence: 78,
      verifiedSources: ["东方财富 Push2His"],
      items: await fetchEastmoneyKline(code, options)
    };
  } catch (eastmoneyError) {
    return {
      providerId: "tencent",
      providerName: "腾讯历史K线",
      confidence: 70,
      verifiedSources: ["腾讯历史K线"],
      upstreamWarning: formatProbeError(eastmoneyError),
      items: await fetchTencentKline(code, options)
    };
  }
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = average(values);
  const variance = average(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function calculateRsi(closes, period = 14) {
  if (closes.length <= period) return 50;
  const slice = closes.slice(-period - 1);
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < slice.length; index += 1) {
    const change = slice[index] - slice[index - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function ema(values, period) {
  const multiplier = 2 / (period + 1);
  return values.reduce((previous, value, index) => {
    if (index === 0) return value;
    return value * multiplier + previous * (1 - multiplier);
  }, values[0] ?? 0);
}

function calculateMacd(closes) {
  if (closes.length < 26) return 0;
  return ema(closes, 12) - ema(closes, 26);
}

function buildTechnicals(klines) {
  if (!klines.length) {
    return {
      close: [],
      volume: [],
      ma20: 0,
      ma60: 0,
      rsi: 50,
      macd: 0,
      support: 0,
      resistance: 0,
      turnoverRate: 0,
      volatility: 0
    };
  }

  const closes = klines.map((item) => item.close);
  const volumes = klines.map((item) => item.volume);
  const recent = klines.slice(-20);
  const returns = recent.slice(1).map((item, index) => {
    const previous = recent[index].close;
    return previous ? (item.close - previous) / previous : 0;
  });

  return {
    close: closes.slice(-60),
    volume: volumes.slice(-60),
    ma20: average(closes.slice(-20)),
    ma60: average(closes.slice(-60)),
    rsi: Math.round(calculateRsi(closes)),
    macd: Number(calculateMacd(closes).toFixed(2)),
    support: Math.min(...recent.map((item) => item.low)),
    resistance: Math.max(...recent.map((item) => item.high)),
    turnoverRate: recent.at(-1)?.turnover ?? 0,
    volatility: Number((standardDeviation(returns) * Math.sqrt(252) * 100).toFixed(1))
  };
}

function fallbackKlines(price, length = 60) {
  const today = new Date().toISOString().slice(0, 10);
  return Array.from({ length }, (_, index) => ({
    date: today,
    open: price,
    close: price,
    high: price,
    low: price,
    volume: 0,
    amount: 0,
    amplitude: 0,
    pct: 0,
    change: 0,
    turnover: 0,
    index
  }));
}

function buildTradingPlan(quote, technicals, dataQuality) {
  const price = quote.price;
  const support = technicals.support || price;
  const resistance = technicals.resistance || price;
  const downsidePct = price ? ((price - support) / price) * 100 : 0;
  const upsidePct = price ? ((resistance - price) / price) * 100 : 0;
  const riskReward = downsidePct > 0 ? upsidePct / downsidePct : 0;
  const aboveMa20 = price >= technicals.ma20;
  const aboveMa60 = price >= technicals.ma60;
  const maTrendUp = technicals.ma20 >= technicals.ma60;
  const healthyRsi = technicals.rsi >= 42 && technicals.rsi <= 68;
  const overHeat = technicals.rsi > 72 || price >= resistance * 0.98;
  const brokenStructure = price < support || (!aboveMa60 && technicals.macd < 0);
  const confidenceOk = dataQuality.quoteConfidence >= 72;

  let action = "继续观察";
  if (!confidenceOk) {
    action = "继续观察";
  } else if (brokenStructure) {
    action = "风险警惕";
  } else if (overHeat) {
    action = "等待回调";
  } else if (aboveMa20 && aboveMa60 && maTrendUp && healthyRsi && riskReward >= 1.15) {
    action = "分批关注";
  }

  const trend =
    aboveMa20 && maTrendUp
      ? "多头结构"
      : aboveMa60
        ? "震荡修复"
        : "弱势观察";
  const setup =
    action === "分批关注"
      ? "回踩 MA20 不破且量能不失真时试探"
      : action === "等待回调"
        ? "等待高位换手消化后靠近支撑区"
        : action === "风险警惕"
          ? "趋势破位或动量转弱，先控制回撤"
          : "等待价格重新站上关键均线并通过多源校验";
  const entryLow = Math.max(support, Math.min(technicals.ma20, price) * 0.985);
  const entryHigh = Math.min(price * 1.012, Math.max(technicals.ma20, support) * 1.025);
  const stopLoss = Math.min(support * 0.97, price * 0.94);
  const takeProfit = Math.max(resistance, price * 1.08);

  return {
    action,
    trend,
    setup,
    entryZone: `${entryLow.toFixed(2)} - ${entryHigh.toFixed(2)}`,
    addCondition: `放量站稳 ${Math.max(technicals.ma20, price).toFixed(2)} 且多源价差 < ${QUOTE_PRICE_TOLERANCE_PCT}%`,
    stopLoss: stopLoss.toFixed(2),
    takeProfit: takeProfit.toFixed(2),
    riskReward: Number(riskReward.toFixed(2)),
    positionSizing:
      dataQuality.quoteConfidence >= 88 && action === "分批关注"
        ? "基础仓 20%-30%，回踩确认后再加"
        : action === "风险警惕"
          ? "降至观察仓或空仓"
          : "观察仓 10%-15%，等待确认",
    invalidation: `跌破 ${support.toFixed(2)} 或三源报价出现明显分歧`,
    notes: [
      trend,
      `RSI ${technicals.rsi}`,
      `MACD ${technicals.macd.toFixed(2)}`,
      `多源可信度 ${dataQuality.quoteConfidence}`
    ]
  };
}

function buildMarketScore(quote, technicals, dataQuality, tradingPlan) {
  const trendScore =
    quote.price >= technicals.ma20 && technicals.ma20 >= technicals.ma60
      ? 82
      : quote.price >= technicals.ma60
        ? 66
        : 46;
  const momentumScore =
    technicals.rsi > 72
      ? 48
      : technicals.rsi >= 45 && technicals.rsi <= 68
        ? 78
        : technicals.rsi < 36
          ? 42
          : 62;
  const valuationScore = quote.pe > 0 && quote.pe < 35 ? 72 : quote.pe >= 35 ? 52 : 58;
  const actionBoost = tradingPlan.action === "分批关注" ? 6 : tradingPlan.action === "风险警惕" ? -10 : 0;
  return Math.round(
    Math.max(
      35,
      Math.min(
        95,
        trendScore * 0.34 +
          momentumScore * 0.22 +
          valuationScore * 0.14 +
          dataQuality.quoteConfidence * 0.3 +
          actionBoost
      )
    )
  );
}

async function buildKlinePayload(code, period = "day", limit) {
  const instrument = instrumentOf(code);
  const config = klinePeriodConfig[period] ?? klinePeriodConfig.day;
  const kline = await fetchPreferredKline(instrument.code, { period, limit });
  return {
    code: instrument.code,
    market: instrument.market,
    period,
    label: config.label,
    providerId: kline.providerId,
    providerName: kline.providerName,
    confidence: kline.confidence,
    verifiedSources: kline.verifiedSources,
    upstreamWarning: kline.upstreamWarning ?? null,
    lastUpdatedAt: new Date().toISOString(),
    items: kline.items,
    technicals: buildTechnicals(kline.items)
  };
}

async function buildSnapshot(code) {
  const instrument = instrumentOf(code);
  const { quote, dataQuality } = await fetchQuoteConsensus(instrument.code);
  const price = quote.price;
  let klines;
  let klineSource = "东方财富 Push2His";
  let klineReady = true;
  try {
    const kline = await fetchPreferredKline(instrument.code, { period: "day" });
    klines = kline.items;
    klineSource = kline.providerName;
  } catch {
    klineReady = false;
    klines = fallbackKlines(price);
    klineSource = "无可用历史K线";
  }
  const pct = quote.changePct;
  const marketCap = quote.marketCap;
  const technicals = buildTechnicals(klines);
  const latest = klines.at(-1);
  const tradingPlan = buildTradingPlan(quote, technicals, dataQuality);
  const score = buildMarketScore(quote, technicals, dataQuality, tradingPlan);

  return {
    code: instrument.code,
    market: instrument.market,
    name: quote.name ?? instrument.code,
    sector: instrument.market === "HK" ? "港股多源校验" : "多源校验",
    price,
    changePct: pct,
    marketCap,
    score,
    action: tradingPlan.action,
    thesis: `${quote.name ?? code} 报价经 ${dataQuality.sourceCount} 个公开行情源校验，${dataQuality.quoteConsensus}，可信度 ${dataQuality.quoteConfidence}/100；当前价格 ${price.toFixed(2)}，涨跌幅 ${pct.toFixed(2)}%。${klineReady ? `${klineSource} 已更新，交易逻辑按趋势、位置、量能和风险收益比生成。` : "K 线接口暂不可用，本次仅更新报价。"} `,
    fundamentals: {
      pe: quote.pe > 0 ? quote.pe : null,
      pb: quote.pb > 0 ? quote.pb : null,
      roe: null,
      revenueYoy: null,
      profitYoy: null,
      grossMargin: null,
      debtRatio: null,
      ocfToProfit: null,
      dividendYield: null
    },
    technicals,
    sentiment: {
      score: Math.round(Math.max(20, Math.min(95, 55 + pct * 5))),
      newsTone: Math.round(Math.max(20, Math.min(90, 55 + pct * 4))),
      socialHeat: Math.round(Math.max(25, Math.min(95, 50 + Math.abs(pct) * 8 + technicals.turnoverRate * 2))),
      northbound: 0,
      marginBalanceChange: 0,
      mainNetInflow: Number(((quote.amount / 100000000) * pct / 1000).toFixed(2)),
      riskTags: [
        latest ? `成交额 ${(latest.amount / 100000000).toFixed(1)} 亿` : "成交额待补",
        klineReady ? `${klineSource} K线已更新` : "K线暂不可用",
        `${dataQuality.quoteConsensus} · 价差 ${dataQuality.priceSpreadPct.toFixed(3)}%`,
        technicals.rsi > 70 ? "RSI 偏热" : technicals.rsi < 40 ? "RSI 偏弱" : "RSI 健康",
        "财务字段待 Tushare/年报补全"
      ]
    },
    dataQuality,
    tradingPlan,
    events: []
  };
}

async function fetchIndexes() {
  const fields = "f12,f14,f2,f3,f6";
  const secids = indexSecids.map((item) => item.secid).join(",");
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${secids}&fields=${fields}`;
  const json = await fetchJson(url);
  const diff = json?.data?.diff ?? [];
  return diff.map((item) => ({
    name: item.f14,
    value: toScaled(item.f2, 100),
    changePct: toScaled(item.f3, 100),
    turnover: toScaled(item.f6, 100000000)
  }));
}

function streamEventFor(snapshot) {
  const tone = snapshot.changePct < 0 ? "negative" : snapshot.changePct > 0 ? "positive" : "neutral";
  return {
    id: `verified-quote-${snapshot.code}-${Date.now()}`,
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    source: "资金",
    stockCode: snapshot.code,
    stockName: snapshot.name,
    title: `多源校验快照：${snapshot.price.toFixed(2)}，${snapshot.changePct.toFixed(2)}%，可信度 ${snapshot.dataQuality?.quoteConfidence ?? "--"}`,
    tone,
    impact: Math.round(Math.max(45, Math.min(95, 55 + Math.abs(snapshot.changePct) * 8)))
  };
}

function route(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === "/api/providers") {
    let sampleCode;
    try {
      sampleCode = normalizeCode(url.searchParams.get("sample") ?? "300750");
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    buildProviderStatus(sampleCode)
      .then((data) => sendJson(res, 200, { providers: data, sampleCode, timestamp: new Date().toISOString() }))
      .catch((error) => sendError(res, 502, error.message));
    return;
  }

  if (pathname === "/api/market/indexes") {
    fetchIndexes().then((data) => sendJson(res, 200, data)).catch((error) => sendError(res, 502, error.message));
    return;
  }

  if (pathname === "/api/market/universe") {
    const marketParam = String(url.searchParams.get("market") ?? "ALL").toUpperCase();
    const market = marketParam === "A" || marketParam === "HK" ? marketParam : "ALL";
    const query = url.searchParams.get("q") ?? "";
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 80;
    buildMarketUniverse()
      .then((universe) => {
        const result = searchMarketUniverse(universe.items, { query, market, limit });
        sendJson(res, 200, {
          items: result.items,
          total: universe.items.length,
          matched: result.matched,
          source: "东方财富 Push2 clist",
          refreshedAt: universe.refreshedAt,
          coverage: universe.coverage
        });
      })
      .catch((error) => sendError(res, 502, error.message));
    return;
  }

  if (pathname === "/api/market/themes") {
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 8;
    buildMarketThemes(limit)
      .then((themes) =>
        sendJson(res, 200, { themes, source: "东方财富概念/行业板块榜", timestamp: new Date().toISOString() })
      )
      .catch((error) => sendError(res, 502, error.message));
    return;
  }

  const hkResearchMatch = pathname.match(/^\/api\/research\/hk\/([A-Za-z]{0,2}\d{5})$/);
  if (hkResearchMatch) {
    buildHkResearchIndex(hkResearchMatch[1])
      .then((data) => sendJson(res, 200, data))
      .catch((error) => sendError(res, 502, error.message));
    return;
  }

  if (pathname === "/api/research/document") {
    const documentUrl = url.searchParams.get("url") ?? "";
    if (!documentUrl) {
      sendError(res, 400, "missing research document url");
      return;
    }

    extractResearchDocument({
      url: documentUrl,
      code: url.searchParams.get("code") ?? "",
      title: url.searchParams.get("title") ?? "",
      source: url.searchParams.get("source") ?? ""
    })
      .then((data) => sendJson(res, 200, data))
      .catch((error) => sendError(res, 502, error.message));
    return;
  }

  const snapshotMatch = pathname.match(/^\/api\/(?:market|ifind)\/snapshot\/([A-Za-z]{0,2}\d{5,6})$/);
  if (snapshotMatch) {
    buildSnapshot(snapshotMatch[1])
      .then((data) => sendJson(res, 200, data))
      .catch((error) => sendError(res, 502, error.message));
    return;
  }

  const klineMatch = pathname.match(/^\/api\/market\/kline\/([A-Za-z]{0,2}\d{5,6})$/);
  if (klineMatch) {
    const requestedPeriod = url.searchParams.get("period") ?? "day";
    const period = klinePeriodConfig[requestedPeriod] ? requestedPeriod : "day";
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    buildKlinePayload(klineMatch[1], period, limit)
      .then((data) => sendJson(res, 200, data))
      .catch((error) => sendError(res, 502, error.message));
    return;
  }

  if (pathname === "/api/market/stream" || pathname === "/api/ifind/stream") {
    const codes = (url.searchParams.get("codes") ?? "")
      .split(",")
      .map((code) => {
        try {
          return normalizeCode(code);
        } catch {
          return "";
        }
      })
      .filter(Boolean)
      .slice(0, 12);

    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });

    const write = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    write({
      id: `gateway-open-${Date.now()}`,
      time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      source: "新闻",
      title: "多源数据网关已连接：东方财富、腾讯、新浪A/H报价校验运行中",
      tone: "positive",
      impact: 60
    });

    const timer = setInterval(async () => {
      const code = codes[Math.floor(Math.random() * codes.length)];
      if (!code) return;
      try {
        const snapshot = await buildSnapshot(code);
        write(streamEventFor(snapshot));
      } catch {
        write({
          id: `gateway-error-${Date.now()}`,
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          source: "新闻",
          title: "东方财富行情轮询失败，等待下一轮重试",
          tone: "neutral",
          impact: 45
        });
      }
    }, 15000);

    req.on("close", () => clearInterval(timer));
    return;
  }

  sendError(res, 404, "not found");
}

http.createServer(route).listen(PORT, "127.0.0.1", () => {
  console.log(`data gateway ready: http://127.0.0.1:${PORT}`);
});
