import { dailyLearningPicks } from "../shared/curation";
import { readService } from "../../../shared/service-client.js";
import {
  readContent,
  isManifest,
  isDashboard,
} from "../../../shared/content-client.js";
import {
  Bell,
  Bookmark,
  Check,
  ExternalLink,
  GitPullRequest,
  Loader2,
  RefreshCw,
  Search,
  Star,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnalysisProgress,
  AnalysisClaim,
  DeepDive,
  AnnualHighlightRecord,
  AnnualHighlightsResponse,
  DashboardResponse,
  FetchRangeResponse,
  ImportanceLevel,
  PullRequestRecord,
  SnapshotSummary,
  StaticDataset,
  TimelineResponse,
} from "../shared/types";

const importanceOrder: ImportanceLevel[] = [5, 4, 3, 2, 1];
const ANNUAL_PICK_LIMIT = 12;
const SERVICE_MODE = import.meta.env.VITE_READER_SERVICE === "true";
const STATIC_MODE = import.meta.env.VITE_STATIC_DATA === "true";
const LOCAL_DATA_BASE = new URL(
  `${import.meta.env.BASE_URL}data/`,
  document.baseURI,
).href;
const DATA_BASE = import.meta.env.VITE_PUBLIC_DATA_URL || LOCAL_DATA_BASE;
const STATIC_DATA_URL = new URL("static.json", DATA_BASE).href;
const reportContentStatus = (status: string) => {
  document.documentElement.dataset.pocketContentStatus = status;
  window.dispatchEvent(
    new CustomEvent("pocket-content-status", { detail: status }),
  );
};
const requestedDate = new URLSearchParams(window.location.search).get("date");
const READER_MODE = STATIC_MODE || SERVICE_MODE;
const serviceRecords = new Map<number, PullRequestRecord>();
const LOCAL_STATE_KEY = "ai-infra-pr-radar-state-v1";

const laneCopy: Record<ImportanceLevel, { title: string; caption: string }> = {
  5: { title: "P5 架构级", caption: "改变核心路径" },
  4: { title: "P4 深读", caption: "值得拆 diff" },
  3: { title: "P3 关注", caption: "跟进方向" },
  2: { title: "P2 扫读", caption: "维护与小改" },
  1: { title: "P1 归档", caption: "留档即可" },
};

type ViewMode = "all" | "unread" | "favorites" | "watch";
type SurfaceMode = "daily" | "board" | "timeline" | "picks";
type DisplayPullRequest = PullRequestRecord &
  Partial<Pick<AnnualHighlightRecord, "highlightReason" | "highlightScore">>;
type LocalPrState = Partial<
  Pick<PullRequestRecord, "isFavorite" | "isRead" | "watchLater" | "userNote">
>;

let staticDatasetPromise: Promise<StaticDataset> | null = null;
const dayRequests = new Map<string, Promise<DashboardResponse>>();
const shanghaiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const shanghaiDay = (timestamp: string) =>
  shanghaiDateFormatter.format(new Date(timestamp));

function readLocalStates(): Record<string, LocalPrState> {
  try {
    return JSON.parse(
      window.localStorage.getItem(LOCAL_STATE_KEY) ?? "{}",
    ) as Record<string, LocalPrState>;
  } catch {
    return {};
  }
}

function writeLocalStates(states: Record<string, LocalPrState>) {
  window.localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(states));
}

function withLocalState<T extends PullRequestRecord>(pr: T): T {
  return {
    ...pr,
    ...(readLocalStates()[String(pr.id)] ?? {}),
  };
}

function withLocalStates<T extends PullRequestRecord>(prs: T[]): T[] {
  const states = readLocalStates();
  return prs.map((pr) => ({ ...pr, ...(states[String(pr.id)] ?? {}) }));
}

