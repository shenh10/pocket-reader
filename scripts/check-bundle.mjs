import fs from "node:fs/promises";
import assert from "node:assert/strict";
for (const root of ["_mobile", "_site"]) {
  const html = await fs.readFile(root + "/index.html", "utf8");
  assert.match(html, /name="pocket-api"/);
  await assert.rejects(fs.access(root + "/ai-infra-board/data"));
  console.log(root + ": API configured; no packaged reports");
}
