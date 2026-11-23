import type { PullRequestRecord } from "./types";

// Editorial scores require a reviewed mechanism, not keyword-based PR importance.
export function learningScore(pr: PullRequestRecord): number {
  const focus = pr.deepDive?.focus;
  if (!focus || focus.kind !== "mechanism" || focus.learning < 4 || focus.evidence < 3
    || Math.max(focus.architecture, focus.performance) < 4) return 0;
  return focus.learning * 4 + Math.max(focus.architecture, focus.performance) * 3 + focus.evidence;
}

export function dailyLearningPicks<T extends PullRequestRecord>(prs: T[]): T[] {
  const topics = new Set<string>();
  return prs.filter(pr => learningScore(pr) > 0)
    .sort((a, b) => learningScore(b) - learningScore(a) || b.mergedAt.localeCompare(a.mergedAt) || a.id - b.id)
    .filter(pr => {
      const topic = pr.deepDive!.focus!.topic.trim().toLowerCase();
      if (topics.has(topic)) return false;
      topics.add(topic);
      return true;
    }).slice(0, 3);
}
