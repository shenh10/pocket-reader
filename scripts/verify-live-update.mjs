import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {publicDecrypt,createDecipheriv,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {validateUpdate,UPDATE_MANIFEST} from '../shared/update-policy.js';
const config=JSON.parse(await readFile('capacitor.config.json','utf8'));
const pkg=JSON.parse(await readFile('package.json','utf8'));
const key=config.plugins.CapacitorUpdater.publicKey;
let lastError;
for(let attempt=0;attempt<6;attempt++) {
 try {
  const response=await fetch(UPDATE_MANIFEST+'?verify='+Date.now(),{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Manifest HTTP '+response.status);
  if(response.headers.get('access-control-allow-origin')!=='*')throw Error('Manifest must permit the native WebView origin');
  const update=validateUpdate(await response.json(),pkg.version);
  const download=await fetch(update.url,{signal:AbortSignal.timeout(30000)});
  if(!download.ok)throw Error('Bundle HTTP '+download.status);
  const payload=Buffer.from(await download.arrayBuffer());
  const [iv,encryptedKey]=update.sessionKey.split(':').map(v=>Buffer.from(v,'base64'));
  const cipher=createDecipheriv('aes-128-cbc',publicDecrypt(key,encryptedKey),iv);
  const zip=Buffer.concat([cipher.update(payload),cipher.final()]);
  const expected=publicDecrypt(key,Buffer.from(update.checksum,'hex'));
  if(!createHash('sha256').update(zip).digest().equals(expected))throw Error('Bundle signature mismatch');
  const dir=await mkdtemp(path.join(tmpdir(),'pocket-update-'));
  try {
   const file=path.join(dir,'bundle.zip');await writeFile(file,zip);
   execFileSync('unzip',['-tq',file],{stdio:'pipe'});
   const files=execFileSync('unzip',['-Z1',file],{encoding:'utf8'}).split('\n');
   if(!files.includes('index.html') || files.some(f=>f.startsWith('ai-infra-board/data/')))throw Error('Invalid mobile content');
  }finally{await rm(dir,{recursive:true,force:true});}
  console.log('Live update verified: HTTPS, CORS, pinned signature, valid zip, no packaged daily reports. Version '+update.version);
  lastError=null;break;
 }catch(error){lastError=error;if(attempt<5)await new Promise(r=>setTimeout(r,10000));}
}
if(lastError)throw lastError;