function dashboardStats(prs: PullRequestRecord[]): DashboardResponse["stats"] {
  return {
    total: prs.length,
    unread: prs.filter((pr) => !pr.isRead).length,
    favorites: prs.filter((pr) => pr.isFavorite).length,
    watchLater: prs.filter((pr) => pr.watchLater).length,
    byImportance: prs.reduce<Record<string, number>>((acc, pr) => {
      acc[String(pr.importance)] = (acc[String(pr.importance)] ?? 0) + 1;
      return acc;
    }, {}),
    byCategory: prs.reduce<Record<string, number>>((acc, pr) => {
      acc[pr.category] = (acc[pr.category] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

function timelineStats(prs: PullRequestRecord[]): TimelineResponse["stats"] {
  return {
    total: prs.length,
    days: new Set(prs.map((pr) => shanghaiDay(pr.mergedAt))).size,
    byMonth: prs.reduce<Record<string, number>>((acc, pr) => {
      const month = shanghaiDay(pr.mergedAt).slice(0, 7);
      acc[month] = (acc[month] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

async function loadStaticDataset(): Promise<StaticDataset> {
  if (!staticDatasetPromise) {
    staticDatasetPromise = readContent<StaticDataset>(STATIC_DATA_URL, {
      validate: isManifest,
      onStatus: reportContentStatus,
    }).catch((error) => {
      staticDatasetPromise = null;
      throw error;
    });
  }
  return staticDatasetPromise;
}

function findStaticPr(
  dataset: StaticDataset,
  id: number,
): PullRequestRecord | null {
  for (const dashboard of Object.values(dataset.dashboards)) {
    const match = dashboard.prs.find((pr) => pr.id === id);
    if (match) {
      return match;
    }
  }
  return (
    dataset.timeline.prs.find((pr) => pr.id === id) ??
    Object.values(dataset.highlights)
      .flatMap((year) => year.prs)
      .find((pr) => pr.id === id) ??
    null
  );
}

async function loadStaticDay(
  dataset: StaticDataset,
  date: string,
): Promise<void> {
  const file = dataset.dashboardFiles?.[date];
  if (!file || dataset.dashboards[date]) return;
  if (!/^days\/\d{4}-\d{2}-\d{2}\.json$/.test(file))
    throw new Error("归档路径不正确");
  if (!dayRequests.has(date))
    dayRequests.set(
      date,
      readContent<DashboardResponse>(
        `${new URL(file, DATA_BASE).href}?v=${encodeURIComponent(dataset.generatedAt)}`,
        {
          validate: (value) => isDashboard(value) && value.date === date,
          onStatus: reportContentStatus,
        },
      ).catch((error) => {
        dayRequests.delete(date);
        throw error;
      }),
    );
  dataset.dashboards[date] = await dayRequests.get(date)!;
}

async function staticDashboard(
  dataset: StaticDataset,
  date: string,
): Promise<DashboardResponse> {
  await loadStaticDay(dataset, date);
  const dashboard =
    dataset.dashboards[date] ??
    ({
      date,
      snapshot: null,
      prs: [],
      repos: Object.values(dataset.dashboards)[0]?.repos ?? [],
      stats: dashboardStats([]),
    } satisfies DashboardResponse);
  const prs = withLocalStates(dashboard.prs);
  return {
    ...dashboard,
    prs,
    stats: dashboardStats(prs),
  };
}

async function staticTimeline(
  dataset: StaticDataset,
  start: string,
  end: string,
  _limit: number,
): Promise<TimelineResponse> {
  if (dataset.dashboardFiles) {
    const dates = dataset.days
      .filter((day) => day.date >= start && day.date <= end)
      .map((day) => day.date);
    for (let i = 0; i < dates.length; i += 6)
      await Promise.all(
        dates.slice(i, i + 6).map((date) => loadStaticDay(dataset, date)),
      );
  }
  const archive = dataset.dashboardFiles
    ? Object.values(dataset.dashboards).flatMap((day) => day.prs)
    : dataset.timeline.prs;
  const prs = withLocalStates(
    archive
      .filter((pr) => {
        const day = shanghaiDay(pr.mergedAt);
        return day >= start && day <= end;
      })
      .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt)),
  );
  return { start, end, prs, stats: timelineStats(prs) };
}

function staticHighlights(
  dataset: StaticDataset,
  year: number,
): AnnualHighlightsResponse {
  const highlights =
    dataset.highlights[String(year)] ??
    ({
      year,
      generatedAt: dataset.generatedAt,
      prs: [],
    } satisfies AnnualHighlightsResponse);
  return {
    ...highlights,
    prs: withLocalStates(highlights.prs),
  };
}

async function staticApi<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method ?? "GET";
  const dataset = await loadStaticDataset();

  if (method === "PATCH") {
    const match = path.match(/^\/api\/prs\/(\d+)\/state$/);
    if (!match) {
      throw new Error("静态部署只支持更新 PR 阅读状态");
    }
    const id = Number(match[1]);
    const patch = JSON.parse(String(options?.body ?? "{}")) as LocalPrState;
    const states = readLocalStates();
    states[String(id)] = {
      ...(states[String(id)] ?? {}),
      ...patch,
    };
    writeLocalStates(states);
    const pr = findStaticPr(dataset, id);
    if (!pr) {
      throw new Error(`未找到 PR：${id}`);
    }
    return withLocalState(pr) as T;
  }

  if (method !== "GET") {
    throw new Error(
      "静态部署不能直接抓取 GitHub；请由本地任务或 GitHub Action 生成新数据。",
    );
  }

  const url = new URL(path, window.location.origin);
  if (url.pathname === "/api/dashboard") {
    return staticDashboard(
      dataset,
      url.searchParams.get("date") ?? dataset.defaultDate,
    ) as T;
  }
  if (url.pathname === "/api/days") {
    return dataset.days as T;
  }
  if (url.pathname === "/api/timeline") {
    return staticTimeline(
      dataset,
      url.searchParams.get("start") ?? dataset.timeline.start,
      url.searchParams.get("end") ?? dataset.timeline.end,
      Number(url.searchParams.get("limit") ?? 1200),
    ) as T;
  }
  if (url.pathname === "/api/highlights") {
    return staticHighlights(
      dataset,
      Number(url.searchParams.get("year") ?? new Date().getFullYear()),
    ) as T;
  }

  throw new Error(`静态数据未支持此接口：${url.pathname}`);
}

async function serviceApi<T>(path: string, options?: RequestInit): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (options?.method === "PATCH") {
    const id = Number(url.pathname.match(/\/prs\/(\d+)\/state$/)?.[1]);
    const record = serviceRecords.get(id);
    if (!record) throw Error("请先加载这条 PR");
    const states = readLocalStates();
    states[id] = { ...states[id], ...JSON.parse(String(options.body ?? "{}")) };
    writeLocalStates(states);
    return withLocalState(record) as T;
  }
  if (options?.method && options.method !== "GET")
    throw Error("内容采集由服务端执行");
  const route = url.pathname.replace("/api/", "");
  if (route === "days")
    return readService<T>("days", { onStatus: reportContentStatus });
  const read = async (route: string) =>
    readService<any>(route, { onStatus: reportContentStatus });
  let data: any;
  if (route === "timeline") {
    let offset: number | null = 0;
    const prs: PullRequestRecord[] = [];
    do {
      const query = new URLSearchParams(url.search);
      query.set("offset", String(offset));
      const page = await read("timeline?" + query);
      prs.push(...page.prs);
      offset = page.nextOffset;
    } while (offset !== null);
    data = {
      start: url.searchParams.get("start"),
      end: url.searchParams.get("end"),
      prs,
      stats: timelineStats(prs),
    };
  } else data = await read(route + url.search);
  if (Array.isArray(data.prs)) {
    data.prs.forEach((pr: PullRequestRecord) => serviceRecords.set(pr.id, pr));
    data.prs = withLocalStates(data.prs);
    if (route === "dashboard") data.stats = dashboardStats(data.prs);
  }
  return data as T;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  if (SERVICE_MODE) return serviceApi<T>(path, options);
  if (STATIC_MODE) {
    return staticApi<T>(path, options);
  }
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  });
}

function sixMonthsAgoLocal(): string {
  const date = new Date();
  date.setMonth(date.getMonth() - 6);
  return date.toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  });
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statText(pr: PullRequestRecord): string {
  if (pr.changedFiles == null) {
    return "diff ?";
  }
  return `${pr.changedFiles} files  +${pr.additions ?? 0} -${pr.deletions ?? 0}`;
}

function computeStats(prs: PullRequestRecord[]) {
  return {
    total: prs.length,
    unread: prs.filter((pr) => !pr.isRead).length,
    favorites: prs.filter((pr) => pr.isFavorite).length,
    watchLater: prs.filter((pr) => pr.watchLater).length,
  };
}

function ToolbarButton({
  active,
  title,
  children,
  onClick,
}: {
  active?: boolean;
  title: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "iconButton active" : "iconButton"}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DeepDiveView({ analysis }: { analysis: DeepDive }) {
  const [showEvidence, setShowEvidence] = useState(false);
  const citations = (claim: AnalysisClaim) => (
    <span className="analysisCitations">{claim.evidenceIds.map(id => {
      const source = analysis.evidence.find(item => item.id === id);
      return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer" title={source.label}>[{id}]</a> : null;
    })}</span>
  );
  const rows: [string, AnalysisClaim][] = [
    ["问题与触发条件", analysis.problem], ["旧路径", analysis.before],
    ["改动机制", analysis.after], ["代价与边界", analysis.tradeoff], ["验证与效果", analysis.validation],
  ];
  return <div className="deepDive">
    <p className="analysisSummary">{analysis.summary.text} {citations(analysis.summary)}</p>
    <details className="reviewDisclosure">
      <summary>代码深读 · 机制、证据与边界</summary>
      <div className="deepDiveBody">
        {rows.map(([label, claim]) => <section key={label} className="analysisSection">
          <h3>{label}</h3><p>{claim.text} {citations(claim)}</p>
        </section>)}
        <section className="analysisSection">
          <h3>关键代码</h3>
          <pre><code>{analysis.walkthrough.excerpt}</code></pre>
          <p>{analysis.walkthrough.explanation} {citations({text: "", evidenceIds: [analysis.walkthrough.evidenceId]})}</p>
        </section>
        <div className="analysisCoverage">
          <p>已读 {analysis.coverage.filesReviewed}/{analysis.coverage.filesTotal} 个文件 · 代码版本 {analysis.headSha.slice(0, 8)}</p>
          {analysis.coverage.notes.map(note => <p key={note}>{note}</p>)}
          <button className="evidenceToggle" onClick={() => setShowEvidence(!showEvidence)} aria-expanded={showEvidence}>证据目录 {showEvidence ? "−" : "+"}</button>
          {showEvidence && <ul>{analysis.evidence.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">[{source.id}] {source.label}</a></li>)}</ul>}
        </div>
      </div>
    </details>
  </div>;
}

function PrCard({
  pr,
  onPatch,
}: {
  pr: DisplayPullRequest;
  onPatch: (id: number, patch: Partial<PullRequestRecord>) => void;
}) {

  return (
    <article
      className={`${pr.isRead ? "prCard read" : "prCard"} priority-${pr.importance}`}
    >
      <div className="cardTopline">
        <span className="repoPill">{pr.repoDisplayName}</span>
        <span className="prNumber">#{pr.number}</span>
        <span className="categoryPill">{pr.categoryLabel}</span>
      </div>

      <a className="prTitle" href={pr.url} target="_blank" rel="noreferrer">
        {pr.title}
      </a>

      <div className="metaLine">
        <span>{pr.author ?? "unknown"}</span>
        <span>{formatTime(pr.mergedAt)}</span>
        <span>{statText(pr)}</span>
      </div>

      {pr.deepDive ? <DeepDiveView analysis={pr.deepDive} /> : (
        <p className="analysisPending">尚未完成代码分析</p>
      )}

      {pr.labels.length > 0 && (
        <div className="labels">
          {pr.labels.slice(0, 4).map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      )}

      <div className="cardActions">
        <ToolbarButton
          title={pr.isFavorite ? "取消收藏" : "收藏"}
          active={pr.isFavorite}
          onClick={() => onPatch(pr.id, { isFavorite: !pr.isFavorite })}
        >
          <Star size={16} />
        </ToolbarButton>
        <ToolbarButton
          title={pr.isRead ? "标为未读" : "标为已读"}
          active={pr.isRead}
          onClick={() => onPatch(pr.id, { isRead: !pr.isRead })}
        >
          <Check size={16} />
        </ToolbarButton>
        <ToolbarButton
          title={pr.watchLater ? "移出稍后看" : "稍后看"}
          active={pr.watchLater}
          onClick={() => onPatch(pr.id, { watchLater: !pr.watchLater })}
        >
          <Bookmark size={16} />
        </ToolbarButton>
        <a
          className="iconButton"
          title="打开 PR"
          href={pr.url}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={16} />
        </a>
      </div>
    </article>
  );
}

function filterPullRequests(
  prs: DisplayPullRequest[],
  query: string,
  mode: ViewMode,
  category: string,
): DisplayPullRequest[] {
  const q = query.trim().toLowerCase();
  const qWithoutHash = q.startsWith("#") ? q.slice(1) : q;
  return prs.filter((pr) => {
    if (mode === "unread" && pr.isRead) return false;
    if (mode === "favorites" && !pr.isFavorite) return false;
    if (mode === "watch" && !pr.watchLater) return false;
    if (category !== "all" && pr.category !== category) return false;
    if (!q) return true;
    const searchable = [
      String(pr.number),
      `#${pr.number}`,
      pr.title,
      pr.repoFullName,
      pr.repoDisplayName,
      pr.url,
      pr.author,
      pr.categoryLabel,
      ...(pr.labels ?? []),
      pr.learningComment,
      pr.deepDive?.summary.text,
      pr.deepDive?.after.text,
      pr.deepDive?.walkthrough.explanation,
      pr.evaluation?.motivation,
      pr.evaluation?.previousBehavior,
      pr.evaluation?.newBehavior,
      pr.evaluation?.rationale,
      pr.evaluation?.experiments,
      pr.highlightReason,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return (
      searchable.includes(q) ||
      (!!qWithoutHash && searchable.includes(qWithoutHash))
    );
  });
}

function groupByDate(
  prs: DisplayPullRequest[],
): Array<[string, DisplayPullRequest[]]> {
  const grouped = new Map<string, DisplayPullRequest[]>();
  for (const pr of prs) {
    const key = shanghaiDay(pr.mergedAt);
    grouped.set(key, [...(grouped.get(key) ?? []), pr]);
  }
  return Array.from(grouped.entries()).sort(([a], [b]) => b.localeCompare(a));
}

function ChronicleView({
  title,
  caption,
  prs,
  emptyCopy,
  onPatch,
}: {
  title: string;
  caption: string;
  prs: DisplayPullRequest[];
  emptyCopy: string;
  onPatch: (id: number, patch: Partial<PullRequestRecord>) => void;
}) {
  const groups = groupByDate(prs);
  return (
    <section className="chronicle">
      <header className="chronicleHeader">
        <div>
          <h2>{title}</h2>
          <p>{caption}</p>
        </div>
        <span>{prs.length}</span>
      </header>
      {groups.length ? (
        groups.map(([day, items]) => (
          <div className="dateGroup" key={day}>
            <div className="dateMarker">
              <strong>{day}</strong>
              <span>{items.length}</span>
            </div>
            <div className="chronicleGrid">
              {items.map((pr) => (
                <PrCard key={pr.id} pr={pr} onPatch={onPatch} />
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="emptyWide">
          <GitPullRequest size={18} />
          <span>{emptyCopy}</span>
        </div>
      )}
    </section>
  );
}

function EmptyLane() {
  return (
    <div className="emptyLane">
      <GitPullRequest size={18} />
      <span>今日暂无记录</span>
    </div>
  );
}

export function App() {
  const [date, setDate] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("date") ?? todayLocal();
  });
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [highlights, setHighlights] = useState<AnnualHighlightsResponse | null>(
    null,
  );
  const [days, setDays] = useState<SnapshotSummary[]>([]);
  const [visibleTimeline, setVisibleTimeline] = useState(200);
  const [serviceInfo, setServiceInfo] = useState<{
    latestDate: string;
    totalPrs: number;
    analysis?: AnalysisProgress;
  } | null>(null);
  const [staticInfo, setStaticInfo] = useState<StaticDataset | null>(null);
  const [surface, setSurface] = useState<SurfaceMode>("daily");
  const [timelineStart, setTimelineStart] = useState(sixMonthsAgoLocal);
  const [timelineEnd, setTimelineEnd] = useState(todayLocal);
  const [highlightYear, setHighlightYear] = useState(() =>
    Number(todayLocal().slice(0, 4)),
  );
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ViewMode>("all");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latestLoad = useRef(0);

  useEffect(() => {
    if (!dashboard?.snapshot || dashboard.date !== date) return;
    const url = new URL(window.location.href);
    url.searchParams.set("date", date);
    history.replaceState(null, "", url);
  }, [date, dashboard]);

  async function refreshStatic() {
    if (SERVICE_MODE) {
      await load(date);
      return;
    }
    staticDatasetPromise = null;
    dayRequests.clear();
    try {
      const dataset = await loadStaticDataset();
      setStaticInfo(dataset);
      await load(date);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function load(selectedDate = date) {
    const requestId = ++latestLoad.current;
    setLoading(true);
    setError(null);
    try {
      const [dashboardData, dayData] = await Promise.all([
        api<DashboardResponse>(`/api/dashboard?date=${selectedDate}`),
        api<SnapshotSummary[]>("/api/days"),
      ]);
      if (requestId !== latestLoad.current) return;
      setDashboard(dashboardData);
      setDays(dayData);
    } catch (err) {
      if (requestId === latestLoad.current) setError((err as Error).message);
    } finally {
      if (requestId === latestLoad.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (SERVICE_MODE)
      readService<any>("summary", { onStatus: reportContentStatus })
        .then((data) => {
          setServiceInfo(data);
          if (!requestedDate && data.latestDate) setDate(data.latestDate);
        })
        .catch((err) => setError(err.message));
    if (STATIC_MODE)
      loadStaticDataset()
        .then((data) => {
          setStaticInfo(data);
          if (
            !requestedDate &&
            !data.days.some((day) => day.date === todayLocal())
          )
            setDate(data.defaultDate);
        })
        .catch((err) => setError(err.message));
  }, []);
  useEffect(() => {
    setVisibleTimeline(200);
  }, [timelineStart, timelineEnd, query, mode, category]);

  useEffect(() => {
    void load(date);
  }, [date]);

  async function loadTimeline() {
    const data = await api<TimelineResponse>(
      `/api/timeline?start=${timelineStart}&end=${timelineEnd}&limit=8000`,
    );
    setTimeline(data);
  }

  async function loadHighlights() {
    const data = await api<AnnualHighlightsResponse>(
      `/api/highlights?year=${highlightYear}&limit=${ANNUAL_PICK_LIMIT}`,
    );
    setHighlights(data);
  }

  useEffect(() => {
    if (surface === "timeline") {
      loadTimeline().catch((err) => setError((err as Error).message));
    }
  }, [surface, timelineStart, timelineEnd]);

  useEffect(() => {
    if (surface === "picks") {
      loadHighlights().catch((err) => setError((err as Error).message));
    }
  }, [surface, highlightYear]);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    [
      ...(dashboard?.prs ?? []),
      ...(timeline?.prs ?? []),
      ...(highlights?.prs ?? []),
    ].forEach((pr) => map.set(pr.category, pr.categoryLabel));
    return Array.from(map.entries());
  }, [dashboard, timeline, highlights]);

  const boardFiltered = useMemo(
    () => filterPullRequests(dashboard?.prs ?? [], query, mode, category),
    [dashboard, mode, category, query],
  );
  const timelineFiltered = useMemo(
    () => filterPullRequests(timeline?.prs ?? [], query, mode, category),
    [timeline, mode, category, query],
  );
  const highlightsFiltered = useMemo(
    () => filterPullRequests(highlights?.prs ?? [], query, mode, category),
    [highlights, mode, category, query],
  );
  const learningPicks = useMemo(() => dailyLearningPicks(dashboard?.prs ?? []), [dashboard]);
  const learningFiltered = useMemo(() => filterPullRequests(learningPicks, query, mode, category), [learningPicks, query, mode, category]);
  const activePrs =
    surface === "daily" ? learningPicks : surface === "timeline"
      ? (timeline?.prs ?? [])
      : surface === "picks"
        ? (highlights?.prs ?? [])
        : (dashboard?.prs ?? []);
  const activeFiltered =
    surface === "daily" ? learningFiltered : surface === "timeline"
      ? timelineFiltered
      : surface === "picks"
        ? highlightsFiltered
        : boardFiltered;

  const liveStats = useMemo(() => computeStats(activePrs), [activePrs]);

  async function fetchDate() {
    setFetching(true);
    setError(null);
    try {
      const result = await api<{ prCount: number; warnings: string[] }>(
        "/api/fetch",
        {
          method: "POST",
          body: JSON.stringify({ date, notify: true }),
        },
      );
      setNotice(
        `已归档 ${result.prCount} 个 PR${result.warnings.length ? "，部分仓库有警告" : ""}`,
      );
      await load(date);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFetching(false);
    }
  }

  async function fetchHalfYear() {
    setBackfilling(true);
    setError(null);
    try {
      const result = await api<FetchRangeResponse>("/api/fetch-range", {
        method: "POST",
        body: JSON.stringify({
          start: timelineStart,
          end: timelineEnd,
          notify: true,
        }),
      });
      setNotice(
        `已补档 ${result.start} 到 ${result.end}：${result.dayCount} 天 / ${result.prCount} 条归档${result.warnings.length ? "，部分仓库有警告" : ""}`,
      );
      await Promise.all([load(date), loadTimeline(), loadHighlights()]);
      setSurface("timeline");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBackfilling(false);
    }
  }

  async function patchPr(id: number, patch: Partial<PullRequestRecord>) {
    const previousDashboard = dashboard;
    const previousTimeline = timeline;
    const previousHighlights = highlights;
    const patchList = <T extends PullRequestRecord>(
      prs: T[] | undefined,
    ): T[] | undefined =>
      prs?.map((pr) => (pr.id === id ? ({ ...pr, ...patch } as T) : pr));

    setDashboard((current) =>
      current
        ? { ...current, prs: patchList(current.prs) ?? current.prs }
        : current,
    );
    setTimeline((current) =>
      current
        ? { ...current, prs: patchList(current.prs) ?? current.prs }
        : current,
    );
    setHighlights((current) =>
      current
        ? { ...current, prs: patchList(current.prs) ?? current.prs }
        : current,
    );

    try {
      const updated = await api<PullRequestRecord>(`/api/prs/${id}/state`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setDashboard((current) =>
        current
          ? {
              ...current,
              prs: current.prs.map((pr) => (pr.id === id ? updated : pr)),
            }
          : current,
      );
      setTimeline((current) =>
        current
          ? {
              ...current,
              prs: current.prs.map((pr) => (pr.id === id ? updated : pr)),
            }
          : current,
      );
      setHighlights((current) =>
        current
          ? {
              ...current,
              prs: current.prs.map((pr) =>
                pr.id === id
                  ? {
                      ...pr,
                      ...updated,
                    }
                  : pr,
              ),
            }
          : current,
      );
    } catch (err) {
      setDashboard(previousDashboard);
      setTimeline(previousTimeline);
      setHighlights(previousHighlights);
      setError((err as Error).message);
    }
  }

  async function testNotification() {
    if (STATIC_MODE) {
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("AI Infra Daily", {
          body: "浏览器通知测试已发送。",
        });
      }
      setNotice(
        "静态站点只能发送浏览器通知，定时桌面通知由本地任务或 GitHub Action 负责",
      );
      return;
    }
    await api("/api/notify/test", { method: "POST", body: "{}" });
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    setNotice("通知测试已发送");
  }

  const snapshot = dashboard?.snapshot;

  return (
    <main className="shell">
      <section className="topBand">
        <div className="brandBlock">
          <div className="mark">
            <TerminalSquare size={24} />
          </div>
          <div>
            <p className="eyebrow">AI INFRA DAILY</p>
            <h1>PR Radar</h1>
          </div>
        </div>

        <div className="controls">
          <input
            className="dateInput"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          {!READER_MODE && (
            <>
              <button
                className="commandButton"
                onClick={fetchDate}
                disabled={fetching}
              >
                {fetching ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <RefreshCw size={16} />
                )}
                <span>更新</span>
              </button>
              <button
                className="commandButton"
                onClick={fetchHalfYear}
                disabled={backfilling}
              >
                {backfilling ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <RefreshCw size={16} />
                )}
                <span>半年</span>
              </button>
            </>
          )}
          {READER_MODE ? (
            <button
              className="iconButton"
              title="刷新日报"
              aria-label="刷新日报"
              onClick={refreshStatic}
              disabled={loading}
            >
              <RefreshCw size={17} />
            </button>
          ) : (
            <button
              className="iconButton"
              title="测试桌面通知"
              onClick={testNotification}
            >
              <Bell size={17} />
            </button>
          )}
        </div>
      </section>

      {serviceInfo && (
        <div className="toast">
          服务数据截至 {serviceInfo.latestDate} ·{" "}
          {serviceInfo.totalPrs.toLocaleString()} 条归档。日报由服务端持续更新。
        </div>
      )}
      {staticInfo && (
        <div className="toast">
          数据截至 {staticInfo.defaultDate} · 导出于{" "}
          {formatTime(staticInfo.generatedAt)} ·{" "}
          {staticInfo.timeline.stats.total.toLocaleString()}{" "}
          条归档。分析基于 PR diff 与源码；每篇附实际覆盖范围和证据。
          {staticInfo.defaultDate < todayLocal() &&
            " 当前为历史快照，等待后台更新。"}
        </div>
      )}
      <section className="statusBand">
        <div className="stat">
          <span>{liveStats.total}</span>
          <small>merged prs</small>
        </div>
        <div className="stat">
          <span>{liveStats.unread}</span>
          <small>unread</small>
        </div>
        <div className="stat">
          <span>{liveStats.favorites}</span>
          <small>starred</small>
        </div>
        <div className="stat">
          <span>{liveStats.watchLater}</span>
          <small>later</small>
        </div>
        <div className="snapshot">
          <strong>
            {surface === "timeline"
              ? `${timelineStart} - ${timelineEnd}`
              : surface === "picks"
                ? `${highlightYear} picks`
                : snapshot
                  ? formatTime(snapshot.fetchedAt)
                  : "not fetched"}
          </strong>
          <span>
            {surface === "board"
              ? (snapshot?.status ?? "empty snapshot")
              : surface}
          </span>
        </div>
      </section>

      <section className="viewTabs">
        {[
          ["daily", "今日深读"],
          ["board", "全部归档"],
          ["timeline", "时间线"],
          ["picks", "年度精选"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={surface === value ? "selected" : ""}
            onClick={() => setSurface(value as SurfaceMode)}
          >
            {label}
          </button>
        ))}
        <div className="rangeControls">
          {surface === "timeline" ? (
            <>
              <input
                type="date"
                value={timelineStart}
                onChange={(event) => setTimelineStart(event.target.value)}
              />
              <input
                type="date"
                value={timelineEnd}
                onChange={(event) => setTimelineEnd(event.target.value)}
              />
            </>
          ) : surface === "picks" ? (
            <input
              type="number"
              min="2008"
              max="2100"
              value={highlightYear}
              onChange={(event) => setHighlightYear(Number(event.target.value))}
            />
          ) : null}
        </div>
      </section>

      <section className="filterBand">
        <div className="searchBox">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 #4401 / PR 号 / repo / 标题 / 解读"
          />
          {query.trim() && (
            <span className="searchCount">{activeFiltered.length}</span>
          )}
        </div>

        <div className="segmented">
          {[
            ["all", "全部"],
            ["unread", "未读"],
            ["favorites", "收藏"],
            ["watch", "稍后"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={mode === value ? "selected" : ""}
              onClick={() => setMode(value as ViewMode)}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="all">全部分类</option>
          {categories.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </section>

      {days.length > 0 && (
        <section className="archiveRail">
          {days.slice(0, 14).map((day) => (
            <button
              key={day.date}
              className={day.date === date ? "archiveDay active" : "archiveDay"}
              onClick={() => setDate(day.date)}
            >
              <span>{day.date.slice(5)}</span>
              <small>{day.prCount}</small>
            </button>
          ))}
        </section>
      )}

      {error && <div className="toast error">{error}</div>}
      {notice && <div className="toast">{notice}</div>}
      {loading && <div className="loadingLine">加载看板中...</div>}

      {surface === "daily" && (
        <section className="dailyLearning">
          <header className="learningHeading">
            <h2>今天值得学透的 {learningPicks.length} 个改动</h2>
            <p>每天最多 3 篇，聚焦架构与性能机制。同一主题合并筛选，未达标准就留空。</p>
            <p>{dashboard?.prs.length ?? 0} 条归档 · {dashboard?.prs.filter(pr => !!pr.deepDive?.focus).length ?? 0} 条已完成深读评估</p>
          </header>
          <div className="learningStack">
            {learningFiltered.map(pr => <PrCard key={pr.id} pr={pr} onPatch={patchPr} />)}
            {!learningFiltered.length && <div className="emptyWide"><span>{loading ? "正在加载…" : learningPicks.length ? "没有符合当前筛选的深读" : "本期暂无已确认的深读重点；全部 PR 仍可在归档中查看。"}</span></div>}
          </div>
        </section>
      )}
      {serviceInfo?.analysis && <details className="archiveProgress">
        <summary>全量分析进度：{serviceInfo.analysis.completed.toLocaleString()} / {serviceInfo.analysis.total.toLocaleString()}</summary>
        <p>待处理 {serviceInfo.analysis.pending.toLocaleString()} · 处理中 {serviceInfo.analysis.processing} · 待重试 {serviceInfo.analysis.retrying} · 需复核 {serviceInfo.analysis.needsReview}</p>
      </details>}

      {surface === "board" && (
        <section className="board">
          {importanceOrder.map((level) => {
            const lane = boardFiltered.filter((pr) => pr.importance === level);
            return (
              <div className={`lane lane-${level}`} key={level}>
                <header className="laneHeader">
                  <div>
                    <h2>{laneCopy[level].title}</h2>
                    <p>{laneCopy[level].caption}</p>
                  </div>
                  <span>{lane.length}</span>
                </header>
                <div className="laneStack">
                  {lane.length ? (
                    lane.map((pr) => (
                      <PrCard key={pr.id} pr={pr} onPatch={patchPr} />
                    ))
                  ) : (
                    <EmptyLane />
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {surface === "timeline" && (
        <ChronicleView
          title="半年度时间线"
          caption={`${timeline?.start ?? timelineStart} 到 ${timeline?.end ?? timelineEnd}，按合并时间倒序；筛选结果 ${timelineFiltered.length} 条`}
          prs={timelineFiltered.slice(0, visibleTimeline)}
          emptyCopy="半年度时间线还没有归档记录"
          onPatch={patchPr}
        />
      )}

      {surface === "timeline" && timelineFiltered.length > visibleTimeline && (
        <button
          className="commandButton"
          onClick={() => setVisibleTimeline((value) => value + 200)}
        >
          已显示 {visibleTimeline} / {timelineFiltered.length}，加载更多
        </button>
      )}
      {surface === "picks" && (
        <ChronicleView
          title="年度精选"
          caption={`${highlights?.year ?? highlightYear} Top ${ANNUAL_PICK_LIMIT}，按合并时间倒序`}
          prs={highlightsFiltered}
          emptyCopy="年度精选还没有足够归档记录"
          onPatch={patchPr}
        />
      )}
    </main>
  );
}
