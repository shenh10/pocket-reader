import {randomUUID} from 'node:crypto';
import {pool} from './db';
import type {PushStore} from './push-api';
export const pushStore:PushStore = {
  async allowRegistration(bucket) {
    await pool.query('DELETE FROM pocket_private.registration_limits WHERE expires_at < now()');
    const {rows}=await pool.query(`INSERT INTO pocket_private.registration_limits(bucket,expires_at) VALUES($1,now()+interval '2 hours')
      ON CONFLICT(bucket) DO UPDATE SET count=pocket_private.registration_limits.count+1 RETURNING count`,[bucket]);
    return rows[0].count<=60;
  },
  async subscribe(d) {
    try {
      const r=await pool.query(`INSERT INTO pocket_private.devices(id,capability_hash,provider,token,environment) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(id) DO UPDATE SET provider=EXCLUDED.provider,token=EXCLUDED.token,environment=EXCLUDED.environment,enabled=true,updated_at=now()
        WHERE pocket_private.devices.capability_hash=EXCLUDED.capability_hash RETURNING id`,[d.id,d.capabilityHash,d.provider,d.token,d.environment]);
      return r.rowCount===1;
    } catch(e) {if((e as {code?:string}).code==='23505') return false;throw e;}
  },
  async unsubscribe(id,hash) {
    await pool.query('DELETE FROM pocket_private.devices WHERE id=$1 AND capability_hash=$2',[id,hash]);
  },
};
export async function enqueueLatestDigest(date:string) {
  // Only the completed current issue is enqueued; history backfills never notify every old day.
  const {rows}=await pool.query(`SELECT pr_count FROM daily_snapshots WHERE snapshot_date=$1 AND status='ok'`,[date]);
  if(!rows.length) throw Error('Cannot notify before a successful digest is stored');
  const devices=await pool.query(`SELECT id FROM pocket_private.devices WHERE enabled=true AND updated_at > now()-interval '180 days'`);
  for(const d of devices.rows) await pool.query(`INSERT INTO pocket_private.deliveries(id,device_id,digest_date,pr_count)
    VALUES($1,$2,$3,$4) ON CONFLICT(device_id,digest_date) DO NOTHING`,[randomUUID(),d.id,date,rows[0].pr_count]);
}
export interface Delivery {id:string;device_id:string;digest_date:string;pr_count:number;attempts:number;provider:'jpush'|'apns';token:string;environment:'production'|'development';lease:string;}
export async function claimDelivery():Promise<Delivery|undefined> {
  await pool.query(`UPDATE pocket_private.deliveries SET status='expired' WHERE status IN ('pending','sending') AND expires_at<now()`);
  const {rows}=await pool.query(`WITH candidate AS (
    SELECT q.id FROM pocket_private.deliveries q JOIN pocket_private.devices d ON d.id=q.device_id
    WHERE d.enabled AND q.attempts<5 AND q.expires_at>now() AND q.next_attempt_at<=now()
      AND (q.status='pending' OR (q.status='sending' AND q.locked_until<now()))
    ORDER BY q.next_attempt_at FOR UPDATE OF q SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE pocket_private.deliveries q SET status='sending',attempts=attempts+1,lease=$1,locked_until=now()+interval '2 minutes'
    FROM candidate c WHERE q.id=c.id RETURNING q.*
  ) SELECT c.*,to_char(c.digest_date,'YYYY-MM-DD') AS digest_date,d.provider,d.token,d.environment FROM claimed c
    JOIN pocket_private.devices d ON d.id=c.device_id`,[randomUUID()]);
  return rows[0];
}
export async function finishDelivery(d:Delivery,result:{messageId?:string;error?:string;invalidToken?:boolean;permanent?:boolean}) {
  const sent=!result.error, terminal=Boolean(result.permanent)||d.attempts>=5;
  await pool.query(`UPDATE pocket_private.deliveries SET status=$3,provider_message_id=$4,last_error=$5,
    sent_at=CASE WHEN $3='sent' THEN now() ELSE NULL END,locked_until=NULL,
    next_attempt_at=now()+($6::integer * interval '1 minute') WHERE id=$1 AND lease=$2`,
    [d.id,d.lease,sent?'sent':terminal?'failed':'pending',result.messageId??null,result.error??null,Math.min(60,5*2**(d.attempts-1))]);
  if(result.invalidToken) await pool.query(`UPDATE pocket_private.devices SET enabled=false WHERE id=$1 AND token=$2`,[d.device_id,d.token]);
}
