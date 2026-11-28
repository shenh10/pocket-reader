# SGLang HiCache official documentation digest

- Topic: `sglang-hicache-tutorial`, version 1.
- Snapshot: 2026-11-28; official HiCache landing page and its three child pages (design, best practices, runtime attach/detach). Source URLs, retrieval hashes, upstream commit and excerpt hashes are recorded in `hicache-source-record.json`.
- Chinese abridged translation with 18 chapters, 12 official fences (including the original Mermaid sharing-scope diagram), and four directly embedded official figures. The benchmark blog is briefly summarized with its date, workload/hardware context and original figure links.
- Ten fences preserve their source bodies exactly. Two shell examples have explicitly documented formatting repairs: move an inline comment away from a continuation backslash, and remove a final dangling continuation backslash. All selected shell snippets pass `bash -n`; the timeout formula passes Python AST parsing.
- Preserve key limitations: instance-private L2, L3 staging headroom, per-rank GB sizing, hybrid-model state pool eviction, timeout cap, TP synchronization, backend/layout compatibility, DP partial attach without rollback, admin-key requirement, and external router layout eligibility.
- No GPU deployment or benchmark was executed. Upstream Apache-2.0 license retained as `SGLang-LICENSE-APACHE.txt`; modified text and source attribution are identified in the article.

## Validation

The ten-article bundle passed the existing publishing validator (schema, public-only content, related-topic references and SHA256). The proposed article was previewed in the deployed reader at widths 390 and 1440: all four images loaded, all 18 chapters rendered, the Mermaid diagram rendered, no page exceptions, math errors or horizontal overflow. Visual inspection identified black subgraph backgrounds caused by stripping embedded SVG styles; a targeted `.cluster rect` CSS rule restores readable fills without changing the official diagram source.
