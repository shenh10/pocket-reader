import { fetchMergedSearch } from "./github-search";
import { execFileSync } from "node:child_process";
import {
  CategoryKey,
  ImportanceLevel,
  PullRequestEvaluation,
  RepositoryRecord
} from "../shared/types";
import { dateRangeWindowUTC, dayWindowUTC } from "./date";
import { analyzePullRequest, PullRequestFileSummary } from "./intelligence";

export interface FetchedPullRequest {
  repoFullName: string;
  number: number;
  githubId: number | null;
  title: string;
  body: string | null;
  url: string;
  apiUrl: string;
  author: string | null;
  authorAvatarUrl: string | null;
  mergedAt: string;
  createdAt: string | null;
  updatedAt: string | null;
  baseRef: string | null;
  headRef: string | null;
  mergeCommitSha: string | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  labels: string[];
  files?: PullRequestFileSummary[];
  category: CategoryKey;
  importance: ImportanceLevel;
  importanceReason: string;
  learningComment: string;
  evaluation: PullRequestEvaluation;
  raw: unknown;
}

interface GitHubPull {
  id?: number;
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  url: string;
  user?: {
    login?: string;
    avatar_url?: string;
  } | null;
  labels?: Array<{ name?: string }>;
  merged_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  base?: { ref?: string } | null;
  head?: { ref?: string } | null;
  merge_commit_sha?: string | null;
  additions?: number | null;
  deletions?: number | null;
  changed_files?: number | null;
}

interface GitHubPullFile {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
}

interface FetchOptions {
  githubToken?: string;
  maxPages?: number;
}

function resolveGithubToken(explicitToken?: string): string | undefined {
  if (explicitToken || process.env.GITHUB_TOKEN) {
    return explicitToken ?? process.env.GITHUB_TOKEN;
  }
  try {
    execFileSync("gh", ["auth", "status", "-h", "github.com"], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 3000
    });
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000
    }).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

