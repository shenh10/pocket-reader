// Bundled by scripts/build-edge.mjs for the Supabase Edge runtime.
import { createReaderHandler } from "./public-api";
import {
  getDashboard,
  getTimeline,
  getAnnualHighlights,
  listSnapshots,
} from "./db";
declare const Deno: {
  serve(handler: (request: Request) => Promise<Response>): void;
};
Deno.serve(
  createReaderHandler({
    days: () => listSnapshots(10000),
    dashboard: (date) => getDashboard(date, true),
    timeline: (start, end, limit, offset) =>
      getTimeline(start, end, limit, offset),
    highlights: (year, limit) => getAnnualHighlights(year, limit, true),
  }),
);
