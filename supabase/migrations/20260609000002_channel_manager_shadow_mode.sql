-- Full shadow mode for channel-manager runtime.
-- Shadow mode records booking events, availability projections, sync jobs, logs,
-- and discrepancies without sending anything to real OTA APIs.

CREATE TABLE IF NOT EXISTS cm_shadow_booking_events (
  id                           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                   UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id                   UUID        REFERENCES cm_channels(id) ON DELETE SET NULL,
  listing_id                   UUID        REFERENCES cm_channel_listings(id) ON DELETE SET NULL,
  property_id                  UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_key                     TEXT        NOT NULL DEFAULT 'default',
  event_type                   TEXT        NOT NULL,
  external_booking_id          TEXT,
  idempotency_key              TEXT,
  guest_name                   TEXT,
  check_in_date                DATE        NOT NULL,
  check_out_date               DATE        NOT NULL,
  quantity                     INT         NOT NULL DEFAULT 1,
  status                       TEXT        NOT NULL DEFAULT 'processed',
  available                    BOOLEAN     NOT NULL DEFAULT FALSE,
  reservation_id               UUID        REFERENCES cm_reservations(id) ON DELETE SET NULL,
  projected_availability_json  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  external_availability_json   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  payload_json                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cm_shadow_booking_events_dates_check CHECK (check_out_date > check_in_date),
  CONSTRAINT cm_shadow_booking_events_quantity_check CHECK (quantity > 0),
  CONSTRAINT cm_shadow_booking_events_type_check
    CHECK (event_type IN ('reservation_created', 'reservation_cancelled', 'reservation_modified')),
  CONSTRAINT cm_shadow_booking_events_status_check
    CHECK (status IN ('processed', 'duplicate', 'conflict', 'skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cm_shadow_booking_events_idempotency
  ON cm_shadow_booking_events(account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cm_shadow_booking_events_property_created
  ON cm_shadow_booking_events(account_id, property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cm_shadow_discrepancies (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  shadow_event_id   UUID        NOT NULL REFERENCES cm_shadow_booking_events(id) ON DELETE CASCADE,
  channel_id        UUID        REFERENCES cm_channels(id) ON DELETE SET NULL,
  property_id       UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_key          TEXT        NOT NULL DEFAULT 'default',
  day               DATE,
  discrepancy_type  TEXT        NOT NULL,
  severity          TEXT        NOT NULL DEFAULT 'warning',
  expected_value    TEXT,
  observed_value    TEXT,
  message           TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cm_shadow_discrepancies_type_check
    CHECK (discrepancy_type IN (
      'external_availability_mismatch',
      'insufficient_availability',
      'reservation_not_found',
      'shadow_mode_required'
    )),
  CONSTRAINT cm_shadow_discrepancies_severity_check
    CHECK (severity IN ('info', 'warning', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_cm_shadow_discrepancies_property_created
  ON cm_shadow_discrepancies(account_id, property_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cm_shadow_discrepancies_event
  ON cm_shadow_discrepancies(shadow_event_id);

ALTER TABLE cm_shadow_booking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_shadow_discrepancies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON cm_shadow_booking_events;
DROP POLICY IF EXISTS "service_role_full_access" ON cm_shadow_discrepancies;

CREATE POLICY "service_role_full_access" ON cm_shadow_booking_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access" ON cm_shadow_discrepancies
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
