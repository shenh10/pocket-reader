import assert from "node:assert/strict";
import test from "node:test";
import { selectEvidenceDiffs } from "../src/server/deep-dive-evidence";

test("current implementation precedes large deleted copies during a source migration", () => {
  const removed = Array.from({length: 7}, (_, i) => ({filename: `old/copy${i}.py`, status: "removed", changes: 5000, patch: "-old\n".repeat(5000)}));
  const current = {filename: "kernels/current.py", status: "renamed", changes: 80, patch: "+new implementation\n"};
  const selected = selectEvidenceDiffs([...removed, current]);
  assert.equal(selected[0].file, current);
  assert.ok(selected.some(({file}) => file.status === "removed"));
});

test("every selected diff, including the regression test, survives the total budget", () => {
  const runtime = Array.from({length: 7}, (_, i) => ({filename: `src/kernel${i}.py`, status: "modified", changes: 1000 - i, patch: "+runtime\n".repeat(3000)}));
  const regression = {filename: "tests/regression.py", status: "added", changes: 1, patch: "+assert result == expected\n"};
  const selected = selectEvidenceDiffs([...runtime, regression]);
  assert.equal(selected.length, 8);
  assert.ok(selected.every(({patch}) => patch.length > 0 && patch.length <= 12000));
  assert.ok(selected.reduce((total, {patch}) => total + patch.length, 0) <= 60000);
  assert.equal(selected.find(({file}) => file === regression)?.patch, regression.patch);
});

test("maintenance-only diffs remain readable and patchless changes are not invented", () => {
  const docs = {filename: "README.md", status: "modified", changes: 1, patch: "+documentation\n"};
  assert.deepEqual(selectEvidenceDiffs([{filename: "binary.dat", status: "added", changes: 50}, docs]), [{file: docs, patch: docs.patch}]);
  assert.deepEqual(selectEvidenceDiffs([]), []);
});

test("a large diff retains its final changes instead of only its introduction", () => {
  const patch = "@@ -1 +1 @@\n+new header\n" + "+large body\n".repeat(4000)
    + "@@ -8000 +8000 @@\n+publish_next_epoch();\n";
  const [selected] = selectEvidenceDiffs([{filename: "src/kernel.py", status: "modified", changes: 4000, patch}]);
  assert.ok(selected.patch.startsWith("@@ -1 +1 @@\n+new header\n"));
  assert.ok(selected.patch.endsWith("@@ -8000 +8000 @@\n+publish_next_epoch();\n"));
  assert.ok(selected.patch.includes("[truncated middle of diff]"));
  assert.equal(selected.patch.length, 12000);
});
