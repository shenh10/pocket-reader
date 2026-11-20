import 'dotenv/config';
import {pool} from './db';
import {enqueueLatestDigest,claimDelivery,finishDelivery} from './push-store';
import {sendJPush,sendApns} from './push-providers';
import {normalizeDateInput} from './date';
async function main() {
  if(process.argv.includes('--enqueue-latest')) await enqueueLatestDigest(normalizeDateInput('today'));
  let sent=0,failed=0;
  for(let i=0;i<1000;i++) {
    const delivery=await claimDelivery();if(!delivery)break;
    let result;
    try {result=await (delivery.provider==='jpush'?sendJPush(delivery):sendApns(delivery));}
    catch {result={error:'ProviderUnavailable'};}
    await finishDelivery(delivery,result);
    if(result.error) {failed++;console.error('[push]',result.error);} else sent++;
  }
  console.log(JSON.stringify({sent,failed}));
  if(failed) process.exitCode=1;
}
main().catch(()=>{console.error('[push] Delivery worker failed');process.exitCode=1;}).finally(()=>pool.end());
