import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source');
if (sourceIndex < 0 || !args[sourceIndex + 1]) throw Error('Use --source /path/to/knowledge-topics');
const source = path.resolve(args[sourceIndex + 1]);
const sha = value => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(await fs.readFile(path.join(source, 'final-review/manifest.json'), 'utf8'));
const editions = [
  ['kimi-hybrid-capabilities', '模型架构', ['Kimi-K3', 'LatentMoE', 'AttnRes'], '沿状态增长轴与表示空间，理解 Kimi-K3 对缓存、并行与执行路径的要求。', ['kda-state-layout', 'residual-mixing', 'moe-working-set']],
  ['deepseek-multiscale-memory', '模型架构', ['DeepSeek-V4', 'KV cache', '稀疏注意力'], '压缩、选择与物化缩小的是不同集合：从 C4/C128 机制走到真实页布局与共享读取。', ['effective-work-domain', 'evaluation-invariance']],
  ['kda-state-layout', '推理状态', ['KDA', '投机解码', 'Tensor Core'], '从接受前缀的恢复等式，比较完整快照、恢复记录与重算的容量和执行代价。', ['kimi-hybrid-capabilities', 'evaluation-invariance', 'gpu-handoff-order']],
  ['effective-work-domain', '推理状态', ['KV 生命周期', '滑动窗口', '投机解码'], '把当前读域、允许未来与计算依赖分开，推导需要计算和保留的真正工作集。', ['deepseek-multiscale-memory', 'gpu-handoff-order']],
  ['gpu-handoff-order', 'GPU 执行', ['TMA', '同步', '流水线'], '从本代数据可见到下一代覆盖许可，理解 full/empty、异步代理与执行进度。', ['kda-state-layout', 'effective-work-domain']],
  ['moe-working-set', '稀疏计算', ['MoE', '量化', 'GEMM'], '相同的不同专家数，为什么仍有不同 GEMM 组数？分别计算物化、分组与预留容量。', ['kimi-hybrid-capabilities', 'evaluation-invariance']],
  ['evaluation-invariance', '数值与执行', ['Batch invariance', 'Split-K', 'KDA'], '保留数值分段、舍入和状态边界，同时释放物理调度与临时存储的选择。', ['moe-working-set', 'kda-state-layout', 'residual-mixing']],
  ['residual-mixing', '模型架构', ['AttnRes', 'mHC', '残差混合'], '对照可重新选择的历史与固定宽 streams，分析信息保留、约束边界和扫描成本。', ['kimi-hybrid-capabilities', 'evaluation-invariance']],
];
const approved = new Map(manifest.articles.map(item => [item.id, item]));
const ids = new Set(editions.map(e => e[0]));
const evidenceDirectory = path.join(root, 'docs/topic-evidence');
await fs.mkdir(evidenceDirectory, { recursive: true });
const evidence = new Map();
const changes = [];

