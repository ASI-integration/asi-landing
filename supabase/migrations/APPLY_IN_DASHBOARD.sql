-- ============================================================
-- CONSOLIDATED ONE-SHOT MIGRATION FOR SUPABASE SQL EDITOR
-- Branch: verify/min-stay-flow-live
-- Apply: Supabase Dashboard → SQL Editor → paste → Run
-- All statements are IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- so this file is fully idempotent and safe to run multiple times.
-- ============================================================

-- ── From 20260322000001 (tg_conversation_sessions + tg_message_turns already exist) ──

CREATE TABLE IF NOT EXISTS tg_processed_updates (
  update_id    BIGINT      PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tg_escalation_events (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id    BIGINT      NOT NULL,
  update_id  BIGINT,
  reason     TEXT        NOT NULL,
  category   TEXT,
  summary    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tg_escalation_events_chat_created
  ON tg_escalation_events (chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tg_outbound_failures (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id      BIGINT      NOT NULL,
  update_id    BIGINT,
  error_detail TEXT,
  retry_count  INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retried_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tg_outbound_failures_chat_created
  ON tg_outbound_failures (chat_id, created_at DESC);

-- ── From 20260323000001 (status column already added; run backfill + index) ──

ALTER TABLE tg_conversation_sessions
  ADD COLUMN IF NOT EXISTS status             TEXT        NOT NULL DEFAULT 'inquiry',
  ADD COLUMN IF NOT EXISTS status_updated_at  TIMESTAMPTZ;

UPDATE tg_conversation_sessions
  SET status_updated_at = updated_at
  WHERE status_updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tg_conv_sess_status
  ON tg_conversation_sessions (status, status_updated_at)
  WHERE status = 'payment_pending';

-- ── From 20260326000001 (Phase 2 comms) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS tg_guest_identities (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id  BIGINT      NOT NULL UNIQUE,
  telegram_user_id  BIGINT,
  guest_id          TEXT        NOT NULL,
  first_name        TEXT,
  last_name         TEXT,
  phone             TEXT,
  email             TEXT,
  lang_hint         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tg_guest_identities_guest_id
  ON tg_guest_identities (guest_id);

CREATE TABLE IF NOT EXISTS tg_conversation_context (
  chat_id          BIGINT      PRIMARY KEY,
  last_intent      TEXT,
  guest_name       TEXT,
  reservation_id   TEXT,
  booking_draft    JSONB,
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tg_guest_reservations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_ref  TEXT        UNIQUE,
  guest_id         TEXT,
  chat_id          BIGINT,
  property_id      TEXT,
  guest_name       TEXT,
  phone            TEXT,
  email            TEXT,
  check_in         DATE,
  check_out        DATE,
  status           TEXT        NOT NULL DEFAULT 'confirmed',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tg_guest_reservations_guest_id
  ON tg_guest_reservations (guest_id);
CREATE INDEX IF NOT EXISTS idx_tg_guest_reservations_chat_id
  ON tg_guest_reservations (chat_id);
CREATE INDEX IF NOT EXISTS idx_tg_guest_reservations_phone
  ON tg_guest_reservations (phone);

CREATE TABLE IF NOT EXISTS tg_property_knowledge (
  property_id             TEXT        PRIMARY KEY,
  object_name             TEXT,
  check_in_instructions   TEXT,
  check_out_instructions  TEXT,
  wifi_instructions       TEXT,
  house_rules             TEXT,
  property_policy         TEXT,
  emergency_contacts      TEXT,
  upsells                 TEXT,
  parking_instructions    TEXT,
  payment_rules           TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tg_timeline_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     BIGINT,
  guest_id    TEXT,
  event_type  TEXT        NOT NULL,
  event_data  JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tg_timeline_events_chat_created
  ON tg_timeline_events (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_timeline_events_guest_created
  ON tg_timeline_events (guest_id, created_at DESC);

ALTER TABLE tg_conversation_sessions
  ADD COLUMN IF NOT EXISTS reservation_id TEXT;

INSERT INTO tg_property_knowledge (
  property_id, object_name,
  check_in_instructions, check_out_instructions,
  wifi_instructions, house_rules, property_policy,
  emergency_contacts, upsells
) VALUES (
  'prop_A',
  'Demo Apartment — Pilot Property',
  'Smart lock code is 1234*. Check-in is at 3:00 PM.',
  'Leave keys on table. Checkout at 11:00 AM.',
  'Network: GuestWifi, Pass: secret123',
  'No smoking, no pets. Parties are strictly forbidden.',
  'Strict quiet hours from 10 PM to 8 AM.',
  'Call maintenance at 555-0199 for plumbing/heating issues.',
  'Late checkout available for $50. Extra towels $10.'
) ON CONFLICT (property_id) DO NOTHING;

-- ── From 20260326000002 (stay-flow state machine) ────────────────────────────

CREATE TABLE IF NOT EXISTS tg_stay_flows (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id         TEXT        NOT NULL UNIQUE,
  chat_id                BIGINT,
  guest_id               TEXT,
  property_id            TEXT,
  flow_status            TEXT        NOT NULL DEFAULT 'reservation_linked',
  flow_status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checkin_date           DATE,
  checkout_date          DATE,
  pre_checkin_sent_at    TIMESTAMPTZ,
  checkout_sent_at       TIMESTAMPTZ,
  followup_sent_at       TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tg_stay_flows_checkin
  ON tg_stay_flows (flow_status, checkin_date);
CREATE INDEX IF NOT EXISTS idx_tg_stay_flows_checkout
  ON tg_stay_flows (flow_status, checkout_date);
CREATE INDEX IF NOT EXISTS idx_tg_stay_flows_chat_id
  ON tg_stay_flows (chat_id);

-- ── Minimal test data for validation runner ──────────────────────────────────
-- Seeds one reservation + stay-flow with checkin_date = tomorrow so the
-- cron runner (advance-stay-flows) will immediately pick it up.
-- Idempotent via ON CONFLICT DO NOTHING.

INSERT INTO tg_guest_reservations (
  reservation_ref, guest_id, chat_id, property_id,
  guest_name, check_in, check_out, status
) VALUES (
  'TEST-VALRUN-001',
  'tg_931919812',
  931919812,
  'prop_A',
  'Val Runner',
  CURRENT_DATE + INTERVAL '1 day',
  CURRENT_DATE + INTERVAL '3 days',
  'confirmed'
) ON CONFLICT (reservation_ref) DO NOTHING;

INSERT INTO tg_stay_flows (
  reservation_id, chat_id, guest_id, property_id,
  flow_status, checkin_date, checkout_date
)
SELECT
  id,
  931919812,
  'tg_931919812',
  'prop_A',
  'reservation_linked',
  (CURRENT_DATE + INTERVAL '1 day')::DATE,
  (CURRENT_DATE + INTERVAL '3 days')::DATE
FROM tg_guest_reservations
WHERE reservation_ref = 'TEST-VALRUN-001'
ON CONFLICT (reservation_id) DO NOTHING;
