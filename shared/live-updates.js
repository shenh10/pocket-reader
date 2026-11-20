import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { App } from '@capacitor/app';
import { UPDATE_MANIFEST, validateUpdate } from './update-policy.js';
let checking;
export async function startUpdates({ message, settings }) {
  // Reaching here confirms the shared shell has initialized; offline API reads do not block readiness.
  await CapacitorUpdater.notifyAppReady();
  const label = document.getElementById('update-state');
  const button = document.getElementById('check-update');
  const show = text => { if (label) label.textContent = text; };
  async function check(manual = false) {
    if (checking) return checking;
    checking = (async () => {
      if (button) button.disabled = true;
      try {
        show('正在检查页面更新…');
        const {version} = await App.getInfo();
        const response = await fetch(UPDATE_MANIFEST + '?t=' + Date.now(), {cache:'no-store', signal:AbortSignal.timeout(15000)});
        if (!response.ok) throw Error('暂时无法检查更新，仍可继续阅读。');
        const update = validateUpdate(await response.json(), version);
        const {bundle} = await CapacitorUpdater.current();
        if (bundle.version === update.version) { show('页面已是最新版本。'); return; }
        const {bundles} = await CapacitorUpdater.list();
        const existing = bundles.find(b => b.version === update.version);
        if (existing?.status === 'error') throw Error('上次更新启动失败，已保留可用版本，等待修复。');
        const downloaded = existing || await CapacitorUpdater.download(update);
        await CapacitorUpdater.next({id:downloaded.id});
        show('新版页面已下载，下次打开 App 时生效。');
        if (manual) message('新版页面已下载，下次打开时生效。');
      } catch (error) {
        show(error.message || '更新失败，已保留当前版本。');
        if (manual) message(error.message || '更新失败，已保留当前版本。');
      } finally { if (button) button.disabled = false; checking = null; }
    })();
    return checking;
  }
  if (settings && button) {
    button.disabled = false;
    button.addEventListener('click', () => check(true));
  }
  // Multi-page navigation shares this session; avoid repeatedly downloading/checking on every page.
  if (!sessionStorage.getItem('pocket-update-checked')) {
    sessionStorage.setItem('pocket-update-checked','1');
    void check();
  } else show('页面会自动更新，也可以手动检查。');
}
