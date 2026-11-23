export type CategoryKey =
  | "serving-runtime"
  | "kernels"
  | "distributed-moe"
  | "training-rl"
  | "reliability"
  | "docs-ci"
  | "project-meta";

export type ImportanceLevel = 1 | 2 | 3 | 4 | 5;

export interface RepositoryConfig {
  fullName: string;
  displayName: string;
  homepageUrl: string;
  description: string;
  importanceWeight: number;
}

export interface RepositoryRecord extends RepositoryConfig {
  id: number;
  owner: string;
  name: string;
  enabled: boolean;
}

export interface PullRequestEvaluation {
  motivation: string;
  previousBehavior: string;
  newBehavior: string;
  rationale: string;
  experiments: string;
}

export interface AnalysisClaim {
  text: string;
  evidenceIds: string[];
}

export interface AnalysisEvidence {
  id: string;
  kind: "description" | "diff" | "source";
  label: string;
  url: string;
}

export interface DeepDive {
  version: 1;
  generatedAt: string;
  generator: string;
  focus?: {
    architecture: number;
    performance: number;
    learning: number;
    evidence: number;
    kind: "mechanism" | "local-fix" | "maintenance";
    topic: string;
  };
  headSha: string;
  baseSha: string;
  summary: AnalysisClaim;
  problem: AnalysisClaim;
  before: AnalysisClaim;
  after: AnalysisClaim;
  tradeoff: AnalysisClaim;
  validation: AnalysisClaim;
  walkthrough: { evidenceId: string; excerpt: string; explanation: string };
  evidence: AnalysisEvidence[];
  coverage: { filesTotal: number; filesReviewed: number; notes: string[] };
}

export interface AnalysisProgress {
  total: number;
  completed: number;
  pending: number;
  processing: number;
  retrying: number;
  needsReview: number;
  lastPublishedAt: string | null;
}

export interface PullRequestRecord {
  id: number;
  repoId: number;
  repoFullName: string;
  repoDisplayName: string;
  number: number;
  githubId: number | null;
  title: string;
  body: string | null;
  url: string;
  author: string | null;
  authorAvatarUrl: string | null;
  mergedAt: string;
  createdAt: string | null;
  updatedAt: string | null;
  baseRef: string | null;
  headRef: string | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  labels: string[];
  category: CategoryKey;
  categoryLabel: string;
  importance: ImportanceLevel;
  importanceLabel: string;
  importanceReason: string;
  learningComment: string;
  evaluation: PullRequestEvaluation;
  deepDive?: DeepDive | null;
  isFavorite: boolean;
  isRead: boolean;
  watchLater: boolean;
  userNote: string;
}

export interface TimelineResponse {
  start: string;
  end: string;
  prs: PullRequestRecord[];
  stats: {
    total: number;
    days: number;
    byMonth: Record<string, number>;
  };
}

export interface AnnualHighlightRecord extends PullRequestRecord {
  highlightScore: number;
  highlightReason: string;
}

export interface AnnualHighlightsResponse {
  year: number;
  generatedAt: string;
  prs: AnnualHighlightRecord[];
}

export interface SnapshotSummary {
  date: string;
  fetchedAt: string;
  repoCount: number;
  prCount: number;
  status: string;
  error: string | null;
}

export interface DashboardResponse {
  date: string;
  snapshot: SnapshotSummary | null;
  prs: PullRequestRecord[];
  repos: RepositoryRecord[];
  stats: {
    total: number;
    unread: number;
    favorites: number;
    watchLater: number;
    byImportance: Record<string, number>;
    byCategory: Record<string, number>;
  };
}

export interface FetchDigestResponse {
  date: string;
  repoCount: number;
  prCount: number;
  fetchedAt: string;
  warnings: string[];
}

export interface FetchRangeResponse {
  start: string;
  end: string;
  repoCount: number;
  prCount: number;
  dayCount: number;
  fetchedAt: string;
  warnings: string[];
}

export interface StaticDataset {
  /** Version 2 loads daily data on demand instead of downloading the whole archive. */
  dashboardFiles?: Record<string, string>;
  generatedAt: string;
  defaultDate: string;
  days: SnapshotSummary[];
  dashboards: Record<string, DashboardResponse>;
  timeline: TimelineResponse;
  highlights: Record<string, AnnualHighlightsResponse>;
}