async function fetchJson<T>(url: string, token?: string): Promise<T> {
  const timeoutMs = Number(process.env.GITHUB_REQUEST_TIMEOUT_MS ?? 20000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub ${response.status} for ${url}: ${body.slice(0, 240)}`);
    }
    return response.json() as Promise<T>;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`GitHub request timed out after ${timeoutMs}ms for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function labelsFromPull(pr: GitHubPull): string[] {
  return (pr.labels ?? [])
    .map((label) => label.name)
    .filter((label): label is string => Boolean(label));
}

function isWithinWindow(dateString: string | null | undefined, start: Date, end: Date): boolean {
  if (!dateString) {
    return false;
  }
  const date = new Date(dateString);
  return date >= start && date < end;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function enrichPull(pr: GitHubPull, token?: string): Promise<GitHubPull> {
  try {
    return await fetchJson<GitHubPull>(pr.url, token);
  } catch {
    return pr;
  }
}

async function fetchPullFiles(repoFullName: string, number: number, token?: string): Promise<PullRequestFileSummary[]> {
  const files: PullRequestFileSummary[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const url = new URL(`https://api.github.com/repos/${repoFullName}/pulls/${number}/files`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const pageItems = await fetchJson<GitHubPullFile[]>(url.toString(), token);
    files.push(
      ...pageItems.map((file) => ({
        path: file.filename,
        additions: file.additions ?? null,
        deletions: file.deletions ?? null,
        changeType: file.status ?? null
      }))
    );
    if (pageItems.length < 100) {
      break;
    }
  }
  return files;
}

export async function fetchMergedPullRequestsForDate(
  date: string,
  repositories: RepositoryRecord[],
  options: FetchOptions = {}
): Promise<{ pullRequests: FetchedPullRequest[]; warnings: string[] }> {
  const { start, end } = dayWindowUTC(date);
  return fetchMergedPullRequestsBetween(start, end, repositories, options);
}

export async function fetchMergedPullRequestsForRange(
  startDate: string,
  endDate: string,
  repositories: RepositoryRecord[],
  options: FetchOptions = {}
): Promise<{ pullRequests: FetchedPullRequest[]; warnings: string[] }> {
  const { start, end } = dateRangeWindowUTC(startDate, endDate);
  return fetchMergedPullRequestsBetween(start, end, repositories, {
    maxPages: Number(process.env.GITHUB_MAX_PAGES_RANGE ?? options.maxPages ?? 30),
    githubToken: options.githubToken
  });
}

async function fetchMergedPullRequestsBetween(
  start: Date,
  end: Date,
  repositories: RepositoryRecord[],
  options: FetchOptions = {}
): Promise<{ pullRequests: FetchedPullRequest[]; warnings: string[] }> {
  const token = resolveGithubToken(options.githubToken);
  if (token) return fetchMergedSearch(start, end, repositories, token);
  const maxPages = options.maxPages ?? Number(process.env.GITHUB_MAX_PAGES ?? 4);
  const enrichConcurrency = Math.max(1, Number(process.env.GITHUB_ENRICH_CONCURRENCY ?? 6));
  const pullRequests: FetchedPullRequest[] = [];
  const warnings: string[] = [];

  for (const repo of repositories) {
    const candidates: GitHubPull[] = [];
    try {
      console.log(`[github] ${repo.fullName}: scanning closed PRs`);
      for (let page = 1; page <= maxPages; page += 1) {
        const url = new URL(`https://api.github.com/repos/${repo.fullName}/pulls`);
        url.searchParams.set("state", "closed");
        url.searchParams.set("sort", "updated");
        url.searchParams.set("direction", "desc");
        url.searchParams.set("per_page", "100");
        url.searchParams.set("page", String(page));
        const pageItems = await fetchJson<GitHubPull[]>(url.toString(), token);
        candidates.push(...pageItems.filter((item) => isWithinWindow(item.merged_at, start, end)));

        const oldestUpdated = pageItems
          .map((item) => (item.updated_at ? new Date(item.updated_at).getTime() : Date.now()))
          .sort((a, b) => a - b)[0];
        if (pageItems.length < 100 || oldestUpdated < start.getTime() - 24 * 60 * 60 * 1000) {
          break;
        }
        if (page === maxPages) {
          warnings.push(`${repo.fullName}: reached max page limit (${maxPages}); add GITHUB_TOKEN or raise GITHUB_MAX_PAGES_RANGE for deeper history.`);
        }
      }
      console.log(`[github] ${repo.fullName}: ${candidates.length} merged PR candidates`);
    } catch (error) {
      warnings.push(`${repo.fullName}: ${(error as Error).message}`);
      console.warn(`[github] ${repo.fullName}: ${(error as Error).message}`);
      continue;
    }

    let enrichedCount = 0;
    const enrichedPullRequests = await mapWithConcurrency(candidates, enrichConcurrency, async (candidate) => {
      const detailed = await enrichPull(candidate, token);
      const labels = labelsFromPull(detailed);
      const files = await fetchPullFiles(repo.fullName, detailed.number, token).catch(() => []);
      const analysis = analyzePullRequest(
        {
          title: detailed.title,
          body: detailed.body,
          labels,
          additions: detailed.additions ?? null,
          deletions: detailed.deletions ?? null,
          changedFiles: detailed.changed_files ?? null,
          files
        },
        repo
      );

      enrichedCount += 1;
      if (enrichedCount % 25 === 0 || enrichedCount === candidates.length) {
        console.log(`[github] ${repo.fullName}: enriched ${enrichedCount}/${candidates.length}`);
      }

      return {
        repoFullName: repo.fullName,
        number: detailed.number,
        githubId: detailed.id ?? null,
        title: detailed.title,
        body: detailed.body ?? null,
        url: detailed.html_url,
        apiUrl: detailed.url,
        author: detailed.user?.login ?? null,
        authorAvatarUrl: detailed.user?.avatar_url ?? null,
        mergedAt: detailed.merged_at ?? candidate.merged_at ?? new Date().toISOString(),
        createdAt: detailed.created_at ?? null,
        updatedAt: detailed.updated_at ?? null,
        baseRef: detailed.base?.ref ?? null,
        headRef: detailed.head?.ref ?? null,
        mergeCommitSha: detailed.merge_commit_sha ?? null,
        additions: detailed.additions ?? null,
        deletions: detailed.deletions ?? null,
        changedFiles: detailed.changed_files ?? null,
        labels,
        files,
        category: analysis.category,
        importance: analysis.importance,
        importanceReason: analysis.importanceReason,
        learningComment: analysis.learningComment,
        evaluation: analysis.evaluation,
        raw: { ...detailed, files }
      } satisfies FetchedPullRequest;
    });
    pullRequests.push(...enrichedPullRequests);
  }

  pullRequests.sort((a, b) => {
    if (a.importance !== b.importance) {
      return b.importance - a.importance;
    }
    return new Date(b.mergedAt).getTime() - new Date(a.mergedAt).getTime();
  });

  return { pullRequests, warnings };
}
