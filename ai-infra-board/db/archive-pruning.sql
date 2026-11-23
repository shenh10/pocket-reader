-- Recoverable content removal, independent of collector/deep-dive versions.
CREATE TABLE IF NOT EXISTS reader_archive_pruned (
  repo_id BIGINT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  pr_id BIGINT NOT NULL,
  reason TEXT NOT NULL,
  selection_version TEXT NOT NULL,
  pr_record JSONB NOT NULL,
  user_state JSONB,
  analysis_job JSONB,
  pruned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_at TIMESTAMPTZ,
  PRIMARY KEY(repo_id, number)
);
ALTER TABLE reader_archive_pruned ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reader_archive_pruned FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON reader_archive_pruned FROM anon; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON reader_archive_pruned FROM authenticated; END IF;
END $$;

CREATE OR REPLACE FUNCTION reader_skip_pruned_reimport() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reader_archive_pruned p
    WHERE p.repo_id=NEW.repo_id AND p.number=NEW.number AND p.restored_at IS NULL)
  THEN RETURN NULL; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION reader_skip_pruned_reimport() FROM PUBLIC;
DROP TRIGGER IF EXISTS reader_skip_pruned_reimport ON pull_requests;
CREATE TRIGGER reader_skip_pruned_reimport BEFORE INSERT ON pull_requests
  FOR EACH ROW EXECUTE FUNCTION reader_skip_pruned_reimport();
