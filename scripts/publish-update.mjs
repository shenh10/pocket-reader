import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { sealBundle } from './update-crypto.mjs';
const config = JSON.parse(await fs.readFile('capacitor.config.json','utf8'));
const pkg = JSON.parse(await fs.readFile('package.json','utf8'));
const privateKey = process.env.POCKET_UPDATE_PRIVATE_KEY;
if (!privateKey) throw Error('POCKET_UPDATE_PRIVATE_KEY is required to publish mobile updates');
const publicKey = createPublicKey(privateKey).export({type:'pkcs1',format:'pem'}).toString();
if (publicKey.trim() !== config.plugins.CapacitorUpdater.publicKey.trim()) throw Error('Update signing key does not match the installed app');
const sha = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim().slice(0,12);
await fs.mkdir('_site/updates',{recursive:true});
await fs.rm('_mobile-update.zip',{force:true});
try {
  execFileSync('zip',['-qr','../_mobile-update.zip','.'],{cwd:'_mobile'});
  const {payload, ...signature} = sealBundle(await fs.readFile('_mobile-update.zip'),privateKey);
  const filename = createHash('sha256').update(payload).digest('hex')+'.zip';
  await fs.writeFile('_site/updates/'+filename,payload);
  await fs.writeFile('_site/updates/latest.json',JSON.stringify({schema:1,nativeVersion:pkg.version,
    version:pkg.version+'-'+sha,url:'https://shenhan.cc/pocket-reader/updates/'+filename,...signature},null,2));
  console.log('Signed mobile update prepared for Pages deployment');
} finally { await fs.rm('_mobile-update.zip',{force:true}); }
