import {createHash} from 'node:crypto';
export type Device = {id:string; provider:'jpush'|'apns'; token:string; environment:'production'|'development'; capabilityHash:string};
export interface PushStore {
  allowRegistration(bucket:string):Promise<boolean>;
  subscribe(device:Device):Promise<boolean>;
  unsubscribe(id:string, hash:string):Promise<void>;
}
export function hashCapability(value:string) { return createHash('sha256').update(value).digest('hex'); }
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET, PUT, DELETE, OPTIONS','Access-Control-Allow-Headers':'content-type, authorization','X-Content-Type-Options':'nosniff'};
export function createPushHandler(store:PushStore, providers:()=>string[]) {
  return async (req:Request):Promise<Response> => {
    const reply = (value:unknown,status=200) => new Response(JSON.stringify(value),{status,headers});
    if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
    const route=new URL(req.url).pathname.split('/v1/push/')[1];
    if(route==='config' && req.method==='GET') return reply({providers:providers()});
    const id=route?.match(/^devices\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/)?.[1];
    if(!id) return reply({error:'Not found'},404);
    if(!['PUT','DELETE'].includes(req.method)) return reply({error:'Method not allowed'},405);
    const capability=req.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if(!capability) return reply({error:'Device capability required'},401);
    try {
      if(req.method==='DELETE') { await store.unsubscribe(id,hashCapability(capability)); return reply({enabled:false}); }
      // Bound reads as well as Content-Length: chunked requests must not allocate unbounded memory.
      const reader=req.body?.getReader(); let text='', bytes=0;
      if(reader) {
        const decoder=new TextDecoder();
        while(true) {const {done,value}=await reader.read();if(done)break;bytes+=value.length;
          if(bytes>2048) {await reader.cancel();return reply({error:'Request too large'},413);} text+=decoder.decode(value,{stream:true});}
        text+=decoder.decode();
      }
      let data; try {data=JSON.parse(text);} catch {return reply({error:'Invalid JSON'},400);}
      if(!data || !['jpush','apns'].includes(data.provider) || !['production','development'].includes(data.environment)
        || typeof data.token!=='string' || !(data.provider==='apns'?/^[a-f0-9]{64,200}$/i:/^[a-zA-Z0-9_-]{8,256}$/).test(data.token))
        return reply({error:'Invalid device registration'},400);
      if(!providers().includes(data.provider)) return reply({error:'此平台推送尚未配置。'},503);
      const ip=req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
      const bucket=hashCapability(ip+':'+new Date().toISOString().slice(0,13));
      if(!await store.allowRegistration(bucket)) return reply({error:'请稍后再试。'},429);
      const owned=await store.subscribe({id,capabilityHash:hashCapability(capability),provider:data.provider,token:data.token,environment:data.environment});
      return owned ? reply({enabled:true}) : reply({error:'Device registration conflict'},409);
    } catch {
      return reply({error:'推送订阅暂时不可用，请稍后重试。'},503);
    }
  };
}
