import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const mobile = url.pathname.startsWith("/native/");
    const prefix = mobile ? "/native/" : "/pocket-reader/";
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    const root = path.resolve(mobile ? "_mobile" : "_site");
    let file = path.resolve(
      root,
      decodeURIComponent(url.pathname.slice(prefix.length)) || ".",
    );
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await fs.stat(file)).isDirectory())
        file = path.join(file, "index.html");
      res.setHeader(
        "Content-Type",
        mime[path.extname(file)] || "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-store");
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404).end("Not found");
    }
  })
  .listen(4173, "127.0.0.1", () =>
    console.log("Preview: http://127.0.0.1:4173/pocket-reader/"),
  );
