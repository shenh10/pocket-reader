import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "./db";
import { todayISODate, normalizeDateInput } from "./date";
import { fetchEvidence } from "./deep-dive-evidence";
import { generateAnalysis, validateAnalysis, type EvidencePacket } from "./deep-dive";
import type { DeepDive } from "../shared/types";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
async function save(packet: EvidencePacket, analysis: DeepDive) {
  // Atomic replacement. Failed generation/validation never destroys a previous analysis.
  const result = await pool.query(`UPDATE pull_requests pr SET deep_dive = $3::jsonb
    FROM repositories r WHERE pr.repo_id = r.id AND r.full_name = $1 AND pr.number = $2
    RETURNING pr.id`, [packet.repo, packet.number, JSON.stringify(analysis)]);
  if (result.rowCount !== 1) throw new Error("PR must be collected before publishing its analysis");
  console.log(`[deep-dive] published ${packet.repo}#${packet.number}`);
}

async function main() {
  const command = process.argv[2];
  if (command === "prepare") {
    const repo = arg("--repo");
    const output = arg("--out");
    if (!repo || !output) throw new Error("prepare --repo owner/repo --number N --out evidence.json");
    const packet = await fetchEvidence(repo, Number(arg("--number")));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(packet, null, 2));
    console.log(`Saved evidence for ${repo}#${packet.number}: ${packet.coverage.filesReviewed}/${packet.coverage.filesTotal} files`);
    return;
  }
  if (command === "publish") {
    const evidencePath = arg("--evidence"), analysisPath = arg("--analysis");
    if (!evidencePath || !analysisPath) throw new Error("publish --evidence evidence.json --analysis analysis.json");
    const saved = JSON.parse(await fs.readFile(evidencePath, "utf8")) as EvidencePacket;
    // Re-fetch trusted evidence: a hand-edited packet cannot forge a citation or quote.
    const packet = await fetchEvidence(saved.repo, saved.number);
    if (saved.headSha !== packet.headSha || saved.baseSha !== packet.baseSha) throw new Error("Source revision changed; regenerate analysis");
    const analysis = validateAnalysis(JSON.parse(await fs.readFile(analysisPath, "utf8")), packet, arg("--generator") || "Codex reviewed");
    await save(packet, analysis);
    return;
  }
  if (command !== "run") throw new Error("Usage: deep-dive-cli.ts prepare | publish | run [--date YYYY-MM-DD] [--limit 5]");
  if (!process.env.DEEP_DIVE_API_KEY || !process.env.DEEP_DIVE_MODEL || !process.env.DEEP_DIVE_BASE_URL) {
    throw new Error("Automatic deep dives need DEEP_DIVE_API_KEY / DEEP_DIVE_MODEL / DEEP_DIVE_BASE_URL; no template fallback");
  }
  const date = normalizeDateInput(arg("--date") || todayISODate());
  const limit = Number(arg("--limit") || process.env.DEEP_DIVE_DAILY_LIMIT || 5);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("Daily limit must be 1..20");
  // Total per-day cap (not per invocation) prevents repeated catch-up from growing model spend.
  const { rows } = await pool.query(`SELECT pr.number, r.full_name, pr.deep_dive
    FROM pull_requests pr JOIN repositories r ON r.id = pr.repo_id
    WHERE pr.snapshot_date = $1 AND pr.importance >= 4
      AND pr.category <> 'docs-ci' AND pr.title !~* '^\\[(doc|ci|build)\\]'
    ORDER BY (pr.deep_dive IS NOT NULL) DESC, pr.importance DESC, pr.merged_at DESC LIMIT $2`, [date, limit]);
  let failures = 0;
  for (const row of rows) {
    if (row.deep_dive?.version === 1) continue;
    try {
      const packet = await fetchEvidence(row.full_name, Number(row.number));
      await save(packet, await generateAnalysis(packet));
    } catch (error) {
      failures++;
      console.error(`[deep-dive] failed ${row.full_name}#${row.number}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  if (failures) throw new Error(`${failures} analyses failed; existing published analyses were preserved`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
