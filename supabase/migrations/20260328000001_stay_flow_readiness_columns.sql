-- Stay-flow readiness columns on tg_guest_reservations.
--
-- Tracks whether a reservation's check-in messaging has been blocked
-- by the unit readiness gate, what the reason was, and when it was
-- last checked.
--
-- All three columns are nullable / have safe defaults so existing rows
-- are unaffected (backward-compatible, additive-only change).
--
-- These columns are updated best-effort by the communication orchestrator
-- whenever a check-in gate evaluation happens.

ALTER TABLE tg_guest_reservations
  ADD COLUMN IF NOT EXISTS readiness_blocked      BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS readiness_block_reason  TEXT,
  ADD COLUMN IF NOT EXISTS readiness_checked_at    TIMESTAMPTZ;
