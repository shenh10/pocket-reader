import test from 'node:test';
import assert from 'node:assert/strict';
import {createPushHandler,hashCapability, type Device} from '../src/server/push-api';
import {sendJPush,apnsJwt} from '../src/server/push-providers';
import {generateKeyPairSync,verify} from 'node:crypto';
const id='12345678-1234-1234-1234-123456789abc', capability='a'.repeat(64);
function fixture() {
 const devices=new Map<string,Device>(); let allowed=true;
 const handler=createPushHandler({allowRegistration:async()=>allowed,
  subscribe:async d=>{if(devices.has(d.id)&&devices.get(d.id)?.capabilityHash!==d.capabilityHash)return false;devices.set(d.id,d);return true;},
  unsubscribe:async(i,h)=>{if(devices.get(i)?.capabilityHash===h)devices.delete(i);}},()=>['jpush','apns']);
 const request=(method='PUT',token=capability,body:unknown={provider:'jpush',token:'testRegistration',environment:'production'})=>handler(new Request('https://service/v1/push/devices/'+id,{method,headers:{authorization:'Bearer '+token},body:method==='PUT'?JSON.stringify(body):undefined}));
 return {devices,request,handler,limit:()=>allowed=false};
}
test('per-install capability prevents changing or deleting another device',async()=>{
 const f=fixture();assert.equal((await f.request()).status,200);assert.equal(f.devices.get(id)?.capabilityHash,hashCapability(capability));
 assert.equal((await f.request('PUT','b'.repeat(64))).status,409);
 await f.request('DELETE','b'.repeat(64));assert.equal(f.devices.size,1);
 await f.request('DELETE');assert.equal(f.devices.size,0);
});
test('rejects invalid providers, invalid tokens, oversized bodies and rate limiting',async()=>{
 const f=fixture();assert.equal((await f.request('PUT','invalid')).status,401);
 assert.equal((await f.request('PUT',capability,{provider:'webhook',token:'https://evil',environment:'production'})).status,400);
 assert.equal((await f.request('PUT',capability,{provider:'apns',token:'not-device-token',environment:'development'})).status,400);
 assert.equal((await f.request('PUT',capability,{payload:'x'.repeat(3000)})).status,413);
 f.limit();assert.equal((await f.request()).status,429);
});
test('JPush addresses one registration ID and carries only a date deep link',async()=>{
 let payload:any;
 const result=await sendJPush({id,device_id:id,lease:id,provider:'jpush',token:'reg12345678',environment:'production',digest_date:'2026-11-20',pr_count:228,attempts:1},
  {JPUSH_APP_KEY:'test-app',JPUSH_MASTER_SECRET:'test-secret'},async(url,options)=>{
   assert.equal(url,'https://api.jpush.cn/v3/push');payload=JSON.parse(String(options?.body));return Response.json({msg_id:123});
  });
 assert.equal(result.messageId,'123');assert.deepEqual(payload.audience,{registration_id:['reg12345678']});
 assert.equal(payload.notification.android.extras.date,'2026-11-20');assert.equal(payload.notification.android.intent.url,'pocketreader://daily?date=2026-11-20');
});
test('APNs JWT uses an ES256 signature accepted by Apple token auth',()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const jwt=apnsJwt({APNS_KEY_ID:'test-key',APNS_TEAM_ID:'test-team',APNS_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'}).toString()});
 const [h,p,s]=jwt.split('.');assert.equal(JSON.parse(Buffer.from(h,'base64url').toString()).alg,'ES256');
 assert.ok(verify('sha256',Buffer.from(h+'.'+p),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url')));
});
