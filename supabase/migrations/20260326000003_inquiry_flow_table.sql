-- Pre-booking inquiry flow state machine persistence.
--
-- Tracks guest contacts that arrive without a linked reservation.
-- One row per Telegram chat (UNIQUE on chat_id).
--
-- Depends on: 20260326000001_comms_phase2_tables.sql
--
-- State machine:
--   new_contact → general_question
--              → collecting_booking_details → awaiting_missing_details ↺
--                                           → ready_for_handoff → handed_off
--              → escalated
--   any state  → converted_to_reservation  (when reservation linked)
--   any state  → closed
--
-- Handoff types: booking_inquiry | support_issue | uncertainty

CREATE TABLE IF NOT EXISTS tg_inquiry_flows (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One active inquiry per chat at a time.
  chat_id               BIGINT      NOT NULL UNIQUE,
  guest_id              TEXT,
  telegram_user_id      BIGINT,
  -- State machine status.
  inquiry_status        TEXT        NOT NULL DEFAULT 'new_contact',
  -- Accumulated booking details (dates, guest_count, property_ref, lang, note).
  booking_details       JSONB       NOT NULL DEFAULT '{}',
  -- How many booking inquiry turns have been processed.
  intake_turn_count     INT         NOT NULL DEFAULT 0,
  -- Operator handoff (set once and never cleared; guards idempotent sends).
  handoff_type          TEXT,       -- booking_inquiry | support_issue | uncertainty
  handoff_at            TIMESTAMPTZ,
  handoff_summary       TEXT,
  -- Reservation bridge (set when a reservation is matched for this chat).
  linked_reservation_id TEXT,
  converted_at          TIMESTAMPTZ,
  -- Turn timestamps.
  last_inbound_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_outbound_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_inquiry_flows_guest_id
  ON tg_inquiry_flows (guest_id);

CREATE INDEX IF NOT EXISTS idx_tg_inquiry_flows_inquiry_status
  ON tg_inquiry_flows (inquiry_status);
