-- Supervised launch preparation: operator lead management + location analysis cache
--
-- 1. ops_tasks: add follow_up_at and attachment_refs columns for richer operator workflow
-- 2. location_analysis_cache: Supabase-backed cache for deterministic location scores
--    Replaces any per-serverless-instance in-memory caching; shared across all
--    Vercel deployments. TTL enforced by application logic (24h).

-- ─── ops_tasks: operator workflow columns ─────────────────────────────────────

ALTER TABLE ops_tasks
  ADD COLUMN IF NOT EXISTS follow_up_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attachment_refs  JSONB;

-- Index for follow-up sweep queries
CREATE INDEX IF NOT EXISTS idx_ops_tasks_follow_up_at
  ON ops_tasks (follow_up_at)
  WHERE follow_up_at IS NOT NULL;

-- ─── location_analysis_cache ─────────────────────────────────────────────────
--
-- Stores deterministic address-scoring results so the same address always
-- returns the same result without re-running the scoring pipeline.
--
-- address_key = SHA-like fingerprint of normalised address string.
-- TTL convention: application must treat entries older than 24 h as stale
--   and recompute.  No DB-level expiry so rows accumulate over time and serve
--   as a permanent audit log; DELETE sweep can be added later.

CREATE TABLE IF NOT EXISTS location_analysis_cache (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  address_key  TEXT        NOT NULL UNIQUE,
  address_raw  TEXT        NOT NULL,
  lat          DOUBLE PRECISION,
  lon          DOUBLE PRECISION,
  score        INTEGER     NOT NULL,
  band         TEXT        NOT NULL,
  metrics_json JSONB       NOT NULL DEFAULT '[]',
  audience_json JSONB      NOT NULL DEFAULT '[]',
  cached_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hit_count    INTEGER     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_location_cache_address_key
  ON location_analysis_cache (address_key);

CREATE INDEX IF NOT EXISTS idx_location_cache_cached_at
  ON location_analysis_cache (cached_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Service-role only — cache is read/written exclusively by backend API routes.
-- The address-suggest endpoint is public (no auth), but the analysis cache
-- sits behind server-side code only.

ALTER TABLE location_analysis_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON location_analysis_cache;

CREATE POLICY "service_role_full_access"
  ON location_analysis_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
