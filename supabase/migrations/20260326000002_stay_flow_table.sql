-- Guest stay-flow state machine persistence.
--
-- One row per reservation tracks the full lifecycle from linked registration
-- through pre-check-in, active stay, checkout, and post-stay follow-up.
--
-- Depends on: 20260326000001_comms_phase2_tables.sql (tg_guest_reservations must exist)
--
-- State machine:
--   reservation_linked → pre_checkin_sent → in_stay → checkout_sent → followup_sent → closed
--                            ↓                 ↓
--                        escalated (from any active state)
--
-- Advance rules (driven by cron runner — see src/app/api/cron/advance-stay-flows/):
--   reservation_linked  → pre_checkin_sent : checkin_date <= today + 2 days
--   pre_checkin_sent    → in_stay          : checkin_date <= today (time catchup, no message)
--   in_stay             → checkout_sent    : checkout_date <= today
--   checkout_sent       → followup_sent    : checkout_date + 1 day <= today
--
-- Inbound bridge rules (driven by orchestrator on incoming Telegram message):
--   pre_checkin_sent    → in_stay          : benign guest reply
--   any active state    → escalated        : issue/access escalation

CREATE TABLE IF NOT EXISTS tg_stay_flows (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Reservation this flow tracks. UNIQUE so each reservation has at most one flow.
  reservation_id         TEXT        NOT NULL UNIQUE,
  -- Telegram chat linked to this guest. NULL until the guest chats in.
  chat_id                BIGINT,
  guest_id               TEXT,
  property_id            TEXT,
  -- State machine status (see values above).
  flow_status            TEXT        NOT NULL DEFAULT 'reservation_linked',
  flow_status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Stay dates (denormalised from tg_guest_reservations for fast runner queries).
  checkin_date           DATE,
  checkout_date          DATE,
  -- Delivery timestamps — set once and never cleared; guards idempotent sends.
  pre_checkin_sent_at    TIMESTAMPTZ,
  checkout_sent_at       TIMESTAMPTZ,
  followup_sent_at       TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Runner uses checkin/checkout dates + status frequently.
CREATE INDEX IF NOT EXISTS idx_tg_stay_flows_checkin
  ON tg_stay_flows (flow_status, checkin_date);

CREATE INDEX IF NOT EXISTS idx_tg_stay_flows_checkout
  ON tg_stay_flows (flow_status, checkout_date);

CREATE INDEX IF NOT EXISTS idx_tg_stay_flows_chat_id
  ON tg_stay_flows (chat_id);
