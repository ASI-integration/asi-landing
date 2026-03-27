-- Minimum unit operational state model.
--
-- One row per property. Tracks the operational lifecycle of a rental unit so
-- the system knows whether turnover is needed, in-progress, or complete, and
-- whether the unit is ready for the next guest.
--
-- State machine:
--   idle → occupied → checkout_due → turnover_needed → in_turnover → ready
--                                                                       ↓
--                                                                    blocked (any point)
--
-- Idempotency:
--   property_id is UNIQUE — upsert on conflict is safe to retry.
--
-- RLS:
--   Service-role only (backend). No anon or authenticated access.

-- ─── Main table ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS unit_state (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id                 TEXT        NOT NULL UNIQUE,
  current_state               TEXT        NOT NULL DEFAULT 'idle' CHECK (current_state IN (
                                'idle', 'occupied', 'checkout_due',
                                'turnover_needed', 'in_turnover', 'ready', 'blocked'
                              )),
  current_reservation_id      TEXT,
  dirty                       BOOLEAN     NOT NULL DEFAULT FALSE,
  ready_for_checkin           BOOLEAN     NOT NULL DEFAULT FALSE,
  blocked_reason              TEXT,
  last_checkout_at            TIMESTAMPTZ,
  last_turnover_completed_at  TIMESTAMPTZ,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_unit_state_current_state
  ON unit_state (current_state);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE unit_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON unit_state;

CREATE POLICY "service_role_full_access"
  ON unit_state
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
