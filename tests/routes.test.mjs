import test from "node:test";
import assert from "node:assert/strict";
import { routeFromLink, publishedUrl, PUBLIC_SITE } from "../shared/routes.js";
for (const base of [
  "https://localhost/",
  "capacitor://localhost/",
  "https://example.org/pocket-reader/",
]) {
  test(`notification links preserve date and local origin: ${base}`, () => {
    assert.equal(
      routeFromLink("pocketreader://daily?date=2026-11-20", base),
      new URL("ai-infra-board/?date=2026-11-20", base).href,
    );
    assert.equal(
      routeFromLink(
        PUBLIC_SITE + "nvidia-docs/kernels/execution-path.html#timing",
        base,
      ),
      new URL("nvidia-docs/kernels/execution-path.html#timing", base).href,
    );
    assert.equal(
      publishedUrl(new URL("ai-infra-board/?date=2026-11-20", base).href, base),
      PUBLIC_SITE + "ai-infra-board/?date=2026-11-20",
    );
  });
}
test("untrusted notification URLs cannot leave the bundled site or inject a query", () => {
  for (const value of [
    "javascript:alert(1)",
    "https://evil.example/pocket-reader/",
    "https://shenhan.cc/pocket-reader/../secret",
    "https://shenhan.cc/pocket-reader/not-an-app/",
    "pocketreader://unknown",
  ])
    assert.equal(routeFromLink(value, "https://localhost/"), null, value);
  assert.equal(
    routeFromLink(
      "pocketreader://daily?date=garbage&next=https://evil.example",
      "https://localhost/",
    ),
    "https://localhost/ai-infra-board/",
  );
});
