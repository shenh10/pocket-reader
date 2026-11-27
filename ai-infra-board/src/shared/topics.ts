/** Public topic content only. Editorial notes, local sources and paths stay offline. */
export interface TopicSummary {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  version: number;
  updatedAt: string;
  readingMinutes: number;
  relatedTopicIds: string[];
}

export interface TopicArticle extends TopicSummary {
  body: string;
  contentHash: string;
}

export const topicIdPattern = /^[a-z][a-z0-9-]{0,79}$/;

/** Explicit projections also protect against future store fields leaking publicly. */
export function topicSummary(topic: TopicSummary): TopicSummary {
  return {
    id: topic.id,
    title: topic.title,
    description: topic.description,
    category: topic.category,
    tags: [...topic.tags],
    version: topic.version,
    updatedAt: topic.updatedAt,
    readingMinutes: topic.readingMinutes,
    relatedTopicIds: [...topic.relatedTopicIds],
  };
}

export function topicArticle(topic: TopicArticle): TopicArticle {
  return { ...topicSummary(topic), body: topic.body, contentHash: topic.contentHash };
}
