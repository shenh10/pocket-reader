CREATE TABLE IF NOT EXISTS repositories (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  homepage_url TEXT,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  importance_weight INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_snapshots (
  snapshot_date DATE PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'ok',
  repo_count INTEGER NOT NULL DEFAULT 0,
  pr_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error TEXT
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id BIGSERIAL PRIMARY KEY,
  repo_id BIGINT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL REFERENCES daily_snapshots(snapshot_date) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  github_id BIGINT,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT NOT NULL,
  api_url TEXT,
  author TEXT,
  author_avatar_url TEXT,
  merged_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  base_ref TEXT,
  head_ref TEXT,
  merge_commit_sha TEXT,
  additions INTEGER,
  deletions INTEGER,
  changed_files INTEGER,
  labels TEXT[] NOT NULL DEFAULT '{}',
  category TEXT NOT NULL,
  importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
  importance_reason TEXT NOT NULL,
  learning_comment TEXT NOT NULL,
  motivation TEXT NOT NULL DEFAULT '',
  previous_behavior TEXT NOT NULL DEFAULT '',
  new_behavior TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  experiment_effect TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo_id, number)
);

ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS motivation TEXT NOT NULL DEFAULT '';
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS previous_behavior TEXT NOT NULL DEFAULT '';
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS new_behavior TEXT NOT NULL DEFAULT '';
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS rationale TEXT NOT NULL DEFAULT '';
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS experiment_effect TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pull_requests_snapshot_importance
  ON pull_requests (snapshot_date, importance DESC, merged_at DESC);

CREATE INDEX IF NOT EXISTS idx_pull_requests_category
  ON pull_requests (category);

CREATE TABLE IF NOT EXISTS pr_user_state (
  pr_id BIGINT PRIMARY KEY REFERENCES pull_requests(id) ON DELETE CASCADE,
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  is_read BOOLEAN NOT NULL DEFAULT false,
  watch_later BOOLEAN NOT NULL DEFAULT false,
  user_note TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Collector upserts deliberately leave independent, evidence-backed analyses intact.
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS deep_dive JSONB;
