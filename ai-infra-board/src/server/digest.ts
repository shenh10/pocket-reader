import { FetchDigestResponse, FetchRangeResponse } from "../shared/types";
import { DEFAULT_REPOSITORIES } from "./config";
import {
  getTopPullRequestsForDate,
  listRepositories,
  latestSuccessfulSnapshotDate,
  runMigrations,
  saveFetchedPullRequests,
  seedRepositories
} from "./db";
import { enumerateDates, localDateForTimestamp, normalizeDateInput, recentHalfYearRange } from "./date";
import { fetchMergedPullRequestsForDate, fetchMergedPullRequestsForRange } from "./github";
import { notifyDigestReady } from "./notifications";

export async function bootstrapDatabase(): Promise<void> {
  await runMigrations();
  await seedRepositories(DEFAULT_REPOSITORIES);
}

export async function runDailyDigest(options: {
  date?: string;
  notify?: boolean;
  repoFilters?: string[];
} = {}): Promise<FetchDigestResponse> {
  const date = normalizeDateInput(options.date);
  const allRepositories = await listRepositories(true);
  const repositories = filterRepositories(allRepositories, options.repoFilters);
  const { pullRequests, warnings } = await fetchMergedPullRequestsForDate(date, repositories);
  if (warnings.length) throw new Error(`Incomplete GitHub fetch: ${warnings.join("; ")}`);
  const result = await saveFetchedPullRequests(date, repositories, pullRequests, warnings);

  if (options.notify) {
    const top = await getTopPullRequestsForDate(date);
    notifyDigestReady(date, result.prCount, top);
  }

  return result;
}

export async function runRangeDigest(options: {
  start?: string;
  end?: string;
  notify?: boolean;
  repoFilters?: string[];
} = {}): Promise<FetchRangeResponse> {
  const defaultRange = recentHalfYearRange();
  const start = normalizeDateInput(options.start ?? defaultRange.start);
  const end = normalizeDateInput(options.end ?? defaultRange.end);
  const dates = enumerateDates(start, end);
  const allRepositories = await listRepositories(true);
  const repositories = filterRepositories(allRepositories, options.repoFilters);
  const { pullRequests, warnings } = await fetchMergedPullRequestsForRange(start, end, repositories);
  if (warnings.length) throw new Error(`Incomplete GitHub fetch: ${warnings.join("; ")}`);
  const grouped = new Map<string, typeof pullRequests>();

  for (const date of dates) {
    grouped.set(date, []);
  }
  for (const pr of pullRequests) {
    const mergedDate = localDateForTimestamp(pr.mergedAt);
    if (grouped.has(mergedDate)) {
      grouped.get(mergedDate)!.push(pr);
    }
  }

  let archivedTotal = 0;
  for (const date of dates) {
    const result = await saveFetchedPullRequests(date, repositories, grouped.get(date) ?? [], warnings);
    archivedTotal += result.prCount;
  }

  if (options.notify) {
    notifyDigestReady(end, archivedTotal, await getTopPullRequestsForDate(end));
  }

  return {
    start,
    end,
    repoCount: allRepositories.length,
    prCount: archivedTotal,
    dayCount: dates.length,
    fetchedAt: new Date().toISOString(),
    warnings
  };
}

export async function runCatchUpDigest(options: {notify?: boolean} = {}): Promise<FetchRangeResponse> {
  const latest = await latestSuccessfulSnapshotDate();
  const yesterday = normalizeDateInput("yesterday");
  // Revisit the latest snapshot after an outage and always overlap yesterday's full day.
  const start = latest ? (latest < yesterday ? latest : yesterday) : recentHalfYearRange().start;
  return runRangeDigest({start, end: normalizeDateInput("today"), notify: options.notify});
}

function filterRepositories<T extends { fullName: string; displayName: string }>(
  repositories: T[],
  filters?: string[]
): T[] {
  if (!filters?.length) {
    return repositories;
  }
  const normalized = new Set(filters.map((filter) => filter.trim().toLowerCase()).filter(Boolean));
  const selected = repositories.filter(
    (repo) =>
      normalized.has(repo.fullName.toLowerCase()) ||
      normalized.has(repo.displayName.toLowerCase()) ||
      normalized.has(repo.fullName.split("/")[1]?.toLowerCase() ?? "")
  );
  if (!selected.length) {
    throw new Error(`No repositories matched --repo ${filters.join(", ")}`);
  }
  console.log(`[digest] repo filter: ${selected.map((repo) => repo.fullName).join(", ")}`);
  return selected;
}
