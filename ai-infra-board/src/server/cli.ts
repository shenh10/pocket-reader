import dotenv from "dotenv";
import { backfillPullRequestEvaluations, checkDatabaseConnection, exportStaticDataset, pool } from "./db";
import { bootstrapDatabase, runDailyDigest, runRangeDigest } from "./digest";
import { sendDesktopNotification } from "./notifications";

dotenv.config();

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function readArgs(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "db-check") {
    const result = await checkDatabaseConnection();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  await bootstrapDatabase();

  if (command === "db-setup") {
    const result = await checkDatabaseConnection();
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "fetch") {
    const date = readArg("--date") ?? process.argv[3];
    const notify = process.argv.includes("--notify");
    const repoFilters = readArgs("--repo");
    const result = await runDailyDigest({ date, notify, repoFilters });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "fetch-range") {
    const start = readArg("--start");
    const end = readArg("--end");
    const notify = process.argv.includes("--notify");
    const repoFilters = readArgs("--repo");
    const result = await runRangeDigest({ start, end, notify, repoFilters });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "notify-test") {
    sendDesktopNotification({
      title: "AI Infra Merge Board",
      message: "Notification test from the local digest backend.",
      open: process.env.APP_URL ?? "http://localhost:5173"
    });
    console.log("Notification sent.");
    return;
  }

  if (command === "reanalyze") {
    const count = await backfillPullRequestEvaluations({ force: true });
    console.log(JSON.stringify({ reanalyzed: count }, null, 2));
    return;
  }

  if (command === "export-static") {
    const outDir = readArg("--out") ?? "public/data";
    const start = readArg("--start");
    const end = readArg("--end");
    const yearArg = readArg("--year");
    const year = yearArg ? Number(yearArg) : undefined;
    const result = await exportStaticDataset({ outDir, start, end, year });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Usage: tsx src/server/cli.ts fetch [--date YYYY-MM-DD|today|yesterday] [--repo owner/name] [--notify]");
  console.log("       tsx src/server/cli.ts fetch-range [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--repo owner/name] [--notify]");
  console.log("       tsx src/server/cli.ts reanalyze");
  console.log("       tsx src/server/cli.ts export-static [--out public/data] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--year YYYY]");
  console.log("       tsx src/server/cli.ts db-check");
  console.log("       tsx src/server/cli.ts db-setup");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
