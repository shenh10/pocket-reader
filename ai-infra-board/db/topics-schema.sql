-- Dedicated public-content storage. Does not alter PRs, editorial data or user state.
CREATE TABLE IF NOT EXISTS public.reader_topics (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{0,79}$'),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 4000),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 100),
  tags TEXT[] NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL CHECK (version > 0),
  reading_minutes INTEGER NOT NULL CHECK (reading_minutes BETWEEN 1 AND 10000),
  related_topic_ids TEXT[] NOT NULL DEFAULT '{}',
  body TEXT NOT NULL CHECK (length(body) > 0),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS reader_topics_published ON public.reader_topics(published_at DESC, id);
ALTER TABLE public.reader_topics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reader_topics FROM PUBLIC;
-- Supabase roles may not exist in local development PostgreSQL.
DO $topics$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.reader_topics FROM %I', role_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aiinfra_app') THEN
    -- Existing installations use the same SQL role for collection and Edge.
    -- Preserve the table owner's import privileges; restrict a separate Edge
    -- role to SELECT when the migration is run by another owner/admin.
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
      WHERE c.oid = 'public.reader_topics'::regclass AND r.rolname = 'aiinfra_app'
    ) THEN
      REVOKE ALL ON TABLE public.reader_topics FROM aiinfra_app;
      GRANT SELECT ON TABLE public.reader_topics TO aiinfra_app;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public'
        AND tablename = 'reader_topics' AND policyname = 'reader_topics_edge_read'
    ) THEN
      CREATE POLICY reader_topics_edge_read ON public.reader_topics FOR SELECT
        TO aiinfra_app USING (published_at IS NOT NULL AND published_at <= now());
    END IF;
  END IF;
END
$topics$;
