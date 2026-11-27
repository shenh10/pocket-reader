# Mooncake official documentation digest: source and validation record

## Current revision: v2

The user requested closer fidelity to the original documentation and less independently authored explanation. Version 2 replaces the previous tutorial with a Chinese abridged translation of the official material, using the same topic ID and URL.

- Source snapshot: `da2d74d84b67acff423d0633115fa7b3d051e8d8`, observed 2026-11-27.
- 25 chapters, each with nearby original-document links.
- 17 verbatim upstream fences (16 code/configuration examples and one HA sequence diagram); source paths, line numbers and hashes are recorded in `mooncake-v2-excerpts.json`.
- Seven original figure references with explicit links. Pocket Reader currently renders external image Markdown as an alt-text placeholder, so each reference also provides an actionable link to the official image. The standalone HTML includes those original figures.
- All nine original vLLM P/D benchmark data rows retained; only the header translated.
- Removed the independently authored KV size derivation, hypothetical transfer estimate, custom deployment recipes and production acceptance roadmap.
- Restored details from the original HiCache design: continuous prefix matching, prefetch trigger and timeout formula, two-thread pipeline, write policies, TP min reductions, page-first-direct layout, batch limits, overlap and MLA write-back behavior.
- Restored Store allocator/placement details, object groups, quota semantics and the fuller HA recovery contract.
- Clearly labeled editorial notes only for original-source inconsistencies or omitted prerequisites (metadata deployment, upsert wording, BufferPool view lifetime and StoreConnector dependencies).
- Original code and figures are attributed to the upstream project. A copy of `LICENSE-APACHE` is retained as `Mooncake-LICENSE-APACHE.txt`.

## Validation

The complete publication bundle passes the existing publisher's schema, safe-content, reference and SHA256 validation. Bash/shell fences pass syntax parsing; Python examples pass AST parsing; JSON configuration parses. Excerpt contents are extracted without edits and recorded by hash.

The proposed v2 article was checked using the actual deployed renderer with the topics response substituted by the proposed bundle: desktop 1440x1000 and mobile 390x844, 25 chapters, one upstream Mermaid SVG, 15 tables, no page errors, no math errors and no document-level horizontal overflow. Source page links were checked against the 142-page crawl inventory. Figure URLs were resolved from the actual rendered official pages, including Sphinx's `_images/` output paths.

No Linux/GPU/RDMA deployment or benchmark was executed for this documentation translation. Performance claims remain attributed to the original measurements and their environments. The 142-page inventory records discovery, not a claim of line-by-line translation of every page.

## Previous revision: v1

The original independently structured Chinese tutorial was published with body SHA256 `d3f549983d2a06417906472907ce426ac81de0440cdc2f6097668b77a52fc424`. It included 26 chapters, custom examples and explanatory estimates. The user requested the source-faithful revision above; the previous text remains recoverable in Git history.

## v2 publication

Updated only `mooncake-complete-tutorial` to version 2; the other eight rows were unchanged. Published content SHA256: `9cb88f97e82395381f3b652e2e035498747c2295421ab4a6325966a6eb4645b5`.
