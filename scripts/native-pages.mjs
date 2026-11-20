import path from 'node:path';

// Capacitor's bundled server treats extensionless paths as SPA routes and serves
// the root index.html. Directory navigation must name its actual HTML document.
export function prepareNativePage(html, relativeFile, indexFiles) {
  const page = new URL(relativeFile, 'https://bundle.invalid/');
  html = html.replace(/(<a\b[^>]*?\bhref\s*=\s*)(["'])([^"']*)\2/gi, (match, prefix, quote, href) => {
    if (!href || href.startsWith('#') || /^[a-z][\w+.-]*:|^\/\//i.test(href)) return match;
    let url;
    try { url = new URL(href.replaceAll('&amp;', '&'), page); } catch { return match; }
    const candidate = url.pathname.replace(/^\//, '').replace(/\/?$/, '/') + 'index.html';
    const target = url.pathname === '/' ? 'index.html' : candidate;
    if (!indexFiles.has(target)) return match;
    const relative = path.posix.relative(path.posix.dirname(relativeFile), target) || 'index.html';
    const rewritten = (relative + url.search + url.hash).replaceAll('&', '&amp;');
    return prefix + quote + rewritten + quote;
  });
  if (relativeFile === 'index.html') {
    // Old bookmarks, old APK notifications and updater path restoration can still
    // request a directory. This guard runs before the root page's relative assets.
    const directories = [...indexFiles].filter(f => f !== 'index.html').map(f => '/' + f.slice(0, -'index.html'.length));
    const script = `<script data-native-directory-redirect>(()=>{const u=new URL(location.href),p=u.pathname.endsWith('/')?u.pathname:u.pathname+'/';if(${JSON.stringify(directories)}.some(d=>p.endsWith(d))){u.pathname=p+'index.html';location.replace(u.href);}})();</script>`;
    html = html.replace(/<head>/i, '<head>' + script);
  }
  return html;
}
