import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { pool, getAnalysisProgress } from "./db";
import { seedAnalysisQueue, claimAnalysisJobs, finishAnalysisJob, failAnalysisJob, releaseAnalysisJob, TARGET_GENERATOR, type AnalysisJob } from "./analysis-queue";
import { fetchEvidence } from "./deep-dive-evidence";
import { ANALYSIS_PROMPT, FOCUS_PROMPT, validateAnalysis, type EvidencePacket } from "./deep-dive";

const arg = (name: string) => { const i=process.argv.indexOf(name); return i<0?undefined:process.argv[i+1]; };
interface BatchItem { job: AnalysisJob; evidenceFile: string; analysisFile: string }
async function main() {
  const command = process.argv[2];
  if (command === "status" || command === "seed") {
    if (command === "seed") await seedAnalysisQueue();
    console.log(JSON.stringify(await getAnalysisProgress(),null,2)); return;
  }
  const dir = arg("--dir");
  if (!dir) throw new Error("Provide --dir for the persistent batch folder");
  const manifest = path.join(dir,"batch.json");
  if (command === "prepare") {
    // Never overwrite a live/recoverable batch manifest.
    await fs.mkdir(dir, {recursive:true});
    const handle = await fs.open(manifest,"wx",0o600);
    const batch: BatchItem[] = [];
    try {
      const jobs = await claimAnalysisJobs(Number(arg("--batch-size") || 5));
      batch.push(...jobs.map(job => ({job, evidenceFile:`${job.prId}.evidence.json`, analysisFile:`${job.prId}.analysis.json`})));
      await handle.writeFile(JSON.stringify(batch,null,2));
    } finally { await handle.close(); }
    await fs.writeFile(path.join(dir,"instructions.txt"), `Generate using ${TARGET_GENERATOR}. Read every evidence packet, then write each analysis JSON.\n${ANALYSIS_PROMPT}${FOCUS_PROMPT}\n`);
    for (const item of batch) {
      try {
        const packet = await fetchEvidence(item.job.repo,item.job.number);
        await fs.writeFile(path.join(dir,item.evidenceFile),JSON.stringify(packet,null,2));
        console.log(`Ready: ${item.job.repo}#${item.job.number} -> ${item.analysisFile}`);
      } catch {
        // GitHub or filesystem messages can contain private paths; persist only a safe category.
        await failAnalysisJob(item.job,"Evidence retrieval failed; inspect the PR and retry");
        console.error(`Evidence failed: ${item.job.repo}#${item.job.number}`);
      }
    }
    console.log(JSON.stringify(await getAnalysisProgress())); return;
  }
  const batch = JSON.parse(await fs.readFile(manifest,"utf8")) as BatchItem[];
  if (command === "release") { for (const item of batch) await releaseAnalysisJob(item.job); return; }
  if (command !== "publish") throw new Error("archive: seed | status | prepare --dir DIR | publish --dir DIR | release --dir DIR");
  let failed = 0;
  for (const item of batch) {
    try {
      // Skip only a confirmed prior success, never a missing/invalid draft.
      if (await fs.stat(path.join(dir,`${item.job.prId}.published.json`)).catch(()=>null)) continue;
      const saved = JSON.parse(await fs.readFile(path.join(dir,item.evidenceFile),"utf8")) as EvidencePacket;
      const packet = await fetchEvidence(item.job.repo,item.job.number);
      if (saved.headSha !== packet.headSha || saved.baseSha !== packet.baseSha) throw new Error("Revision changed");
      const draft = JSON.parse(await fs.readFile(path.join(dir,item.analysisFile),"utf8"));
      const analysis = validateAnalysis(draft,packet,TARGET_GENERATOR,true);
      await finishAnalysisJob(item.job,analysis);
      await fs.writeFile(path.join(dir,`${item.job.prId}.published.json`),JSON.stringify(analysis,null,2));
      console.log(`Published: ${item.job.repo}#${item.job.number}`);
    } catch {
      failed++;
      await failAnalysisJob(item.job,"Draft, source or lease validation failed; review before retry");
      console.error(`Publication failed: ${item.job.repo}#${item.job.number}; existing analysis preserved`);
    }
  }
  console.log(JSON.stringify(await getAnalysisProgress(),null,2));
  if (failed) throw new Error(`${failed} unpublished items retained for retry/review`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
