import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { topicArticle, topicIdPattern, type TopicArticle } from "../src/shared/topics";

const fields = new Set(["id", "title", "description", "category", "tags", "version",
  "updatedAt", "readingMinutes", "relatedTopicIds", "body", "contentHash"]);
function invalid(message: string): never { throw new Error(`Invalid topic bundle: ${message}`); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("expected object");
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
    invalid(`invalid ${name}`);
  return value;
}
function strings(value: unknown, name: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) invalid(`invalid ${name}`);
  const result = value.map(v => string(v, name, 100));
  if (new Set(result).size !== result.length) invalid(`duplicate ${name}`);
  return result;
}

function hasRawHtml(body: string): boolean {
  // Code examples are displayed as text. Do not interpret C++ generics or
  // kernel comparisons as markup; tag syntax also must not span prose/math.
  let fence: { marker: string; length: number } | undefined;
  const prose = body.split("\n").filter(line => {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (match && match[1][0] === fence.marker && match[1].length >= fence.length) fence = undefined;
      return false;
    }
    if (match) { fence = { marker: match[1][0], length: match[1].length }; return false; }
    return true;
  }).join("\n").replace(/(`+)[^\n]*?\1/g, "");
  return /<!--|<!DOCTYPE|<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+[A-Za-z_:][A-Za-z0-9_:.-]*(?:\s*=\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s<>]+))?)*\s*\/?>/i.test(prose);
}

/** Validate the whole release before any database connection or mutation. */
export function validateTopicBundle(input: unknown): TopicArticle[] {
  const bundle = object(input);
  if (Object.keys(bundle).some(k => k !== "topics") || !Array.isArray(bundle.topics)
    || bundle.topics.length < 8 || bundle.topics.length > 1000) invalid("expected at least eight topics");
  const topics = bundle.topics.map((value: unknown) => {
    const t = object(value);
    if (Object.keys(t).some(k => !fields.has(k))) invalid("unexpected article field");
    const id = string(t.id, "id", 80);
    if (!topicIdPattern.test(id)) invalid("invalid slug");
    const title = string(t.title, "title", 300);
    const description = string(t.description, "description", 4000);
    const category = string(t.category, "category", 100);
    const tags = strings(t.tags, "tags", 50);
    const relatedTopicIds = strings(t.relatedTopicIds, "relatedTopicIds", 100);
    if (relatedTopicIds.some(v => !topicIdPattern.test(v) || v === id)) invalid("invalid related id");
    if (!Number.isInteger(t.version) || Number(t.version) < 1 || Number(t.version) > 2147483647)
      invalid("invalid version");
    if (!Number.isInteger(t.readingMinutes) || Number(t.readingMinutes) < 1 || Number(t.readingMinutes) > 10000)
      invalid("invalid readingMinutes");
    const updatedAt = string(t.updatedAt, "updatedAt", 100);
    if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(updatedAt)
      || !Number.isFinite(Date.parse(updatedAt))) invalid("invalid updatedAt");
    const body = string(t.body, "body", 2_000_000);
    // Markdown is the publishing format. Code diagrams remain fenced plain text.
    if (hasRawHtml(body)) invalid("raw HTML is not allowed");
    if (/\b(?:javascript|vbscript|data|file):/i.test(body)
      || /(?:\/Users\/|\/private\/|\/var\/folders\/|[A-Za-z]:\\Users\\)/i.test(body))
      invalid("non-public content or link");
    const contentHash = string(t.contentHash, "contentHash", 64);
    if (!/^[0-9a-f]{64}$/.test(contentHash)
      || createHash("sha256").update(body, "utf8").digest("hex") !== contentHash)
      invalid("body hash mismatch");
    return topicArticle({ id, title, description, category, tags, relatedTopicIds,
      version: Number(t.version), updatedAt, readingMinutes: Number(t.readingMinutes), body, contentHash });
  });
  const ids = new Set(topics.map(t => t.id));
  if (ids.size !== topics.length) invalid("duplicate topic id");
  if (topics.some(t => t.relatedTopicIds.some(id => !ids.has(id)))) invalid("unknown related topic");
  return topics;
}

export async function upsertTopics(client: Pick<PoolClient, "query">, topics: TopicArticle[]): Promise<number> {
  let changed = 0;
  for (const t of topics) {
    const result = await client.query(`INSERT INTO public.reader_topics AS existing
      (id,title,description,category,tags,version,updated_at,reading_minutes,related_topic_ids,body,content_hash,published_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
      ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,
        category=EXCLUDED.category,tags=EXCLUDED.tags,version=EXCLUDED.version,
        updated_at=EXCLUDED.updated_at,reading_minutes=EXCLUDED.reading_minutes,
        related_topic_ids=EXCLUDED.related_topic_ids,body=EXCLUDED.body,content_hash=EXCLUDED.content_hash,
        published_at=COALESCE(existing.published_at,EXCLUDED.published_at)
      WHERE (existing.title,existing.description,existing.category,existing.tags,existing.version,
        existing.updated_at,existing.reading_minutes,existing.related_topic_ids,existing.body,existing.content_hash)
        IS DISTINCT FROM (EXCLUDED.title,EXCLUDED.description,EXCLUDED.category,EXCLUDED.tags,EXCLUDED.version,
        EXCLUDED.updated_at,EXCLUDED.reading_minutes,EXCLUDED.related_topic_ids,EXCLUDED.body,EXCLUDED.content_hash)
        OR existing.published_at IS NULL`,
    [t.id,t.title,t.description,t.category,t.tags,t.version,t.updatedAt,t.readingMinutes,
      t.relatedTopicIds,t.body,t.contentHash]);
    changed += result.rowCount ?? 0;
  }
  return changed;
}

export async function main(args: string[]): Promise<void> {
  let input: string | undefined, migrate = false, dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && !input) input = args[++i];
    else if (args[i] === "--migrate") migrate = true;
    else if (args[i] === "--dry-run") dryRun = true;
    else throw new Error("Usage: publish-topics.ts --input /absolute/bundle.json [--migrate] [--dry-run]");
  }
  if (!input || !isAbsolute(input)) throw new Error("--input must be an absolute bundle JSON path");
  const topics = validateTopicBundle(JSON.parse(await readFile(input, "utf8")));
  if (dryRun) {
    console.log(JSON.stringify({ validated: topics.length, databaseMutated: false, ids: topics.map(t => t.id) }));
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const { pool } = await import("../src/server/db");
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(724019223)");
      if (migrate) await client.query(await readFile(new URL("../db/topics-schema.sql", import.meta.url), "utf8"));
      const changed = await upsertTopics(client, topics);
      await client.query("COMMIT");
      console.log(JSON.stringify({ topics: topics.length, changed, unchanged: topics.length - changed }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    // Database/JSON errors can contain SQL, credentials or local editorial text.
    console.error("Topic publication failed. Check bundle validation and database permissions locally.");
    process.exitCode = 1;
  });
}
