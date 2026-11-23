import { randomUUID } from "node:crypto";
import { pool } from "./db";
import type { DeepDive } from "../shared/types";

export const TARGET_GENERATOR = "gpt-6.1-sol";
const complete = `(pr.deep_dive->>'generator' = 'gpt-6.1-sol' AND pr.deep_dive->'focus' IS NOT NULL)`;
export interface AnalysisJob { prId: number; repo: string; number: number; title: string; date: string; leaseToken: string }

export async function seedAnalysisQueue(): Promise<void> {
  await pool.query(`INSERT INTO analysis_jobs (pr_id, status)
    SELECT pr.id, CASE WHEN ${complete} THEN 'done' ELSE 'pending' END FROM pull_requests pr
    ON CONFLICT (pr_id) DO NOTHING`);
}

export async function claimAnalysisJobs(limit = 5): Promise<AnalysisJob[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("Batch size must be 1..20; this is not an archive cap");
  await seedAnalysisQueue();
  const token = randomUUID();
  const { rows } = await pool.query(`WITH candidates AS (
    SELECT j.pr_id FROM analysis_jobs j JOIN pull_requests pr ON pr.id = j.pr_id
    WHERE NOT COALESCE(${complete}, false) AND (
      (j.status IN ('pending','retry') AND j.retry_at <= now()) OR
      (j.status = 'processing' AND j.leased_until < now()))
    ORDER BY j.attempts ASC, pr.snapshot_date DESC, pr.importance DESC, pr.merged_at DESC, pr.id
    LIMIT $1 FOR UPDATE OF j SKIP LOCKED
  ), claimed AS (
    UPDATE analysis_jobs j SET status='processing', lease_token=$2, leased_until=now()+interval '90 minutes',
      attempts=attempts+1, updated_at=now() FROM candidates c WHERE j.pr_id=c.pr_id RETURNING j.*
  ) SELECT pr.id, pr.number, pr.title, pr.snapshot_date::text date, r.full_name, c.lease_token
    FROM claimed c JOIN pull_requests pr ON pr.id=c.pr_id JOIN repositories r ON r.id=pr.repo_id`, [limit, token]);
  return rows.map(row => ({prId: Number(row.id), repo: row.full_name, number: row.number, title: row.title, date: row.date, leaseToken: row.lease_token}));
}

export async function finishAnalysisJob(job: AnalysisJob, analysis: DeepDive): Promise<void> {
  if (analysis.generator !== TARGET_GENERATOR || !analysis.focus) throw new Error("Archive worker requires GPT-6.1 Sol and a learning assessment");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // A disconnected publisher must not leave its lease/content locks held indefinitely.
    await client.query("SET LOCAL idle_in_transaction_session_timeout='60s'");
    await client.query("SET LOCAL statement_timeout='60s'");
    const lock = await client.query(`SELECT pr_id FROM analysis_jobs WHERE pr_id=$1 AND lease_token=$2
      AND status='processing' AND leased_until > now() FOR UPDATE`, [job.prId, job.leaseToken]);
    if (!lock.rowCount) throw new Error("Analysis lease expired or was replaced; refusing stale write");
    const updated = await client.query(`UPDATE pull_requests pr SET deep_dive=$2::jsonb FROM repositories r
      WHERE pr.id=$1 AND pr.repo_id=r.id AND r.full_name=$3 AND pr.number=$4 RETURNING pr.id`,
      [job.prId, JSON.stringify(analysis), job.repo, job.number]);
    if (!updated.rowCount) throw new Error("Job identity no longer matches PR");
    await client.query(`UPDATE analysis_jobs SET status='done',lease_token=NULL,leased_until=NULL,last_error=NULL,updated_at=now() WHERE pr_id=$1`, [job.prId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function failAnalysisJob(job: AnalysisJob, reason: string): Promise<void> {
  await pool.query(`UPDATE analysis_jobs SET status=CASE WHEN attempts>=5 THEN 'needs_review' ELSE 'retry' END,
    retry_at=now()+ make_interval(mins => LEAST(1440, 15 * attempts)), last_error=$3,
    lease_token=NULL,leased_until=NULL,updated_at=now()
    WHERE pr_id=$1 AND lease_token=$2 AND status='processing'`, [job.prId, job.leaseToken, reason.slice(0, 500)]);
}

export async function releaseAnalysisJob(job: AnalysisJob): Promise<void> {
  await pool.query(`UPDATE analysis_jobs SET status='pending',lease_token=NULL,leased_until=NULL,
    attempts=GREATEST(0,attempts-1),updated_at=now() WHERE pr_id=$1 AND lease_token=$2 AND status='processing'`, [job.prId, job.leaseToken]);
}
