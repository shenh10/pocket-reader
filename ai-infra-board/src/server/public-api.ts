import type {
  DashboardResponse,
  TimelineResponse,
  AnnualHighlightsResponse,
  SnapshotSummary,
  PullRequestRecord,
  AnalysisProgress,
} from "../shared/types";
export interface ReaderStore {
  analysisProgress?(): Promise<AnalysisProgress>;
  days(): Promise<SnapshotSummary[]>;
  dashboard(date: string): Promise<DashboardResponse>;
  timeline(
    start: string,
    end: string,
    limit: number,
    offset: number,
  ): Promise<TimelineResponse>;
  highlights(year: number, limit: number): Promise<AnnualHighlightsResponse>;
}
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function date(value: string | null) {
  if (
    !value ||
    !datePattern.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw Error("invalid date");
  return value;
}
function integer(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  const n = value === null ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw Error("invalid number");
  return n;
}
function publicPr<T extends PullRequestRecord>(pr: T): T {
  return {
    ...pr,
    body: null,
    isFavorite: false,
    isRead: false,
    watchLater: false,
    userNote: "",
  };
}
function publicDay(day: SnapshotSummary): SnapshotSummary {
  return { ...day, error: null };
}
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "public, max-age=60",
  "X-Content-Type-Options": "nosniff",
};
export function createReaderHandler(store: ReaderStore) {
  return async (request: Request): Promise<Response> => {
    const reply = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: {
          ...headers,
          ...(status >= 400 ? { "Cache-Control": "no-store" } : {}),
        },
      });
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "GET")
      return reply({ error: "Method not allowed" }, 405);
    const url = new URL(request.url),
      route = url.pathname.slice(url.pathname.lastIndexOf("/v1/") + 4),
      params = url.searchParams;
    try {
      if (route === "health") return reply({ ok: true, version: 1 });
      if (route === "analysis-progress" && store.analysisProgress) return reply(await store.analysisProgress());
      if (route === "summary" || route === "days") {
        const days = (await store.days()).map(publicDay);
        if (route === "days") return reply(days);
        const latest = days.find((day) => day.status === "ok") ?? days[0];
        return reply({
          latestDate: latest?.date ?? null,
          latest: latest ?? null,
          totalDays: days.length,
          totalPrs: days.reduce((n, d) => n + d.prCount, 0),
          ...(store.analysisProgress ? {analysis: await store.analysisProgress()} : {}),
        });
      }
      if (route === "dashboard") {
        let selected: string;
        try {
          selected = date(params.get("date"));
        } catch {
          return reply({ error: "date must be YYYY-MM-DD" }, 400);
        }
        const data = await store.dashboard(selected),
          prs = data.prs.map(publicPr);
        return reply({
          ...data,
          prs,
          snapshot: data.snapshot ? publicDay(data.snapshot) : null,
          stats: {
            ...data.stats,
            unread: prs.length,
            favorites: 0,
            watchLater: 0,
          },
        });
      }
      if (route === "timeline") {
        let start: string, end: string, offset: number;
        try {
          start = date(params.get("start"));
          end = date(params.get("end"));
          offset = integer(params.get("offset"), 0, 0, 1000000);
          if (
            start > end ||
            Date.parse(end) - Date.parse(start) > 366 * 86400000
          )
            throw Error("range");
        } catch {
          return reply(
            {
              error:
                "Use a valid date range of at most 367 days and a nonnegative offset",
            },
            400,
          );
        }
        const limit = 500,
          data = await store.timeline(start, end, limit, offset);
        return reply({
          ...data,
          prs: data.prs.map(publicPr),
          nextOffset: data.prs.length === limit ? offset + limit : null,
        });
      }
      if (route === "highlights") {
        let year: number, limit: number;
        try {
          year = integer(
            params.get("year"),
            new Date().getUTCFullYear(),
            2000,
            2100,
          );
          limit = integer(params.get("limit"), 12, 1, 100);
        } catch {
          return reply({ error: "Invalid year or limit" }, 400);
        }
        const data = await store.highlights(year, limit);
        return reply({ ...data, prs: data.prs.map(publicPr) });
      }
      return reply({ error: "Not found" }, 404);
    } catch (error) {
      console.error(
        "[reader-api]",
        error instanceof Error ? error.name : "DatabaseError",
      );
      return reply({ error: "日报服务暂时不可用，请稍后重试。" }, 503);
    }
  };
}
