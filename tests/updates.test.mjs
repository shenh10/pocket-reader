import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, publicDecrypt, createDecipheriv, createHash} from 'node:crypto';
import { sealBundle } from '../scripts/update-crypto.mjs';
import { validateUpdate } from '../shared/update-policy.js';
test('signed bundle decrypts using the native Capgo protocol and authenticates the zip', () => {
  const {publicKey,privateKey} = generateKeyPairSync('rsa',{modulusLength:2048});
  const zip=Buffer.from('test zip payload'), sealed=sealBundle(zip,privateKey);
  const [iv,key]=sealed.sessionKey.split(':').map(s=>Buffer.from(s,'base64'));
  const cipher=createDecipheriv('aes-128-cbc',publicDecrypt(publicKey,key),iv);
  assert.deepEqual(Buffer.concat([cipher.update(sealed.payload),cipher.final()]),zip);
  assert.deepEqual(publicDecrypt(publicKey,Buffer.from(sealed.checksum,'hex')),createHash('sha256').update(zip).digest());
  const tampered=Buffer.from(sealed.checksum,'hex'); tampered[3]^=1;
  assert.throws(()=>publicDecrypt(publicKey,tampered));
});
test('updates reject a native mismatch, unsigned payloads, and off-site bundle URLs',()=>{
  const m={schema:1,nativeVersion:'0.3.0',version:'0.3.0-abcdef012345',url:'https://shenhan.cc/pocket-reader/updates/'+ 'a'.repeat(64)+'.zip',checksum:'b'.repeat(512),sessionKey:'YWJj:YWJj'};
  assert.equal(validateUpdate(m,'0.3.0').version,m.version);
  assert.throws(()=>validateUpdate(m,'0.2.0'));
  for(const url of ['https://evil.example/a.zip','http://shenhan.cc/pocket-reader/updates/a.zip',m.url+'?redirect=evil']) assert.throws(()=>validateUpdate({...m,url},'0.3.0'));
  assert.throws(()=>validateUpdate({...m,checksum:'b'.repeat(64)},'0.3.0'));
});
