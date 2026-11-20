// Bundled by scripts/build-edge.mjs for the Supabase Edge runtime.
import { createPushHandler } from "./push-api";
import { pushStore } from "./push-store";
import { createReaderHandler } from "./public-api";
import {
  getDashboard,
  getTimeline,
  getAnnualHighlights,
  listSnapshots,
} from "./db";
declare const Deno: {
  env: {get(name:string):string|undefined};
  serve(handler: (request: Request) => Promise<Response>): void;
};
const reader = createReaderHandler({
    days: () => listSnapshots(10000),
    dashboard: (date) => getDashboard(date, true),
    timeline: (start, end, limit, offset) =>
      getTimeline(start, end, limit, offset, true),
    highlights: (year, limit) => getAnnualHighlights(year, limit, true),
  });
const push = createPushHandler(pushStore, () => (Deno.env.get("POCKET_PUSH_PROVIDERS") || "").split(",").filter(Boolean));
Deno.serve(request => new URL(request.url).pathname.includes("/v1/push/") ? push(request) : reader(request));
