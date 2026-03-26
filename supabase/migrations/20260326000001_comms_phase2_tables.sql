-- Phase 2: Communication Module Hardening
--
-- Replaces every in-memory / mock store with durable Supabase persistence so
-- the communication module survives cold starts and is ready for a real pilot.
--
-- Depends on: 20260322000001_telegram_communication_tables.sql
--             20260323000001_session_status_column.sql
--
-- All DDL uses IF NOT EXISTS / IF NOT EXISTS so the migration is safe to re-run.

-- ─── G1: Durable Telegram identity linkage ───────────────────────────────────
-- One row per Telegram chat (telegram_chat_id UNIQUE).
-- Stores the stable guest_id plus optional phone/email enrichment.

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

-- ─── G5: Conversation context persistence ────────────────────────────────────
-- Stores the LLM conversation context (last intent, guest name, booking draft)
-- so the orchestrator can resume correctly after a cold start / redeploy.

CREATE TABLE IF NOT EXISTS tg_conversation_context (
  chat_id          BIGINT      PRIMARY KEY,
  last_intent      TEXT,
  guest_name       TEXT,
  reservation_id   TEXT,
  booking_draft    JSONB,
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── G2: Minimal reservation mapping layer ───────────────────────────────────
-- Replaces the hardcoded 3-record mock in reservation.ts.
-- Operators insert rows here for each reservation they want the bot to
-- recognise.  The schema is intentionally minimal — not a full booking engine.

CREATE TABLE IF NOT EXISTS tg_guest_reservations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_ref  TEXT        UNIQUE,           -- external booking reference
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

-- ─── G3: Property knowledge store ────────────────────────────────────────────
-- Replaces the single-property PROPERTY_DB mock in knowledge.ts.
-- Operators insert one row per managed property.

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

-- ─── G4: Timeline events (non-message events) ────────────────────────────────
-- Persists escalation, payment, and system events so the full conversation
-- timeline is reconstructable from DB state.
-- Message turns are already stored in tg_message_turns.

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

-- ─── Extend tg_conversation_sessions with reservation_id ────────────────────

ALTER TABLE tg_conversation_sessions
  ADD COLUMN IF NOT EXISTS reservation_id TEXT;

-- ─── Seed: example property knowledge row ────────────────────────────────────
-- Provides a real row so getGroundedKnowledge returns real data for prop_A
-- during early piloting.  Operators should replace / extend via Supabase UI.

INSERT INTO tg_property_knowledge (
  property_id,
  object_name,
  check_in_instructions,
  check_out_instructions,
  wifi_instructions,
  house_rules,
  property_policy,
  emergency_contacts,
  upsells
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
