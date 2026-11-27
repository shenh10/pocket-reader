// Bundled by scripts/build-edge.mjs for the Supabase Edge runtime.
import { createPushHandler } from "./push-api";
import { pushStore } from "./push-store";
import { createReaderHandler } from "./public-api";
import { createTopicsStore } from "./topics-store";
import {
  getDashboard,
  getTimeline,
  getAnnualHighlights,
  listSnapshots,
  getAnalysisProgress,
  pool,
} from "./db";
declare const Deno: {
  env: {get(name:string):string|undefined};
  serve(handler: (request: Request) => Promise<Response>): void;
};
const reader = createReaderHandler({
    ...createTopicsStore(pool),
    analysisProgress: getAnalysisProgress,
    days: () => listSnapshots(10000),
    dashboard: (date) => getDashboard(date, true),
    timeline: (start, end, limit, offset) =>
      getTimeline(start, end, limit, offset, true),
    highlights: (year, limit) => getAnnualHighlights(year, limit, true),
  });
const push = createPushHandler(pushStore, () => (Deno.env.get("POCKET_PUSH_PROVIDERS") || "").split(",").filter(Boolean));
Deno.serve(request => new URL(request.url).pathname.includes("/v1/push/") ? push(request) : reader(request));
