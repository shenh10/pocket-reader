import {PocketPush} from '@pocket-reader/push';
import {Preferences} from '@capacitor/preferences';
import {Capacitor} from '@capacitor/core';
import {App} from '@capacitor/app';
import {serviceBase} from './service-client.js';
const KEY='pocket-push-subscription';
export async function startPush({message,settings,handleNotification}) {
  const button=document.getElementById('push-enable'), label=document.getElementById('push-state');
  const show=text=>{if(label)label.textContent=text;};
  let saved;try {saved=JSON.parse((await Preferences.get({key:KEY})).value||'null');}catch{}
  const persist=()=>Preferences.set({key:KEY,value:JSON.stringify(saved)});
  async function mutate(method,registration) {
    const response=await fetch(new URL('push/devices/'+saved.id,await serviceBase()),{method,
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+saved.capability},
      body:method==='PUT'?JSON.stringify(registration):undefined,signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw Error('暂时无法保存推送设置，请联网后重试。');
  }
  let chain=Promise.resolve();
  const serial=work => {const next=chain.then(work);chain=next.catch(()=>{});return next;};
  async function sync() {
    if(saved?.removePending) {await mutate('DELETE');saved.removePending=false;await persist();}
    if(!saved?.enabled)return;
    const state=await PocketPush.status();
    if(!state.permission) {
      saved.enabled=false;saved.removePending=true;await persist();await mutate('DELETE');saved.removePending=false;await persist();
      show('系统通知权限已关闭。');return;
    }
    const registration=await PocketPush.register();
    await mutate('PUT',registration);show('已开启。日报发布后推送，点击通知直接阅读。');
  }
  PocketPush.addListener('notificationOpened',async()=>{
    handleNotification(await PocketPush.pendingNotification());
  });
  handleNotification(await PocketPush.pendingNotification());
  // Renew registration on launch / foreground; the service follows rotated device tokens.
  void serial(sync).catch(()=>show(saved?.enabled?'订阅暂时无法同步，联网后会重试。':'关闭操作待联网同步。'));
  App.addListener('appStateChange',({isActive})=>{if(isActive)void serial(sync).catch(()=>{});});
  if(!settings)return;
  if(saved?.enabled){button.textContent='关闭';button.disabled=false;show('日报推送已开启。');}
  else show('正在检查推送服务…');
  try {
    const res=await fetch(new URL('push/config',await serviceBase()),{signal:AbortSignal.timeout(10000)});
    if(!res.ok)throw Error('推送服务暂时不可用。');
    const config=await res.json(), state=await PocketPush.status();
    const provider=Capacitor.getPlatform()==='ios'?'apns':'jpush';
    if(!saved?.enabled && (!config.providers.includes(provider)||!state.configured)) {
      show('推送通道正在配置，开放后可在这里开启。');return;
    }
    if(!saved?.enabled){show('开启后通过系统通知接收日报。Android 使用极光推送，会向服务商提交设备推送标识。');button.textContent='开启';button.disabled=false;}
  }catch(error){show(error.message);}
  button.addEventListener('click',()=>serial(async()=>{
    button.disabled=true;
    try {
      if(saved?.enabled || saved?.removePending) {
        saved.enabled=false;saved.removePending=true;await persist();await PocketPush.unregister();
        await mutate('DELETE');saved.removePending=false;await persist();button.textContent='开启';show('已关闭日报推送。');return;
      }
      if(!saved) {
        const bytes=crypto.getRandomValues(new Uint8Array(32));
        saved={id:crypto.randomUUID(),capability:[...bytes].map(x=>x.toString(16).padStart(2,'0')).join(''),enabled:false};
        await persist();
      }
      const registration=await PocketPush.register();
      try {await mutate('PUT',registration);}catch(error){await PocketPush.unregister();throw error;}
      saved.enabled=true;saved.removePending=false;await persist();button.textContent='关闭';show('已开启。日报发布后推送，点击通知直接阅读。');message('日报推送已开启');
    }catch(error){message(error.message||'推送设置未完成，请重试。');if(saved?.removePending)button.textContent='重试关闭';}
    finally {button.disabled=false;}
  }));
}
