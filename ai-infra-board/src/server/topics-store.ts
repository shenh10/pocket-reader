import type { TopicArticle, TopicSummary } from "../shared/topics";
import { topicIdPattern, topicSummary } from "../shared/topics";

export interface TopicsStore {
  topics(): Promise<TopicSummary[]>;
  topic(id: string): Promise<TopicArticle | null>;
}

interface TopicRow {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  version: number;
  updated_at: Date | string;
  reading_minutes: number;
  related_topic_ids: string[];
  body?: string;
  content_hash?: string;
}

export interface TopicsQuery {
  query(sql: string, values?: string[]): Promise<{ rows: TopicRow[] }>;
}

const summaryColumns = `id, title, description, category, tags, version,
  updated_at, reading_minutes, related_topic_ids`;

function summary(row: TopicRow): TopicSummary {
  return topicSummary({
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    tags: row.tags,
    version: row.version,
    updatedAt: new Date(row.updated_at).toISOString(),
    readingMinutes: row.reading_minutes,
    relatedTopicIds: row.related_topic_ids,
  });
}

/** No write methods: public handlers can only read already-published articles. */
export function createTopicsStore(db: TopicsQuery): TopicsStore {
  return {
    async topics() {
      const { rows } = await db.query(`SELECT ${summaryColumns}
        FROM public.reader_topics
        WHERE published_at IS NOT NULL AND published_at <= now()
        ORDER BY published_at DESC, id ASC`);
      return rows.map(summary);
    },
    async topic(id) {
      if (!topicIdPattern.test(id)) return null;
      const { rows } = await db.query(`SELECT ${summaryColumns}, body, content_hash
        FROM public.reader_topics
        WHERE id = $1 AND published_at IS NOT NULL AND published_at <= now()`, [id]);
      const row = rows[0];
      return row ? { ...summary(row), body: row.body!, contentHash: row.content_hash! } : null;
    },
  };
}
