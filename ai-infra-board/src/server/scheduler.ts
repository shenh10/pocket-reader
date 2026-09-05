import cron from "node-cron";
import { APP_TIMEZONE } from "./config";
import { runDailyDigest } from "./digest";

export function startScheduler(): void {
  if (process.env.ENABLE_SCHEDULER === "false") {
    console.log("[scheduler] disabled");
    return;
  }
  const expression = process.env.DAILY_FETCH_CRON || "10 9 * * *";
  if (!cron.validate(expression)) {
    console.warn(`[scheduler] invalid DAILY_FETCH_CRON: ${expression}`);
    return;
  }

  cron.schedule(
    expression,
    async () => {
      try {
        const result = await runDailyDigest({ notify: true });
        console.log(`[scheduler] fetched ${result.prCount} PRs for ${result.date}`);
      } catch (error) {
        console.error("[scheduler] daily fetch failed:", error);
      }
    },
    { timezone: APP_TIMEZONE }
  );
  console.log(`[scheduler] ${expression} (${APP_TIMEZONE})`);
}
