-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Distribution Runtime / Channel Manager Foundation (Phase 1)
-- Goal: foundational schema for OTA/channel-manager style distribution.
-- Scope: connections, mappings, reservations ingest, availability/rates snapshots,
--        sync jobs + audit logs + idempotency, safe operational controls.
--
-- IMPORTANT: This does NOT implement "smart OTA optimization" or profitability logic.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Reference: distribution channels catalog
CREATE TABLE IF NOT EXISTS dist_distribution_channels (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dist_distribution_channels_code_unique UNIQUE (code),
  CONSTRAINT dist_distribution_channels_status_check
    CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS idx_dist_distribution_channels_status
  ON dist_distribution_channels(status);

-- Seed a minimal catalog (idempotent)
INSERT INTO dist_distribution_channels (code, name, status)
VALUES
  ('bookingcom', 'Booking.com', 'active'),
  ('expedia', 'Expedia Group', 'active'),
  ('airbnb', 'Airbnb', 'active'),
  ('agoda', 'Agoda', 'inactive'),
  ('tripcom', 'Trip.com', 'inactive')
ON CONFLICT (code) DO NOTHING;


-- 2) OTA/Channel accounts (credentials/config container; not per property)
CREATE TABLE IF NOT EXISTS dist_ota_accounts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id    UUID        NOT NULL REFERENCES dist_distribution_channels(id) ON DELETE RESTRICT,
  nickname      TEXT,
  status        TEXT        NOT NULL DEFAULT 'active',
  external_id   TEXT,
  config_json   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dist_ota_accounts_status_check
    CHECK (status IN ('active', 'disabled', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_dist_ota_accounts_account_id
  ON dist_ota_accounts(account_id);

CREATE INDEX IF NOT EXISTS idx_dist_ota_accounts_channel_id
  ON dist_ota_accounts(channel_id);

CREATE INDEX IF NOT EXISTS idx_dist_ota_accounts_status
  ON dist_ota_accounts(status);


-- 3) Property <-> channel connection (operational control boundary)
CREATE TABLE IF NOT EXISTS dist_property_channel_connections (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id          UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  channel_id           UUID        NOT NULL REFERENCES dist_distribution_channels(id) ON DELETE RESTRICT,
  ota_account_id       UUID        REFERENCES dist_ota_accounts(id) ON DELETE SET NULL,
  status               TEXT        NOT NULL DEFAULT 'connected',
  disabled_reason      TEXT,
  last_success_at      TIMESTAMPTZ,
  last_attempt_at      TIMESTAMPTZ,
  last_error           TEXT,
  last_sync_state_json JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dist_property_channel_connections_status_check
    CHECK (status IN ('connected', 'disabled', 'error')),

  CONSTRAINT dist_property_channel_connections_unique
    UNIQUE (property_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_dist_pcc_account_id
  ON dist_property_channel_connections(account_id);

CREATE INDEX IF NOT EXISTS idx_dist_pcc_property_id
  ON dist_property_channel_connections(property_id);

CREATE INDEX IF NOT EXISTS idx_dist_pcc_channel_id
  ON dist_property_channel_connections(channel_id);

CREATE INDEX IF NOT EXISTS idx_dist_pcc_status
  ON dist_property_channel_connections(status);


-- 4) Listing mappings (internal listing key <-> external ids)
CREATE TABLE IF NOT EXISTS dist_channel_listings (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id        UUID        NOT NULL REFERENCES dist_property_channel_connections(id) ON DELETE CASCADE,
  internal_listing_key TEXT        NOT NULL,
  external_listing_id  TEXT        NOT NULL,
  metadata_json        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dist_channel_listings_unique
    UNIQUE (connection_id, internal_listing_key),
  CONSTRAINT dist_channel_listings_external_unique
    UNIQUE (connection_id, external_listing_id)
);

CREATE INDEX IF NOT EXISTS idx_dist_channel_listings_connection_id
  ON dist_channel_listings(connection_id);


-- 5) Rate plans (base mapping container; Phase 1 supports storage and audit only)
CREATE TABLE IF NOT EXISTS dist_rate_plans (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id        UUID        NOT NULL REFERENCES dist_property_channel_connections(id) ON DELETE CASCADE,
  internal_rate_plan_key TEXT      NOT NULL,
  external_rate_plan_id TEXT       NOT NULL,
  currency             TEXT,
  metadata_json        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dist_rate_plans_unique
    UNIQUE (connection_id, internal_rate_plan_key),
  CONSTRAINT dist_rate_plans_external_unique
    UNIQUE (connection_id, external_rate_plan_id)
);

CREATE INDEX IF NOT EXISTS idx_dist_rate_plans_connection_id
  ON dist_rate_plans(connection_id);


-- 6) Availability / inventory snapshots per day (write-only in Phase 1)
CREATE TABLE IF NOT EXISTS dist_availability_days (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id   UUID        NOT NULL REFERENCES dist_property_channel_connections(id) ON DELETE CASCADE,
  listing_id      UUID        REFERENCES dist_channel_listings(id) ON DELETE SET NULL,
  day             DATE        NOT NULL,
  available_units INT         NOT NULL DEFAULT 0,
  closed          BOOLEAN     NOT NULL DEFAULT FALSE,
  min_los         INT,
  max_los         INT,
  cutoff_days     INT,
  updated_from    TEXT        NOT NULL DEFAULT 'unknown',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dist_availability_days_unique
    UNIQUE (connection_id, listing_id, day)
);

