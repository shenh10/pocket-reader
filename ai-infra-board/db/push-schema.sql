-- Push capabilities and tokens are private; never expose these through PostgREST.
CREATE SCHEMA IF NOT EXISTS pocket_private;
REVOKE ALL ON SCHEMA pocket_private FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS pocket_private.devices (
  id UUID PRIMARY KEY,
  capability_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('jpush','apns')),
  token TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('production','development')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, token, environment)
);
CREATE TABLE IF NOT EXISTS pocket_private.deliveries (
  id UUID PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES pocket_private.devices(id) ON DELETE CASCADE,
  digest_date DATE NOT NULL,
  pr_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  lease UUID,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  provider_message_id TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  UNIQUE(device_id,digest_date)
);
CREATE INDEX IF NOT EXISTS deliveries_pending ON pocket_private.deliveries(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS pocket_private.registration_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA pocket_private FROM PUBLIC, anon, authenticated, service_role;

-- The collector/API role can access only the tables needed for subscriptions and delivery.
GRANT USAGE ON SCHEMA pocket_private TO aiinfra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pocket_private TO aiinfra_app;
