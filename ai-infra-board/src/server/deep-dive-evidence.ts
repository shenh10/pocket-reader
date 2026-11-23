import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { EvidencePacket } from "./deep-dive";

interface ChangedFile { filename: string; previous_filename?: string; status: string; patch?: string; changes: number }
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const codeFile = (file: ChangedFile) => !/(^|\/)(vendor|node_modules|dist)\//.test(file.filename)
  && !/(\.lock|lock\.json|\.md|\.rst|\.svg|\.ipynb|\.csv)$/i.test(file.filename);

export async function fetchEvidence(repo: string, number: number): Promise<EvidencePacket> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !Number.isSafeInteger(number) || number < 1) throw new Error("Invalid PR identity");
  let token = process.env.GITHUB_TOKEN;
  if (!token) {
    try { token = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { /* Public repositories also allow unauthenticated reads, within rate limits. */ }
  }
  const get = async (route: string) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${route}`, {
      signal: AbortSignal.timeout(30000),
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    if (!response.ok) throw new Error(`GitHub evidence HTTP ${response.status}`);
    return response.json() as Promise<any>;
  };
  const pr = await get(`pulls/${number}`);
  if (!pr.merged_at || !/^[a-f0-9]{40}$/.test(pr.head?.sha) || !/^[a-f0-9]{40}$/.test(pr.base?.sha)) throw new Error("Merged PR with immutable revisions required");
  const files: ChangedFile[] = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await get(`pulls/${number}/files?per_page=100&page=${page}`) as ChangedFile[];
    files.push(...batch);
    if (batch.length < 100) break;
  }
  if (files.length !== pr.changed_files) throw new Error("Incomplete GitHub file list; refusing analysis");
  const packet: EvidencePacket = {
    repo, number, title: pr.title, headSha: pr.head.sha, baseSha: pr.base.sha,
    evidence: [{ id: "P1", kind: "description", label: "PR 作者说明（未独立复现）", url: `https://github.com/${repo}/pull/${number}`, content: (pr.body || "PR 未提供正文").slice(0, 18000) }],
    coverage: { filesTotal: files.length, filesReviewed: 0, notes: [] }
  };
  if (pr.body?.length > 18000) packet.coverage.notes.push("PR 正文仅读取前 18000 字符。");
  // Every archive item is eligible, including documentation, CI and dependencies.
  // Prefer executable changes, then fall back to the actual textual maintenance diff.
  const candidates = files.filter(file => file.patch)
    .sort((a, b) => Number(codeFile(b)) - Number(codeFile(a)) || b.changes - a.changes);
  // Preserve at least one regression-test diff even when production changes dominate.
  const test = candidates.find(file => /(^|\/)(test[s_]?|.*_test\.)/i.test(file.filename));
  const selected = [...new Set([...candidates.slice(0, 7), ...(test ? [test] : [])])];
  let budget = 60000;
  for (const [index, file] of selected.entries()) {
    const patch = file.patch!.slice(0, Math.min(12000, budget));
    if (!patch) continue;
    budget -= patch.length;
    const id = `D${index + 1}`;
    packet.evidence.push({ id, kind: "diff", label: file.filename,
      url: `https://github.com/${repo}/pull/${number}/files#diff-${createHash("sha256").update(file.filename).digest("hex")}`, content: patch });
    packet.coverage.filesReviewed++;
    if (patch.length !== file.patch!.length) packet.coverage.notes.push(`${file.filename} 的 diff 因上下文预算截断。`);
    if (index >= 3) continue;
    // Anchor before/after context to immutable revisions; never read default-branch HEAD.
    const hunk = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(patch);
    if (!hunk) continue;
    for (const side of ["before", "after"] as const) {
      if ((side === "before" && file.status === "added") || (side === "after" && file.status === "removed")) continue;
      const sha = side === "before" ? packet.baseSha : packet.headSha;
      const path = side === "before" ? file.previous_filename || file.filename : file.filename;
      try {
        const source = await get(`contents/${encodePath(path)}?ref=${sha}`);
        if (source.encoding !== "base64" || typeof source.content !== "string") throw new Error("Source too large");
        const lines = Buffer.from(source.content, "base64").toString("utf8").split("\n");
        const start = Math.max(0, Number(hunk[side === "before" ? 1 : 2]) - 30);
        const content = lines.slice(start, start + 110).join("\n").slice(0, 8000);
        packet.evidence.push({ id: `${id}-${side}`, kind: "source", label: `${path} · ${side}`,
          url: `https://github.com/${repo}/blob/${sha}/${encodePath(path)}#L${start + 1}`, content });
      } catch { packet.coverage.notes.push(`${path} 的 ${side} 上下文未获取；仅依据 diff。`); }
    }
  }
  if (!packet.coverage.filesReviewed) throw new Error("No textual diff available; requires manual source review");
  if (packet.coverage.filesReviewed < files.length) packet.coverage.notes.push(`只分析了 ${packet.coverage.filesReviewed}/${files.length} 个文件的可用代码 diff；其余未审阅。`);
  packet.coverage.notes.push("未在本地执行上游测试或 benchmark；实验结论需区分作者报告与代码推论。");
  return packet;
}
