import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { prepareNativePage } from "./native-pages.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const native = process.argv.includes("--native"),
  reuse = process.argv.includes("--reuse-builds");
const out = path.join(root, native ? "_mobile" : "_site");
const apiUrl =
  process.env.POCKET_API_URL ||
  JSON.parse(await fs.readFile(path.join(root, "pocket.config.json"), "utf8"))
    .apiUrl;
const parsedApi = new URL(apiUrl);
if (
  parsedApi.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(parsedApi.hostname)
)
  throw Error("API requires HTTPS");
const safeApi = apiUrl
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;");
if (!reuse) {
  for (const app of ["ai-infra-board", "stockarena"])
    execFileSync("npm", ["run", "build"], {
      cwd: path.join(root, app),
      stdio: "inherit",
      env: {
        ...process.env,
        VITE_STATIC_DATA: "false",
        VITE_READER_SERVICE: "true",
        GITHUB_PAGES: "true",
      },
    });
}
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, "assets"), { recursive: true });
for (const file of ["index.html", "settings.html", "third-party.html", ".nojekyll"])
  await fs.copyFile(path.join(root, file), path.join(out, file));
await fs.cp(path.join(root, "nvidia-docs"), path.join(out, "nvidia-docs"), {
  recursive: true,
});
for (const app of ["ai-infra-board", "stockarena"])
  await fs.cp(path.join(root, app, "dist"), path.join(out, app), {
    recursive: true,
  });
await fs.mkdir(path.join(out, "shared"), { recursive: true });
for (const file of [
  "home.css",
  "mobile.css",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
])
  await fs.copyFile(
    path.join(root, "shared", file),
    path.join(out, "shared", file),
  );
await fs.copyFile(path.join(root,"node_modules/@capgo/capacitor-updater/LICENSE"),path.join(out,"shared/updater-license.txt"));
await build({
  entryPoints: [path.join(root, "shared/runtime.js")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["chrome110", "safari16"],
  outfile: path.join(out, "assets/pocket-runtime.js"),
  define: { __POCKET_NATIVE_BUILD__: String(native) },
});
async function files(dir) {
  return (
    await Promise.all(
      (await fs.readdir(dir, { withFileTypes: true })).map(async (e) =>
        e.isDirectory()
          ? files(path.join(dir, e.name))
          : [path.join(dir, e.name)],
      ),
    )
  ).flat();
}
const htmlFiles = (await files(out)).filter(f => f.endsWith(".html"));
const indexFiles = new Set(htmlFiles.map(f => path.relative(out, f).split(path.sep).join("/")).filter(f => f === "index.html" || f.endsWith("/index.html")));
for (const file of htmlFiles) {
  let html = await fs.readFile(file, "utf8");
  const relative = (path.relative(path.dirname(file), out) || ".")
    .split(path.sep)
    .join("/");
  html = html.replace(
    /<meta[^>]*name=["']viewport["'][^>]*>/i,
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  );
  html = html.replace(
    "</head>",
    `<meta name="pocket-api" content="${safeApi}"><meta name="theme-color" content="#f4f2e9"><link rel="stylesheet" href="${relative}/shared/mobile.css"><link rel="manifest" href="${relative}/manifest.webmanifest"><link rel="apple-touch-icon" href="${relative}/shared/icon-192.png"></head>`,
  );
  html = html.replace(
    "</body>",
    `<script defer data-pocket-runtime src="${relative}/assets/pocket-runtime.js"></script></body>`,
  );
  if (native) html = prepareNativePage(html, path.relative(out, file).split(path.sep).join("/"), indexFiles);
  await fs.writeFile(file, html);
}
await fs.writeFile(
  path.join(out, "manifest.webmanifest"),
  JSON.stringify({
    name: "Pocket Reader",
    short_name: "Pocket Reader",
    lang: "zh-CN",
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: "#f4f2e9",
    theme_color: "#f4f2e9",
    icons: [
      { src: "shared/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "shared/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  }),
);
// Never ship daily content in either artifact; the service is the source of truth.
await fs.rm(path.join(out, "ai-infra-board/data"), {
  recursive: true,
  force: true,
});
if (!native) {
  const shell = [
    "index.html",
    "settings.html",
    "shared/home.css",
    "shared/mobile.css",
    "shared/icon.svg",
    "assets/pocket-runtime.js",
  ];
  const revision = createHash("sha256");
  for (const file of shell)
    revision.update(await fs.readFile(path.join(out, file)));
  const version = "pocket-shell-" + revision.digest("hex").slice(0, 12);
  await fs.writeFile(
    path.join(out, "sw.js"),
    `const CACHE=${JSON.stringify(version)},SHELL=${JSON.stringify(shell)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pocket-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||!u.href.startsWith(self.registration.scope)||u.pathname.includes('/data/'))return;
e.respondWith((async()=>{const c=await caches.open(CACHE);try{const r=await fetch(e.request);if(r.ok){await c.put(e.request,r.clone());const keys=await c.keys();if(keys.length>120){const keep=new Set(SHELL.map(p=>new URL(p,self.registration.scope).href));const victim=keys.find(k=>!keep.has(k.url));if(victim)await c.delete(victim);}}return r;}catch{const saved=await c.match(e.request)||((u.pathname===new URL('./',self.registration.scope).pathname)?await c.match(new URL('index.html',self.registration.scope).href):null);return saved||new Response('This page is not cached. Reconnect to open it.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}})());});`,
  );
}
console.log(`Built ${native ? "native bundle" : "website"} at ${out}`);
