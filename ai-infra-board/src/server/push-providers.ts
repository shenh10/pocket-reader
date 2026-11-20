import {connect} from 'node:http2';
import {createPrivateKey,sign} from 'node:crypto';
import type {Delivery} from './push-store';
export type PushResult={messageId?:string;error?:string;invalidToken?:boolean;permanent?:boolean};
export function notification(d:Pick<Delivery,'digest_date'|'pr_count'>) {
  return {title:'今日 AI Infra 日报',body:`${d.digest_date} · ${d.pr_count} 个合并更新，点击查看精选。`,date:d.digest_date};
}
export async function sendJPush(d:Delivery, env=process.env, fetcher=fetch):Promise<PushResult> {
  if(!env.JPUSH_APP_KEY || !env.JPUSH_MASTER_SECRET) return {error:'JPushNotConfigured'};
  const n=notification(d);
  const response=await fetcher('https://api.jpush.cn/v3/push',{
    method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',
      Authorization:'Basic '+Buffer.from(env.JPUSH_APP_KEY+':'+env.JPUSH_MASTER_SECRET).toString('base64')},
    body:JSON.stringify({platform:['android'],audience:{registration_id:[d.token]},
      notification:{android:{alert:n.body,title:n.title,channel_id:'daily-digest',extras:{date:n.date},
        intent:{url:`pocketreader://daily?date=${n.date}`}}},options:{time_to_live:86400}})
  });
  const body=await response.json() as {msg_id?:number;error?:{code?:number}};
  if(response.ok && body.msg_id) return {messageId:String(body.msg_id)};
  const code=body.error?.code;
  return {error:`JPush:${code??response.status}`,invalidToken:code===1011,permanent:code===1011 || code===1003};
}
let jwtCache:{key:string;value:string;until:number}|undefined;
export function apnsJwt(env=process.env) {
  const key=[env.APNS_KEY_ID,env.APNS_TEAM_ID,env.APNS_PRIVATE_KEY].join(':');
  if(jwtCache?.key===key && jwtCache.until>Date.now())return jwtCache.value;
  if(!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_PRIVATE_KEY) throw Error('APNsNotConfigured');
  const header=Buffer.from(JSON.stringify({alg:'ES256',kid:env.APNS_KEY_ID})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:env.APNS_TEAM_ID,iat:Math.floor(Date.now()/1000)})).toString('base64url');
  const input=header+'.'+payload;
  const signature=sign('sha256',Buffer.from(input),{key:createPrivateKey(env.APNS_PRIVATE_KEY),dsaEncoding:'ieee-p1363'}).toString('base64url');
  jwtCache={key,value:input+'.'+signature,until:Date.now()+40*60*1000};return jwtCache.value;
}
export async function sendApns(d:Delivery, env=process.env):Promise<PushResult> {
  const jwt=apnsJwt(env), n=notification(d);
  return new Promise(resolve=>{
    const client=connect(d.environment==='development'?'https://api.sandbox.push.apple.com':'https://api.push.apple.com');
    let finished=false;
    const done=(result:PushResult)=>{if(finished)return;finished=true;clearTimeout(timer);client.destroy();resolve(result);};
    const timer=setTimeout(()=>done({error:'APNsTimeout'}),15000);
    client.on('error',()=>done({error:'APNsConnectionError'}));
    const req=client.request({':method':'POST',':path':'/3/device/'+d.token,authorization:'bearer '+jwt,
      'apns-topic':'cc.shenhan.pocketreader','apns-push-type':'alert','apns-priority':'10',
      'apns-expiration':String(Math.floor(Date.now()/1000)+86400),'apns-collapse-id':'daily-'+d.digest_date,'apns-id':d.id});
    let status=0, response='';req.setEncoding('utf8');
    req.on('response',headers=>{status=Number(headers[':status']);});
    req.on('data',chunk=>{if(response.length<4096)response+=chunk;});
    req.on('error',()=>done({error:'APNsRequestError'}));
    req.on('end',()=>{
      if(status===200) {done({messageId:d.id});return;}
      let reason='HTTP'+status;try{reason=JSON.parse(response).reason||reason;}catch{}
      // Only keep provider reason codes, never response bodies, keys or device tokens.
      reason=/^[A-Za-z0-9]+$/.test(reason)?reason:'Unknown';
      const invalidToken=['Unregistered','BadDeviceToken','DeviceTokenNotForTopic'].includes(reason);
      done({error:'APNs:'+reason,invalidToken,permanent:invalidToken||['PayloadTooLarge','BadTopic'].includes(reason)});
    });
    req.end(JSON.stringify({aps:{alert:{title:n.title,body:n.body},sound:'default'},date:n.date}));
  });
}
