import { Children, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import DOMPurify from "dompurify";
import { ArrowUpRight, List, RefreshCw } from "lucide-react";
import { readService } from "../../../shared/service-client.js";
import { navigateTopic, topicHref, type Topic, type TopicSummary } from "./TopicLibrary";
import "katex/dist/katex.min.css";

/** Stable Unicode anchors shared by the TOC and rendered headings. */
export function headingSlug(value: string) {
  return value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/[\s_]+/g, "-") || "section";
}
function textContent(value: React.ReactNode): string {
  return Children.toArray(value).map(item => typeof item === "string" || typeof item === "number" ? String(item) : isValidElement<{ children?: React.ReactNode }>(item) ? textContent(item.props.children) : "").join("");
}
/** Published articles use TeX delimiters; keep fenced source code literal. */
export function prepareTopicMarkdown(markdown: string) {
  let fence = false, displayMath = false;
  const tex = (value: string) => value;
  return markdown.split("\n").map(line => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return line; }
    if (fence) return line;
    if (/^\s*\\{1,2}\[\s*$/.test(line)) { displayMath = true; return "$$"; }
    if (/^\s*\\{1,2}\]\s*$/.test(line)) { displayMath = false; return "$$"; }
    if (displayMath) return tex(line);
    return line.replace(/\\{1,2}\((.+?)\\{1,2}\)/g, (_all, math) => `$${tex(math)}$`);
  }).join("\n");
}
function MermaidDiagram({ source }: { source: string }) {
  const element = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true; setError(false);
    const id = `topic-diagram-${Math.random().toString(36).slice(2)}`;
    import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", htmlLabels: false, flowchart: { htmlLabels: false }, fontFamily: "Georgia, PingFang SC, serif", suppressErrorRendering: true });
      const diagramSource = window.matchMedia("(max-width: 720px)").matches ? source.replace(/^(flowchart|graph)\s+LR\b/, "$1 TD") : source;
      const { svg } = await mermaid.render(id, diagramSource);
      if (active && element.current) element.current.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["foreignObject", "script", "style"], FORBID_ATTR: ["onclick", "onload"] });
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [source]);
  return <figure className="topicDiagram"><div ref={element} role="img" aria-label="机制关系图" />{error && <p role="status">关系图暂时无法绘制，可展开查看文本。</p>}<details><summary>查看图示源文本</summary><pre><code>{source}</code></pre></details></figure>;
}
export function TopicMarkdown({ body }: { body: string }) {
  const markdown = useMemo(() => prepareTopicMarkdown(body), [body]);
  const occurrences = new Map<string, number>();
  const heading = (level: 1 | 2 | 3 | 4 | 5 | 6, children: React.ReactNode) => {
    const base = headingSlug(textContent(children)), count = occurrences.get(base) ?? 0;
    occurrences.set(base, count + 1);
    const id = count ? `${base}-${count}` : base;
    const Tag = `h${level}` as const;
    return <Tag id={id}><a className="topicHeadingAnchor" href={`#${id}`}>{children}</a></Tag>;
  };
  return <div className="topicProse"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, throwOnError: false, strict: false }]]} skipHtml components={{
    h1: ({ children }) => heading(1, children), h2: ({ children }) => heading(2, children), h3: ({ children }) => heading(3, children), h4: ({ children }) => heading(4, children), h5: ({ children }) => heading(5, children), h6: ({ children }) => heading(6, children),
    a: ({ href = "", children }) => {
      const legacy = href.match(/^#topic\/([a-z0-9-]+)(?:#(.*))?$/);
      let url: URL;
      try { url = new URL(href || "#", window.location.href); } catch { return <span>{children}</span>; }
      const internal = legacy?.[1] ?? (url.origin === window.location.origin && url.searchParams.get("view") === "topics" ? url.searchParams.get("topic") : null);
      if (internal && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(internal)) return <a href={topicHref(internal) + (legacy?.[2] ? `#${legacy[2]}` : url.hash)} onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault(); navigateTopic(internal);
        const hash = legacy?.[2] ? `#${legacy[2]}` : url.hash;
        if (hash) { history.replaceState(null, "", `${topicHref(internal)}${hash}`); window.dispatchEvent(new HashChangeEvent("hashchange")); }
      }}>{children}</a>;
      if (href.startsWith("#")) return <a href={href}>{children}</a>;
      if (!/^https?:\/\//i.test(href)) return <span>{children}</span>;
      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    },
    img: ({ alt }) => <span className="topicMediaPlaceholder">{alt || "图示"}</span>,
    pre: ({ children }) => {
      const code = Children.toArray(children)[0];
      if (isValidElement<{ className?: string; children?: React.ReactNode }>(code) && code.props.className?.includes("language-mermaid")) return <MermaidDiagram source={textContent(code.props.children).trim()} />;
      return <pre tabIndex={0}>{children}</pre>;
    },
    table: ({ children }) => <div className="topicTableScroll" tabIndex={0}><table>{children}</table></div>,
  }}>{markdown}</ReactMarkdown></div>;
}
export function TopicArticle({ id, topics }: { id: string; topics: TopicSummary[] }) {
  const [topic, setTopic] = useState<Topic | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState("");
  const article = useRef<HTMLElement>(null);
  const [toc, setToc] = useState<{ id: string; text: string; level: number }[]>([]);
  useEffect(() => {
    let active = true; setTopic(null); setError("");
    readService<{ topic: Topic }>(`topics/${id}`, { onStatus: s => active && setStatus(s) })
      .then(data => { if (active) setTopic(data.topic); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [id, retry]);
  useEffect(() => {
    if (!topic) return;
    setToc(Array.from(article.current?.querySelectorAll("h2,h3") ?? []).map(node => ({ id: node.id, text: node.textContent ?? "", level: Number(node.tagName[1]) })));
    const jump = () => { if (location.hash) { try { document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView(); } catch { /* invalid URI fragment */ } } };
    jump(); window.addEventListener("hashchange", jump); return () => window.removeEventListener("hashchange", jump);
  }, [topic]);
  if (error) return <div className="topicMessage" role="alert"><h2>暂时无法打开这篇专题</h2><p>{error}</p><button onClick={() => setRetry(v => v + 1)}><RefreshCw size={14} />重试</button></div>;
  if (!topic) return <p className="topicMessage" role="status">正在读取专题正文…</p>;
  const related = topic.relatedTopicIds.map(relatedId => topics.find(item => item.id === relatedId)).filter((item): item is TopicSummary => !!item);
  return <div className="topicReadingLayout">
    <aside className="topicContents"><details open><summary><List size={15} />文内目录</summary><nav aria-label="文内目录">{toc.map(item => <a key={item.id} className={item.level === 3 ? "topicContentsSub" : ""} href={`#${item.id}`}>{item.text}</a>)}</nav></details></aside>
    <article className="topicReading" ref={article}><header className="topicArticleMeta"><p className="topicEyebrow">{topic.category} · {topic.readingMinutes} 分钟</p><p>第 {topic.version} 版 · {new Date(topic.updatedAt).toLocaleDateString("zh-CN")}{status === "cached" ? " · 离线缓存" : ""}</p></header><TopicMarkdown body={topic.body} />
      {!!related.length && <footer className="topicRelated"><p className="topicEyebrow">CONTINUE READING</p><h2>沿着机制，继续读</h2>{related.map(item => <a key={item.id} href={topicHref(item.id)} onClick={event => { if (!event.metaKey && !event.ctrlKey) { event.preventDefault(); navigateTopic(item.id); } }}>{item.title}<ArrowUpRight size={17} /></a>)}</footer>}
      <p className="topicVersion">正文由服务更新 · 内容版本 {topic.contentHash.slice(0, 12)}</p>
    </article>
  </div>;
}
