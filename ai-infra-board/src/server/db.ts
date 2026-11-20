import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import {
  AnnualHighlightRecord,
  AnnualHighlightsResponse,
  DashboardResponse,
  FetchDigestResponse,
  PullRequestRecord,
  RepositoryConfig,
  RepositoryRecord,
  SnapshotSummary,
  StaticDataset,
  TimelineResponse
} from "../shared/types";
import { CATEGORY_LABELS, IMPORTANCE_LABELS, splitFullName } from "./config";
import { recentHalfYearRange, toDateOnly, toISO, todayISODate } from "./date";
import { FetchedPullRequest } from "./github";
import { analyzePullRequest, PullRequestFileSummary } from "./intelligence";

const databaseUrl =
  process.env.DATABASE_URL || "postgres://aiinfra:aiinfra@localhost:54329/ai_infra_board";

function shouldUseSsl(connectionString: string): boolean {
  if (process.env.DATABASE_SSL) {
    return process.env.DATABASE_SSL === "true" || process.env.DATABASE_SSL === "1";
  }
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get("sslmode");
    return (
      sslMode === "require" ||
      sslMode === "prefer" ||
      sslMode === "no-verify" ||
      url.hostname.endsWith(".supabase.co") ||
      url.hostname.includes("pooler.supabase.com")
    );
  } catch {
    return false;
  }
}

function connectionStringForPg(connectionString: string): string {
  if (!shouldUseSsl(connectionString)) {
    return connectionString;
  }
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get("sslmode");
    if (!sslMode || sslMode === "require" || sslMode === "prefer") {
      url.searchParams.set("sslmode", "no-verify");
      url.searchParams.delete("uselibpqcompat");
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}

export const pool = new Pool({
  connectionString: connectionStringForPg(databaseUrl),
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10000),
  max: Number(process.env.DATABASE_POOL_MAX ?? 8),
  ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined
});

export async function runMigrations(): Promise<void> {
  const schemaPath = path.resolve(process.cwd(), "db/schema.sql");
  const schema = await fs.readFile(schemaPath, "utf8");
  await pool.query(schema);
}

export async function checkDatabaseConnection(): Promise<Record<string, unknown>> {
  const result = await pool.query(
    `
      SELECT
        current_database() AS database,
        current_user AS "user",
        inet_server_addr() AS host,
        inet_server_port() AS port,
        version() AS version
    `
  );
  return {
    ...result.rows[0],
    ssl: shouldUseSsl(databaseUrl)
  };
}

export async function seedRepositories(repositories: RepositoryConfig[]): Promise<void> {
  for (const repo of repositories) {
    const { owner, name } = splitFullName(repo.fullName);
    await pool.query(
      `
        INSERT INTO repositories
          (full_name, owner, name, display_name, homepage_url, description, importance_weight)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (full_name) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          homepage_url = EXCLUDED.homepage_url,
          description = EXCLUDED.description,
          importance_weight = EXCLUDED.importance_weight,
          updated_at = now()
      `,
      [
        repo.fullName,
        owner,
        name,
        repo.displayName,
        repo.homepageUrl,
        repo.description,
        repo.importanceWeight
      ]
    );
  }
}

export async function listRepositories(enabledOnly = false): Promise<RepositoryRecord[]> {
  const result = await pool.query(
    `
      SELECT id, full_name, owner, name, display_name, homepage_url, description, enabled, importance_weight
      FROM repositories
      ${enabledOnly ? "WHERE enabled = true" : ""}
      ORDER BY importance_weight DESC, display_name ASC
    `
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    fullName: row.full_name,
    owner: row.owner,
    name: row.name,
    displayName: row.display_name,
    homepageUrl: row.homepage_url,
    description: row.description,
    enabled: row.enabled,
    importanceWeight: row.importance_weight
  }));
}

