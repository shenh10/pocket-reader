import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, RefreshCw } from "lucide-react";
import { readService } from "../../../shared/service-client.js";
import { TopicArticle } from "./TopicArticle";
import "./topic-styles.css";

export interface TopicSummary {
  id: string; title: string; description: string; category: string; tags: string[];
  version: number; updatedAt: string; readingMinutes: number; relatedTopicIds: string[];
}
export interface Topic extends TopicSummary { body: string; contentHash: string }
export function topicHref(id?: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", "topics");
  if (id) url.searchParams.set("topic", id); else url.searchParams.delete("topic");
  url.hash = "";
  return `${url.pathname}${url.search}`;
}
export function navigateTopic(id?: string) {
  window.history.pushState(null, "", topicHref(id));
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}
function selectedTopic() { return new URLSearchParams(window.location.search).get("topic"); }
export function TopicLibrary() {
  const [id, setId] = useState(selectedTopic);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => { const sync = () => setId(selectedTopic()); window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync); }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    readService<{ topics: TopicSummary[] }>("topics", { onStatus: s => active && setStatus(s) })
      .then(data => { if (active) setTopics(data.topics); })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  const visible = topics.filter(topic => `${topic.title} ${topic.description} ${topic.tags.join(" ")}`.toLowerCase().includes(filter.toLowerCase()));
  return <section className="topicSurface" aria-label="知识专题">
    {id ? <>
      <a className="topicBack" href={topicHref()} onClick={e => { e.preventDefault(); navigateTopic(); }}><ArrowLeft size={15} />专题目录</a>
      <TopicArticle key={id} id={id} topics={topics} />
    </> : <>
      <header className="topicLibraryHeading"><div><p className="topicEyebrow">THE KNOWLEDGE LIBRARY</p><h1>从改动，读到机制。</h1><p>围绕推理框架与 HPC 的技术命题，把相关实现连成可以反复查阅的知识。</p></div><BookOpen size={36} strokeWidth={1.2} /></header>
      <div className="topicLibraryTools"><label>检索专题<input type="search" placeholder="状态布局、并行、数值、通信…" value={filter} onChange={e => setFilter(e.target.value)} /></label><span>{loading ? "正在读取目录" : `${visible.length} 篇专题`}{status === "cached" ? " · 离线缓存" : ""}</span></div>
      {loading && <p className="topicMessage" role="status">正在读取专题目录…</p>}
      {error && <div className="topicMessage" role="alert"><p>{error}</p><button onClick={() => setRetry(v => v + 1)}><RefreshCw size={14} />重新加载</button></div>}
      {!loading && !error && !visible.length && <p className="topicMessage">{filter ? "没有匹配的专题，试试另一种机制或关键词。" : "专题尚未上架。"}</p>}
      <div className="topicIndex">{visible.map((topic, index) => <a key={topic.id} className="topicIndexEntry" href={topicHref(topic.id)} onClick={e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); navigateTopic(topic.id); } }}>
        <span className="topicNumber">{String(index + 1).padStart(2, "0")}</span><div><p className="topicCategory">{topic.category} <span>· {topic.readingMinutes} 分钟</span></p><h2>{topic.title}</h2><p className="topicDescription">{topic.description}</p><div className="topicTags">{topic.tags.map(tag => <span key={tag}>{tag}</span>)}</div></div><ArrowUpRight className="topicEntryArrow" size={22} />
      </a>)}</div>
    </>}
  </section>;
}
