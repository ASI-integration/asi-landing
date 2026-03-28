-- Stay-flow pre-checkin sent timestamp on tg_guest_reservations.
--
-- Tracks when a proactive pre-checkin message was sent to the guest.
-- Used by the stay-flow runner to:
--   1. Avoid duplicate sends across runner passes (idempotency gate).
--   2. Allow the reactive orchestrator path to also mark the message sent
--      so the runner never double-sends when the guest messaged first.
--
-- NULL means no message has been sent yet (reservation is eligible for runner).
-- Non-null means a pre-checkin message was already delivered.
--
-- Additive-only change — existing rows remain unaffected (NULL default).

ALTER TABLE tg_guest_reservations
  ADD COLUMN IF NOT EXISTS pre_checkin_sent_at TIMESTAMPTZ;

-- Index: the runner queries on (readiness_blocked, pre_checkin_sent_at, check_in)
-- to find eligible reservations efficiently.
CREATE INDEX IF NOT EXISTS idx_tg_reservations_runner_eligible
  ON tg_guest_reservations (readiness_blocked, check_in)
  WHERE pre_checkin_sent_at IS NULL
    AND readiness_checked_at IS NOT NULL
    AND status != 'cancelled';