export async function saveFetchedPullRequests(
  date: string,
  repositories: RepositoryRecord[],
  pullRequests: FetchedPullRequest[],
  warnings: string[] = []
): Promise<FetchDigestResponse> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO daily_snapshots
          (snapshot_date, status, repo_count, pr_count, fetched_at, error)
        VALUES ($1, $2, $3, 0, now(), $4)
        ON CONFLICT (snapshot_date) DO UPDATE SET
          status = EXCLUDED.status,
          repo_count = EXCLUDED.repo_count,
          fetched_at = now(),
          error = EXCLUDED.error
      `,
      [
        date,
        warnings.length ? "partial" : "ok",
        repositories.length,
        warnings.length ? warnings.slice(0, 5).join("\n") : null
      ]
    );

    // Batch inserts keep multi-month backfills from requiring two DB round trips per PR.
    const records = pullRequests.filter(pr => repositories.some(repo => repo.fullName === pr.repoFullName));
    for (let offset = 0; offset < records.length; offset += 100) {
      const values: unknown[] = [];
      const placeholders = records.slice(offset, offset + 100).map((pr, index) => {
        const repo = repositories.find(item => item.fullName === pr.repoFullName)!;
        values.push(
          repo.id,
          date,
          pr.number,
          pr.githubId,
          pr.title,
          pr.body,
          pr.url,
          pr.apiUrl,
          pr.author,
          pr.authorAvatarUrl,
          pr.mergedAt,
          pr.createdAt,
          pr.updatedAt,
          pr.baseRef,
          pr.headRef,
          pr.mergeCommitSha,
          pr.additions,
          pr.deletions,
          pr.changedFiles,
          pr.labels,
          pr.category,
          pr.importance,
          pr.importanceReason,
          pr.learningComment,
          pr.evaluation.motivation,
          pr.evaluation.previousBehavior,
          pr.evaluation.newBehavior,
          pr.evaluation.rationale,
          pr.evaluation.experiments,
          JSON.stringify(pr.raw)
        );
        const args = Array.from({ length: 30 }, (_, column) => `$${index * 30 + column + 1}${column === 29 ? "::jsonb" : ""}`);
        return `(${args.join(", ")}, now())`;
      }).join(", ");
      const result = await client.query(`
          INSERT INTO pull_requests (
            repo_id, snapshot_date, number, github_id, title, body, url, api_url,
            author, author_avatar_url, merged_at, created_at, updated_at, base_ref,
            head_ref, merge_commit_sha, additions, deletions, changed_files, labels,
            category, importance, importance_reason, learning_comment,
            motivation, previous_behavior, new_behavior, rationale, experiment_effect,
            raw, last_seen_at
          )
          VALUES ${placeholders}
          ON CONFLICT (repo_id, number) DO UPDATE SET
            snapshot_date = EXCLUDED.snapshot_date,
            github_id = EXCLUDED.github_id,
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            url = EXCLUDED.url,
            api_url = EXCLUDED.api_url,
            author = EXCLUDED.author,
            author_avatar_url = EXCLUDED.author_avatar_url,
            merged_at = EXCLUDED.merged_at,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at,
            base_ref = EXCLUDED.base_ref,
            head_ref = EXCLUDED.head_ref,
            merge_commit_sha = EXCLUDED.merge_commit_sha,
            additions = EXCLUDED.additions,
            deletions = EXCLUDED.deletions,
            changed_files = EXCLUDED.changed_files,
            labels = EXCLUDED.labels,
            category = EXCLUDED.category,
            importance = EXCLUDED.importance,
            importance_reason = EXCLUDED.importance_reason,
            learning_comment = EXCLUDED.learning_comment,
            motivation = EXCLUDED.motivation,
            previous_behavior = EXCLUDED.previous_behavior,
            new_behavior = EXCLUDED.new_behavior,
            rationale = EXCLUDED.rationale,
            experiment_effect = EXCLUDED.experiment_effect,
            raw = EXCLUDED.raw,
            last_seen_at = now()
          RETURNING id
        `, values);
      await client.query(
        `INSERT INTO pr_user_state (pr_id) SELECT unnest($1::bigint[]) ON CONFLICT (pr_id) DO NOTHING`,
        [result.rows.map(row => row.id)]
      );
    }

    const countResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM pull_requests WHERE snapshot_date = $1",
      [date]
    );
    const archivedCount = Number(countResult.rows[0]?.count ?? 0);
    await client.query(
      "UPDATE daily_snapshots SET pr_count = $2 WHERE snapshot_date = $1",
      [date, archivedCount]
    );

    await client.query("COMMIT");
    return {
      date,
      repoCount: repositories.length,
      prCount: archivedCount,
      fetchedAt: new Date().toISOString(),
      warnings: [...warnings]
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function latestSuccessfulSnapshotDate(): Promise<string | undefined> {
  const result = await pool.query(`
    SELECT max(snapshot_date)::text AS date FROM daily_snapshots
    WHERE status = 'ok'
      AND repo_count = (SELECT count(*) FROM repositories WHERE enabled)
  `);
  return result.rows[0]?.date ?? undefined;
}

export async function listSnapshots(limit = 90): Promise<SnapshotSummary[]> {
  const result = await pool.query(
    `
      SELECT snapshot_date, fetched_at, repo_count, pr_count, status, error
      FROM daily_snapshots
      ORDER BY snapshot_date DESC
      LIMIT $1
    `,
    [limit]
  );
  return result.rows.map((row) => ({
    date: toDateOnly(row.snapshot_date),
    fetchedAt: toISO(row.fetched_at) ?? new Date().toISOString(),
    repoCount: row.repo_count,
    prCount: row.pr_count,
    status: row.status,
    error: row.error
  }));
}

function filesFromRaw(raw: unknown): PullRequestFileSummary[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const files = (raw as { files?: unknown }).files;
  if (!Array.isArray(files)) {
    return [];
  }
  const parsed: Array<PullRequestFileSummary | null> = files.map((file) => {
      if (!file || typeof file !== "object") {
        return null;
      }
      const item = file as {
        path?: unknown;
        filename?: unknown;
        additions?: unknown;
        deletions?: unknown;
        changeType?: unknown;
        status?: unknown;
      };
      const path = item.path ?? item.filename;
      if (typeof path !== "string" || !path) {
        return null;
      }
      return {
        path,
        additions: item.additions == null ? null : Number(item.additions),
        deletions: item.deletions == null ? null : Number(item.deletions),
        changeType: item.changeType == null ? (item.status == null ? null : String(item.status)) : String(item.changeType)
      };
    });
  return parsed.filter((file): file is PullRequestFileSummary => file !== null);
}

export async function backfillPullRequestEvaluations(options: { force?: boolean } = {}): Promise<number> {
  const whereClause = options.force
    ? ""
    : `
      WHERE
        pr.motivation = ''
        OR pr.previous_behavior = ''
        OR pr.new_behavior = ''
        OR pr.rationale = ''
        OR pr.experiment_effect = ''
    `;
  const result = await pool.query(
    `
      SELECT
        pr.id,
        pr.title,
        pr.body,
        pr.additions,
        pr.deletions,
        pr.changed_files,
        pr.labels,
        pr.raw,
        r.id AS repo_id,
        r.full_name,
        r.owner,
        r.name,
        r.display_name,
        r.homepage_url,
        r.description,
        r.enabled,
        r.importance_weight
      FROM pull_requests pr
      JOIN repositories r ON r.id = pr.repo_id
      ${whereClause}
      ORDER BY pr.merged_at DESC
    `
  );

  for (const row of result.rows) {
    const analysis = analyzePullRequest(
      {
        title: row.title,
        body: row.body,
        labels: Array.isArray(row.labels) ? row.labels : [],
        additions: row.additions,
        deletions: row.deletions,
        changedFiles: row.changed_files,
        files: filesFromRaw(row.raw)
      },
      {
        id: Number(row.repo_id),
        fullName: row.full_name,
        owner: row.owner,
        name: row.name,
        displayName: row.display_name,
        homepageUrl: row.homepage_url,
        description: row.description,
        enabled: row.enabled,
        importanceWeight: row.importance_weight
      }
    );
    await pool.query(
      `
        UPDATE pull_requests SET
          category = $2,
          importance = $3,
          importance_reason = $4,
          learning_comment = $5,
          motivation = $6,
          previous_behavior = $7,
          new_behavior = $8,
          rationale = $9,
          experiment_effect = $10
        WHERE id = $1
      `,
      [
        row.id,
        analysis.category,
        analysis.importance,
        analysis.importanceReason,
        analysis.learningComment,
        analysis.evaluation.motivation,
        analysis.evaluation.previousBehavior,
        analysis.evaluation.newBehavior,
        analysis.evaluation.rationale,
        analysis.evaluation.experiments
      ]
    );
  }

  return result.rowCount ?? 0;
}

function toPullRequestRecord(row: Record<string, unknown>): PullRequestRecord {
  const importance = Number(row.importance) as PullRequestRecord["importance"];
  const category = row.category as PullRequestRecord["category"];
  const labels = Array.isArray(row.labels) ? (row.labels as string[]) : [];
  const repoFullName = String(row.full_name);
  const repoDisplayName = String(row.display_name);
  const [owner = "", name = ""] = repoFullName.split("/");
  const fallbackAnalysis = [row.motivation, row.previous_behavior, row.new_behavior, row.rationale, row.experiment_effect].every(Boolean) ? null : analyzePullRequest(
    {
      title: String(row.title),
      body: row.body == null ? null : String(row.body),
      labels,
      additions: row.additions == null ? null : Number(row.additions),
      deletions: row.deletions == null ? null : Number(row.deletions),
      changedFiles: row.changed_files == null ? null : Number(row.changed_files),
      files: filesFromRaw(row.raw)
    },
    {
      id: Number(row.repo_id),
      fullName: repoFullName,
      owner,
      name,
      displayName: repoDisplayName,
      homepageUrl: "",
      description: "",
      enabled: true,
      importanceWeight: Number(row.repo_importance_weight ?? 3)
    }
  );
  const evaluation = {
    motivation: String(row.motivation || fallbackAnalysis?.evaluation.motivation),
    previousBehavior: String(row.previous_behavior || fallbackAnalysis?.evaluation.previousBehavior),
    newBehavior: String(row.new_behavior || fallbackAnalysis?.evaluation.newBehavior),
    rationale: String(row.rationale || fallbackAnalysis?.evaluation.rationale),
    experiments: String(row.experiment_effect || fallbackAnalysis?.evaluation.experiments)
  };
  return {
    id: Number(row.id),
    repoId: Number(row.repo_id),
    repoFullName,
    repoDisplayName,
    number: Number(row.number),
    githubId: row.github_id == null ? null : Number(row.github_id),
    title: String(row.title),
    body: row.body == null ? null : String(row.body),
    url: String(row.url),
    author: row.author == null ? null : String(row.author),
    authorAvatarUrl: row.author_avatar_url == null ? null : String(row.author_avatar_url),
    mergedAt: toISO(row.merged_at as Date | string) ?? "",
    createdAt: toISO(row.created_at as Date | string | null),
    updatedAt: toISO(row.updated_at as Date | string | null),
    baseRef: row.base_ref == null ? null : String(row.base_ref),
    headRef: row.head_ref == null ? null : String(row.head_ref),
    additions: row.additions == null ? null : Number(row.additions),
    deletions: row.deletions == null ? null : Number(row.deletions),
    changedFiles: row.changed_files == null ? null : Number(row.changed_files),
    labels,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    importance,
    importanceLabel: IMPORTANCE_LABELS[importance],
    importanceReason: String(row.importance_reason),
    learningComment: String(row.learning_comment),
    evaluation,
    isFavorite: Boolean(row.is_favorite),
    isRead: Boolean(row.is_read),
    watchLater: Boolean(row.watch_later),
    userNote: String(row.user_note ?? "")
  };
}

function stripLocalState<T extends PullRequestRecord>(record: T): T {
  return {
    ...record,
    isFavorite: false,
    isRead: false,
    watchLater: false,
    userNote: ""
  };
}

function stripDashboardLocalState(dashboard: DashboardResponse): DashboardResponse {
  const prs = dashboard.prs.map(stripLocalState);
  return {
    ...dashboard,
    prs,
    stats: {
      ...dashboard.stats,
      unread: prs.length,
      favorites: 0,
      watchLater: 0
    }
  };
}

function stripTimelineLocalState(timeline: TimelineResponse): TimelineResponse {
  return {
    ...timeline,
    prs: timeline.prs.map(stripLocalState)
  };
}

function stripHighlightsLocalState(highlights: AnnualHighlightsResponse): AnnualHighlightsResponse {
  return {
    ...highlights,
    prs: highlights.prs.map(stripLocalState)
  };
}

export async function exportStaticDataset(options: {
  outDir: string; start?: string; end?: string; year?: number;
  dashboardLimit?: number; highlightLimit?: number; timelineLimit?: number;
}): Promise<{ path: string; days: number; prs: number; generatedAt: string }> {
  const days = (await listSnapshots(options.dashboardLimit ?? 10000))
    .filter(day => (!options.start || day.date >= options.start) && (!options.end || day.date <= options.end));
  if (!days.length) throw new Error("Refusing to export an empty archive. Run fetch/catch-up first.");
  const dashboardFiles: Record<string, string> = {};
  await fs.mkdir(path.join(options.outDir, "days"), { recursive: true });
  let prCount = 0;
  for (let offset = 0; offset < days.length; offset += 3) {
    await Promise.all(days.slice(offset, offset + 3).map(async day => {
    const dashboard = stripDashboardLocalState(await getDashboard(day.date, true));
    // The UI uses the extracted evaluation and links to GitHub for the full body.
    dashboard.prs = dashboard.prs.map(pr => ({ ...pr, body: null }));
    prCount += dashboard.prs.length;
    const file = `days/${day.date}.json`;
    await fs.writeFile(path.join(options.outDir, file), JSON.stringify(dashboard));
    dashboardFiles[day.date] = file;
    }));
  }
  const yearSet = new Set(days.map(day => Number(day.date.slice(0, 4))));
  yearSet.add(options.year ?? Number(todayISODate().slice(0, 4)));
  const highlights: StaticDataset["highlights"] = {};
  for (const year of yearSet) {
    const result = stripHighlightsLocalState(await getAnnualHighlights(year, options.highlightLimit ?? 12));
    result.prs = result.prs.map(pr => ({ ...pr, body: null }));
    highlights[String(year)] = result;
  }
  const generatedAt = new Date().toISOString();
  const dataset: StaticDataset = {
    generatedAt, defaultDate: days[0].date, days, dashboards: {}, dashboardFiles,
    timeline: { start: days[days.length-1].date, end: days[0].date, prs: [], stats: { total: prCount, days: days.length, byMonth: {} } },
    highlights
  };
  const outputPath = path.join(options.outDir, "static.json");
  // Publish the manifest last, so readers never see filenames before their content exists.
  await fs.writeFile(outputPath + ".tmp", JSON.stringify(dataset));
  await fs.rename(outputPath + ".tmp", outputPath);
  return { path: outputPath, days: days.length, prs: prCount, generatedAt };
}

export async function getDashboard(date: string, compact = false): Promise<DashboardResponse> {
  // Static exports use the saved evaluations and do not transfer large raw payloads or bodies.
  const columns = compact ? `
    pr.id, pr.repo_id, pr.number, pr.github_id, pr.title, NULL::text AS body,
    pr.url, pr.author, pr.author_avatar_url, pr.merged_at, pr.created_at, pr.updated_at,
    pr.base_ref, pr.head_ref, pr.additions, pr.deletions, pr.changed_files, pr.labels,
    pr.category, pr.importance, pr.importance_reason, pr.learning_comment,
    pr.motivation, pr.previous_behavior, pr.new_behavior, pr.rationale, pr.experiment_effect
  ` : "pr.*";
  const [snapshots, repos, prs] = await Promise.all([
    pool.query(
      `
        SELECT snapshot_date, fetched_at, repo_count, pr_count, status, error
        FROM daily_snapshots
        WHERE snapshot_date = $1
      `,
      [date]
    ),
    listRepositories(false),
    pool.query(
      `
        SELECT
          ${columns},
          r.full_name,
          r.display_name,
          r.importance_weight AS repo_importance_weight,
          COALESCE(state.is_favorite, false) AS is_favorite,
          COALESCE(state.is_read, false) AS is_read,
          COALESCE(state.watch_later, false) AS watch_later,
          COALESCE(state.user_note, '') AS user_note
        FROM pull_requests pr
        JOIN repositories r ON r.id = pr.repo_id
        LEFT JOIN pr_user_state state ON state.pr_id = pr.id
        WHERE pr.snapshot_date = $1
        ORDER BY pr.importance DESC, pr.merged_at DESC
      `,
      [date]
    )
  ]);

  const records = prs.rows.map(toPullRequestRecord);
  const snapshotRow = snapshots.rows[0];
  const snapshot: SnapshotSummary | null = snapshotRow
    ? {
        date: toDateOnly(snapshotRow.snapshot_date),
        fetchedAt: toISO(snapshotRow.fetched_at) ?? new Date().toISOString(),
        repoCount: snapshotRow.repo_count,
        prCount: snapshotRow.pr_count,
        status: snapshotRow.status,
        error: snapshotRow.error
      }
    : null;

  return {
    date,
    snapshot,
    repos,
    prs: records,
    stats: {
      total: records.length,
      unread: records.filter((pr) => !pr.isRead).length,
      favorites: records.filter((pr) => pr.isFavorite).length,
      watchLater: records.filter((pr) => pr.watchLater).length,
      byImportance: records.reduce<Record<string, number>>((acc, pr) => {
        acc[String(pr.importance)] = (acc[String(pr.importance)] ?? 0) + 1;
        return acc;
      }, {}),
      byCategory: records.reduce<Record<string, number>>((acc, pr) => {
        acc[pr.category] = (acc[pr.category] ?? 0) + 1;
        return acc;
      }, {})
    }
  };
}

export async function getTimeline(startDate: string, endDate: string, limit = 600, offset = 0): Promise<TimelineResponse> {
  const result = await pool.query(
    `
      SELECT
        pr.*,
        r.full_name,
        r.display_name,
        r.importance_weight AS repo_importance_weight,
        COALESCE(state.is_favorite, false) AS is_favorite,
        COALESCE(state.is_read, false) AS is_read,
        COALESCE(state.watch_later, false) AS watch_later,
        COALESCE(state.user_note, '') AS user_note
      FROM pull_requests pr
      JOIN repositories r ON r.id = pr.repo_id
      LEFT JOIN pr_user_state state ON state.pr_id = pr.id
      WHERE pr.snapshot_date BETWEEN $1 AND $2
      ORDER BY pr.merged_at DESC, pr.id DESC
      LIMIT $3 OFFSET $4
    `,
    [startDate, endDate, limit, offset]
  );
  const prs = result.rows.map(toPullRequestRecord);
  return {
    start: startDate,
    end: endDate,
    prs,
    stats: {
      total: prs.length,
      days: new Set(prs.map((pr) => pr.mergedAt.slice(0, 10))).size,
      byMonth: prs.reduce<Record<string, number>>((acc, pr) => {
        const month = pr.mergedAt.slice(0, 7);
        acc[month] = (acc[month] ?? 0) + 1;
        return acc;
      }, {})
    }
  };
}

function toAnnualHighlightRecord(row: Record<string, unknown>): AnnualHighlightRecord {
  const record = toPullRequestRecord(row) as AnnualHighlightRecord;
  record.highlightScore = Number(row.highlight_score ?? 0);
  const evidence = record.evaluation.experiments.startsWith("未在 PR") ? "缺少显式实验" : "含验证/效果";
  record.highlightReason = `${record.importanceLabel} · ${record.categoryLabel} · ${evidence} · ${record.changedFiles ?? "?"} files`;
  return record;
}

export async function getAnnualHighlights(year: number, limit = 60, publicContent = false): Promise<AnnualHighlightsResponse> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  const result = await pool.query(
    `
      WITH scored AS (
        SELECT
          pr.*,
          r.full_name,
          r.display_name,
          r.importance_weight AS repo_importance_weight,
          COALESCE(state.is_favorite, false) AS is_favorite,
          COALESCE(state.is_read, false) AS is_read,
          COALESCE(state.watch_later, false) AS watch_later,
          COALESCE(state.user_note, '') AS user_note,
          (
            pr.importance * 20
            + CASE pr.category
                WHEN 'kernels' THEN 12
                WHEN 'serving-runtime' THEN 11
                WHEN 'distributed-moe' THEN 11
                WHEN 'training-rl' THEN 8
                WHEN 'reliability' THEN 7
                ELSE 2
              END
            + LEAST(COALESCE(pr.changed_files, 0), 40) * 0.35
            + LEAST(COALESCE(pr.additions, 0) + COALESCE(pr.deletions, 0), 4000) * 0.004
            + CASE WHEN pr.experiment_effect NOT LIKE '未在 PR%' THEN 12 ELSE 0 END
            + ${publicContent ? '0' : 'CASE WHEN COALESCE(state.is_favorite, false) THEN 15 ELSE 0 END'}
          ) AS highlight_score
        FROM pull_requests pr
        JOIN repositories r ON r.id = pr.repo_id
        LEFT JOIN pr_user_state state ON state.pr_id = pr.id
        WHERE pr.snapshot_date BETWEEN $1 AND $2
      ),
      picked AS (
        SELECT *
        FROM scored
        ORDER BY highlight_score DESC, merged_at DESC
        LIMIT $3
      )
      SELECT *
      FROM picked
      ORDER BY merged_at DESC
    `,
    [startDate, endDate, limit]
  );

  return {
    year,
    generatedAt: new Date().toISOString(),
    prs: result.rows.map(toAnnualHighlightRecord)
  };
}

export async function updatePullRequestState(
  prId: number,
  patch: Partial<Pick<PullRequestRecord, "isFavorite" | "isRead" | "watchLater" | "userNote">>
): Promise<PullRequestRecord> {
  await pool.query(
    `
      INSERT INTO pr_user_state (pr_id, is_favorite, is_read, watch_later, user_note, updated_at)
      VALUES ($1, false, false, false, '', now())
      ON CONFLICT (pr_id) DO NOTHING
    `,
    [prId]
  );
  const result = await pool.query(
    `
      UPDATE pr_user_state SET
        is_favorite = COALESCE($2, is_favorite),
        is_read = COALESCE($3, is_read),
        watch_later = COALESCE($4, watch_later),
        user_note = COALESCE($5, user_note),
        updated_at = now()
      WHERE pr_id = $1
      RETURNING pr_id
    `,
    [
      prId,
      patch.isFavorite ?? null,
      patch.isRead ?? null,
      patch.watchLater ?? null,
      patch.userNote ?? null
    ]
  );
  if (!result.rowCount) {
    throw new Error(`Pull request not found: ${prId}`);
  }

  const rows = await pool.query(
    `
      SELECT
        pr.*,
        r.full_name,
        r.display_name,
        r.importance_weight AS repo_importance_weight,
        state.is_favorite,
        state.is_read,
        state.watch_later,
        state.user_note
      FROM pull_requests pr
      JOIN repositories r ON r.id = pr.repo_id
      JOIN pr_user_state state ON state.pr_id = pr.id
      WHERE pr.id = $1
    `,
    [prId]
  );
  if (!rows.rowCount) {
    throw new Error(`Pull request not found: ${prId}`);
  }
  return toPullRequestRecord(rows.rows[0]);
}

export async function getTopPullRequestsForDate(date: string, limit = 3): Promise<PullRequestRecord[]> {
  const result = await pool.query(
    `
      SELECT
        pr.*,
        r.full_name,
        r.display_name,
        r.importance_weight AS repo_importance_weight,
        COALESCE(state.is_favorite, false) AS is_favorite,
        COALESCE(state.is_read, false) AS is_read,
        COALESCE(state.watch_later, false) AS watch_later,
        COALESCE(state.user_note, '') AS user_note
      FROM pull_requests pr
      JOIN repositories r ON r.id = pr.repo_id
      LEFT JOIN pr_user_state state ON state.pr_id = pr.id
      WHERE pr.snapshot_date = $1
      ORDER BY pr.importance DESC, pr.merged_at DESC
      LIMIT $2
    `,
    [date, limit]
  );
  return result.rows.map(toPullRequestRecord);
}
