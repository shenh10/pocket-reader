import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pool, getAnalysisProgress } from "./db";
import { selectArchiveCandidate, ARCHIVE_SELECTION_VERSION } from "./archive-selection";

const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
interface PlanItem {id:number;repo:string;number:number;title:string;keep:boolean;reason:string}
async function makePlan():Promise<PlanItem[]> {
  const rows=[];
  for(let last=0;;){
  const page=await pool.query(`SELECT pr.id,r.full_name repo,pr.number,pr.title,pr.body,pr.changed_files,
    (SELECT jsonb_agg(jsonb_build_object('path',f->>'path','additions',f->'additions')) FROM jsonb_array_elements(COALESCE(pr.raw->'files','[]'::jsonb)) f) files,pr.deep_dive->'focus' focus,
    COALESCE(pr.deep_dive->>'generator'='gpt-6.1-sol' AND pr.deep_dive->'focus' IS NOT NULL,false) completed,
    COALESCE(s.is_favorite,false) favorite,COALESCE(s.watch_later,false) watch_later,COALESCE(s.user_note,'') note
    FROM pull_requests pr JOIN repositories r ON r.id=pr.repo_id LEFT JOIN pr_user_state s ON s.pr_id=pr.id WHERE pr.id>$1 ORDER BY pr.id LIMIT 300`,[last]);
    rows.push(...page.rows);if(!page.rows.length)break;last=Number(page.rows.at(-1).id);
  }
  return rows.map(r=>({id:Number(r.id),repo:r.repo,number:r.number,title:r.title,
    ...selectArchiveCandidate({...r,changedFiles:r.changed_files})}));
}
async function refreshCounts(client: {query:typeof pool.query}) {
  await client.query(`UPDATE daily_snapshots s SET pr_count=(SELECT count(*) FROM pull_requests pr WHERE pr.snapshot_date=s.snapshot_date)`);
}
async function main(){
  const dir=arg("--dir");if(!dir)throw Error("Provide --dir for a persistent removal plan and recovery manifest");
  await fs.mkdir(dir,{recursive:true});
  const command=process.argv[2];
  if(command==="plan"){
    const plan=await makePlan();
    const text=JSON.stringify({version:ARCHIVE_SELECTION_VERSION,createdAt:new Date().toISOString(),items:plan},null,2)+"\n";
    await fs.writeFile(path.join(dir,"plan.json"),text,{flag:"wx",mode:0o600});
    const reasons:Record<string,number>={};for(const p of plan)reasons[p.reason]=(reasons[p.reason]??0)+1;
    console.log(JSON.stringify({total:plan.length,keep:plan.filter(p=>p.keep).length,remove:plan.filter(p=>!p.keep).length,reasons}));return;
  }
  const planText=await fs.readFile(path.join(dir,"plan.json"),"utf8");
  const saved=JSON.parse(planText) as {version:string;items:PlanItem[]};
  if (![ARCHIVE_SELECTION_VERSION,"mechanisms-v1"].includes(saved.version)
    || (command === "apply" && saved.version !== ARCHIVE_SELECTION_VERSION))
    throw Error("Selection version changed; create and review a fresh plan");
  if(command==="apply"){
    const current=await makePlan();const currentById=new Map(current.map(p=>[p.id,p]));
    const removing=saved.items.filter(p=>!p.keep);
    if(!removing.length)throw Error("Plan contains no removals");
    for(const p of removing){const now=currentById.get(p.id);if(!now||now.keep||now.title!==p.title||now.reason!==p.reason)throw Error("Plan is stale; regenerate before deleting");}
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='90s'");
      await client.query(await fs.readFile(path.resolve("db/archive-pruning.sql"),"utf8"));
      const ids=removing.map(p=>p.id);
      const locks=await client.query(`SELECT pr.id FROM pull_requests pr WHERE pr.id=ANY($1::bigint[]) FOR UPDATE`,[ids]);
      if(locks.rowCount!==ids.length)throw Error("Content changed during removal");
      await client.query(`LOCK TABLE pr_user_state,analysis_jobs IN SHARE ROW EXCLUSIVE MODE`);
      const protectedRows=await client.query(`SELECT pr.id FROM pull_requests pr LEFT JOIN pr_user_state s ON s.pr_id=pr.id
        LEFT JOIN analysis_jobs j ON j.pr_id=pr.id WHERE pr.id=ANY($1::bigint[]) AND (
          COALESCE(s.is_favorite,false) OR COALESCE(s.watch_later,false) OR trim(COALESCE(s.user_note,''))<>''
          OR (pr.deep_dive->>'generator'='gpt-6.1-sol' AND pr.deep_dive->'focus' IS NOT NULL)
          OR (j.status='processing' AND j.leased_until>now()))`,[ids]);
      if(protectedRows.rowCount)throw Error("Protected or currently analyzed items found; create a fresh plan");
      // Backup and deletion commit atomically: every deleted row has a full recovery record.
      await client.query(`INSERT INTO reader_archive_pruned(repo_id,number,pr_id,reason,selection_version,pr_record,user_state,analysis_job)
        SELECT pr.repo_id,pr.number,pr.id,plan.reason,$2,to_jsonb(pr),to_jsonb(s),to_jsonb(j)
        FROM pull_requests pr JOIN jsonb_to_recordset($1::jsonb) AS plan(id bigint,reason text) ON plan.id=pr.id
        LEFT JOIN pr_user_state s ON s.pr_id=pr.id LEFT JOIN analysis_jobs j ON j.pr_id=pr.id
        ON CONFLICT(repo_id,number) DO UPDATE SET pr_id=EXCLUDED.pr_id,reason=EXCLUDED.reason,
          selection_version=EXCLUDED.selection_version,pr_record=EXCLUDED.pr_record,user_state=EXCLUDED.user_state,
          analysis_job=EXCLUDED.analysis_job,pruned_at=now(),restored_at=NULL`,
        [JSON.stringify(removing.map(p=>({id:p.id,reason:p.reason}))),ARCHIVE_SELECTION_VERSION]);
      const deleted=await client.query(`DELETE FROM pull_requests pr USING reader_archive_pruned b
        WHERE pr.id=ANY($1::bigint[]) AND b.repo_id=pr.repo_id AND b.number=pr.number
        AND b.pr_record=to_jsonb(pr) AND b.restored_at IS NULL RETURNING pr.id`,[ids]);
      if(deleted.rowCount!==ids.length)throw Error("Backup/deletion count mismatch; rolling back");
      await refreshCounts(client);
      await client.query("COMMIT");
      const summary={appliedAt:new Date().toISOString(),version:ARCHIVE_SELECTION_VERSION,removed:ids.length,
        kept:current.length-ids.length,planSha256:createHash("sha256").update(planText).digest("hex"),
        recoveryTable:"reader_archive_pruned",recoveryCommand:`npm run archive:prune -- restore --dir ${dir} --ids ID[,ID...]`,
        progress:await getAnalysisProgress()};
      await fs.writeFile(path.join(dir,"summary.json"),JSON.stringify(summary,null,2)+"\n",{mode:0o600});
      console.log(JSON.stringify(summary,null,2));
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}return;
  }
  if(command==="restore"){
    const ids=(arg("--ids")??"").split(",").map(Number);
    if(!ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<1))throw Error("Provide explicit --ids from the removal plan");
    const allowed=new Set(saved.items.filter(p=>!p.keep).map(p=>p.id));if(ids.some(id=>!allowed.has(id)))throw Error("ID is not in this removal plan");
    const client=await pool.connect();try{
      await client.query("BEGIN");
      const backups=await client.query(`UPDATE reader_archive_pruned SET restored_at=now() WHERE pr_id=ANY($1::bigint[]) AND restored_at IS NULL RETURNING *`,[ids]);
      if(backups.rowCount!==ids.length)throw Error("Missing/already restored backup");
      for(const b of backups.rows){
        await client.query(`INSERT INTO pull_requests SELECT (jsonb_populate_record(NULL::pull_requests,$1::jsonb)).*`,[JSON.stringify(b.pr_record)]);
        if(b.user_state)await client.query(`INSERT INTO pr_user_state SELECT (jsonb_populate_record(NULL::pr_user_state,$1::jsonb)).*`,[JSON.stringify(b.user_state)]);
        await client.query(`INSERT INTO analysis_jobs(pr_id,status) VALUES($1,'pending')`,[b.pr_id]);
      }
      await refreshCounts(client);await client.query("COMMIT");console.log(JSON.stringify({restored:ids}));
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}return;
  }
  throw Error("archive:prune plan | apply | restore --dir DIR [--ids ID,ID]");
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
