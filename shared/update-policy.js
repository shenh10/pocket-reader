export const UPDATE_ORIGIN = "https://shenhan.cc";
export const UPDATE_MANIFEST = `${UPDATE_ORIGIN}/pocket-reader/updates/latest.json`;
export function validateUpdate(manifest, nativeVersion) {
  if (!manifest || manifest.schema !== 1 || manifest.nativeVersion !== nativeVersion)
    throw Error("这次更新需要新版安装包。");
  const url = new URL(manifest.url);
  if (url.origin !== UPDATE_ORIGIN || !/^\/pocket-reader\/updates\/[a-f0-9]{64}\.zip$/.test(url.pathname) || url.search || url.hash)
    throw Error("无效的更新地址。");
  if (!/^\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(manifest.version) || !/^[a-f0-9]{512}$/.test(manifest.checksum) || !/^[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/.test(manifest.sessionKey))
    throw Error("无效的更新签名。");
  return {url: url.href, version: manifest.version, checksum: manifest.checksum, sessionKey: manifest.sessionKey};
}
