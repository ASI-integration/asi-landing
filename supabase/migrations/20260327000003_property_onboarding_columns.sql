-- Property onboarding toolkit: add operator-facing fields
--
-- Extends tg_property_knowledge with structured fields that operators
-- can set via the /api/admin/upsert-property-knowledge route without
-- editing SQL manually.
--
-- Extends tg_guest_reservations with guest_count and note columns
-- for the /api/admin/upsert-reservation route.
--
-- All ADD COLUMN ... IF NOT EXISTS so the migration is safe to re-run.

-- ─── tg_property_knowledge additions ─────────────────────────────────────────

ALTER TABLE tg_property_knowledge
  ADD COLUMN IF NOT EXISTS location        TEXT,
  ADD COLUMN IF NOT EXISTS check_in_time   TEXT,
  ADD COLUMN IF NOT EXISTS check_out_time  TEXT,
  ADD COLUMN IF NOT EXISTS wifi_name       TEXT,
  ADD COLUMN IF NOT EXISTS wifi_password   TEXT,
  ADD COLUMN IF NOT EXISTS active          BOOLEAN NOT NULL DEFAULT true;

-- ─── tg_guest_reservations additions ─────────────────────────────────────────

ALTER TABLE tg_guest_reservations
  ADD COLUMN IF NOT EXISTS guest_count  INT,
  ADD COLUMN IF NOT EXISTS note         TEXT;