async function rewriteLinks(text, owner, origin) {
  const matches = [...text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
  for (const match of matches.reverse()) {
    const [whole, label, target] = match;
    if (/^https?:\/\//.test(target) || target.startsWith('#')) continue;
    const absolute = path.resolve(path.dirname(origin), target.split('#')[0]);
    if (!absolute.startsWith(source + path.sep)) throw Error('Reference escaped the reviewed source directory');
    const relative = path.relative(source, absolute).split(path.sep).join('/');
    const article = relative.match(/^drafts\/([^/]+)\/article\.md$/);
    let replacement;
    if (article && ids.has(article[1])) {
      replacement = `[${label}](?view=topics&topic=${article[1]})`;
    } else {
      let entry = evidence.get(absolute);
      if (!entry) {
        const original = await fs.readFile(absolute, 'utf8');
        const name = `${owner}-${sha(relative).slice(0, 10)}${path.extname(absolute)}`;
        entry = { name, original, sourceRelative: relative };
        evidence.set(absolute, entry);
        // The research documents are appendices on GitHub, not scripts executed
        // by the reader. Flatten private relative references to plain labels.
        const publicText = original
          .replace(/\[([^\]]+)\]\((?!https?:\/\/|#)[^)]+\)/g, '$1')
          .replace(/\/Users\/[^\s`"'<>]+/g, '[本地研究路径]')
          .replace(/(?:当前)?(?:本地)?(?:待审)?(?:专题)?(?:草稿)?[，；]?尚未(?:发布|部署)[^。\n]*[。]?/g, '');
        await fs.writeFile(path.join(evidenceDirectory, name), publicText);
      }
      const url = `https://github.com/shenh10/pocket-reader/blob/main/docs/topic-evidence/${entry.name}`;
      replacement = `[${label}（研究记录）](${url})`;
    }
    text = text.slice(0, match.index) + replacement + text.slice(match.index + whole.length);
  }
  return text;
}

const topics = [];
for (const [id, category, tags, description, relatedTopicIds] of editions) {
  const record = approved.get(id);
  if (!record?.localContentApproved) throw Error(`Topic not approved: ${id}`);
  const dir = path.join(source, 'drafts', id);
  const original = await fs.readFile(path.join(dir, 'article.md'), 'utf8');
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'metadata.json'), 'utf8'));
  if (sha(original) !== record.articleSha256 || meta.articleSha256 !== record.articleSha256 || !meta.qualityGate.approved)
    throw Error(`Reviewed version mismatch: ${id}`);
  let body = await rewriteLinks(original, id, path.join(dir, 'article.md'));
  // Publication changes only links and outdated workflow-status sentences.
  // Scientific uncertainty and experimental limitations remain in the text.
  for (const old of [
    '当前为本地可审阅稿，尚未接入线上专题阅读页。',
    '本文是本地待审专题，未部署到服务端，也不宣称已通过全部统一质量要求。',
    '当前为本地待审专题，未部署，也不宣称五篇已全部通过统一质量要求。',
    '本地专题草稿，尚未发布到服务端专题栏目。',
    '它是本地可审阅专题，尚未发布到 Pocket Reader 服务。',
    '本文为本地专题内容，尚未部署线上。',
    '本篇为本地可审阅内容，尚未部署线上。',
    '尚未部署到线上专题服务。',
  ]) body = body.replace(old, '');
  body = body.trim() + '\n';
  if (/\/Users\/|\]\((?:\.\.?\/|[a-z-]+\/)/.test(body)) throw Error(`Unpublished reference in ${id}`);
  const updatedAt = meta.updatedAt || meta.generatedAt;
  if (!Number.isFinite(Date.parse(updatedAt))) throw Error(`Missing article date: ${id}`);
  topics.push({ id, title: meta.title, description, category, tags, version: meta.version,
    updatedAt, readingMinutes: Math.max(5, Math.ceil(original.length / 700)), relatedTopicIds,
    body, contentHash: sha(body) });
  changes.push({ id, reviewedArticleHash: record.articleSha256, publishedContentHash: sha(body),
    changes: ['Public topic/evidence links', 'Removed obsolete local-draft publication-status sentence'] });
}
await fs.mkdir(path.join(root, 'content/topics'), { recursive: true });
await fs.writeFile(path.join(root, 'content/topics/publication.json'), JSON.stringify({ topics }, null, 2) + '\n');
await fs.writeFile(path.join(root, 'content/topics/reviewed-sources.json'), JSON.stringify({
  purpose: 'Reproducible reviewed content input for the server importer; excluded from web/mobile build outputs.',
  articles: changes, evidence: [...evidence.values()].map(e => ({ source: e.sourceRelative, file: e.name, sha256: sha(e.original) })),
}, null, 2) + '\n');
console.log(`Prepared ${topics.length} reviewed topics and ${evidence.size} public research references; no database writes.`);
