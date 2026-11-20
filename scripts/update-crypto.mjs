import { createCipheriv, createHash, randomBytes, privateEncrypt, constants } from 'node:crypto';
export function sealBundle(zip, privateKey) {
  const key = randomBytes(16), iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  const payload = Buffer.concat([cipher.update(zip), cipher.final()]);
  // Capgo v2 protocol: RSA PKCS#1 private-key operation on raw SHA-256 and AES session key.
  const sign = data => privateEncrypt({key:privateKey, padding:constants.RSA_PKCS1_PADDING}, data);
  return {payload, checksum:sign(createHash('sha256').update(zip).digest()).toString('hex'),
    sessionKey:iv.toString('base64')+':'+sign(key).toString('base64')};
}