CREATE INDEX IF NOT EXISTS idx_dist_availability_days_connection_day
  ON dist_availability_days(connection_id, day);


-- 7) Base rate snapshots per day (write-only in Phase 1)
CREATE TABLE IF NOT EXISTS dist_rate_days (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id   UUID        NOT NULL REFERENCES dist_property_channel_connections(id) ON DELETE CASCADE,
  listing_id      UUID        REFERENCES dist_channel_listings(id) ON DELETE SET NULL,
  rate_plan_id    UUID        REFERENCES dist_rate_plans(id) ON DELETE SET NULL,
  day             DATE        NOT NULL,
  base_rate       NUMERIC(12,2),
  currency        TEXT,
  updated_from    TEXT        NOT NULL DEFAULT 'unknown',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dist_rate_days_unique
    UNIQUE (connection_id, listing_id, rate_plan_id, day)
);

CREATE INDEX IF NOT EXISTS idx_dist_rate_days_connection_day
  ON dist_rate_days(connection_id, day);


-- 8) Channel reservations (ingested from OTAs; idempotent by external key)
CREATE TABLE IF NOT EXISTS dist_channel_reservations (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id           UUID        NOT NULL REFERENCES dist_property_channel_connections(id) ON DELETE CASCADE,
  listing_id              UUID        REFERENCES dist_channel_listings(id) ON DELETE SET NULL,
  external_reservation_id TEXT        NOT NULL,
  status                  TEXT        NOT NULL DEFAULT 'new',
  guest_name              TEXT,
  guest_email             TEXT,
  guest_phone             TEXT,
  check_in                DATE,
  check_out               DATE,
  currency                TEXT,
  total_amount            NUMERIC(12,2),
  raw_json                JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dist_channel_reservations_status_check
    CHECK (status IN ('new', 'modified', 'cancelled', 'confirmed', 'error')),

  CONSTRAINT dist_channel_reservations_external_unique
    UNIQUE (connection_id, external_reservation_id)
);

CREATE INDEX IF NOT EXISTS idx_dist_channel_reservations_connection_id
  ON dist_channel_reservations(connection_id);

CREATE INDEX IF NOT EXISTS idx_dist_channel_reservations_check_in
  ON dist_channel_reservations(check_in);


-- 9) Sync jobs + events (audit what was sent/received, when, and outcome)
CREATE TABLE IF NOT EXISTS dist_sync_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id   UUID        NOT NULL REFERENCES dist_property_channel_connections(id) ON DELETE CASCADE,
  kind            TEXT        NOT NULL,
  requested_by    TEXT        NOT NULL DEFAULT 'system',
  status          TEXT        NOT NULL DEFAULT 'queued',
  idempotency_key TEXT,
  attempt_count   INT         NOT NULL DEFAULT 0,
  next_run_at     TIMESTAMPTZ,
  locked_at       TIMESTAMPTZ,
  lock_owner      TEXT,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dist_sync_jobs_status_check
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_dist_sync_jobs_connection_status
  ON dist_sync_jobs(connection_id, status);

CREATE INDEX IF NOT EXISTS idx_dist_sync_jobs_next_run_at
  ON dist_sync_jobs(next_run_at);

CREATE TABLE IF NOT EXISTS dist_sync_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id   UUID        NOT NULL REFERENCES dist_property_channel_connections(id) ON DELETE CASCADE,
  job_id          UUID        REFERENCES dist_sync_jobs(id) ON DELETE SET NULL,
  direction       TEXT        NOT NULL,
  kind            TEXT        NOT NULL,
  request_json    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  response_json   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT        NOT NULL DEFAULT 'ok',
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dist_sync_events_direction_check
    CHECK (direction IN ('outbound', 'inbound')),
  CONSTRAINT dist_sync_events_status_check
    CHECK (status IN ('ok', 'error', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_dist_sync_events_connection_created
  ON dist_sync_events(connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dist_sync_events_job_id
  ON dist_sync_events(job_id);


-- 10) Idempotency keys (provider retries + safe replays)
CREATE TABLE IF NOT EXISTS dist_idempotency_keys (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id   UUID        REFERENCES dist_property_channel_connections(id) ON DELETE CASCADE,
  scope           TEXT        NOT NULL,
  key             TEXT        NOT NULL,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_hash    TEXT,
  result_json     JSONB       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT dist_idempotency_keys_unique
    UNIQUE (scope, connection_id, key)
);

CREATE INDEX IF NOT EXISTS idx_dist_idempotency_keys_connection_scope
  ON dist_idempotency_keys(connection_id, scope);

