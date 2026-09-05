import { FetchDigestResponse, FetchRangeResponse } from "../shared/types";
import { DEFAULT_REPOSITORIES } from "./config";
import {
  backfillPullRequestEvaluations,
  getTopPullRequestsForDate,
  listRepositories,
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
  const backfilled = await backfillPullRequestEvaluations();
  if (backfilled > 0) {
    console.log(`[db] backfilled structured evaluations for ${backfilled} PRs`);
  }
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
  const result = await saveFetchedPullRequests(date, allRepositories, pullRequests, warnings);

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
    const result = await saveFetchedPullRequests(date, allRepositories, grouped.get(date) ?? [], warnings);
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
