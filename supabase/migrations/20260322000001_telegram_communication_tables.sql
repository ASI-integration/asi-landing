-- Foundation tables for the Telegram communication module.
--
-- This migration must run before:
--   20260323000001_session_status_column.sql  (ALTERs tg_conversation_sessions)
--   20260325000001_rls_policies_telegram_payments.sql (enables RLS on these tables)
--
-- All tables use IF NOT EXISTS so the migration is safe to re-run on existing
-- databases that already have these tables created via manual SQL.

-- ─── Conversation sessions ────────────────────────────────────────────────────
-- One row per Telegram chat. Tracks session lifecycle and optional reservation/
-- guest linkage once a match is found.

CREATE TABLE IF NOT EXISTS tg_conversation_sessions (
  chat_id     BIGINT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  guest_id    TEXT,
  property_id TEXT
);

-- ─── Message turns ────────────────────────────────────────────────────────────
-- Append-only log of every inbound (user) and outbound (assistant) turn.
-- Content is truncated to 2000 chars before insert (enforced in persistence.ts).

CREATE TABLE IF NOT EXISTS tg_message_turns (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id    BIGINT      NOT NULL,
  update_id  BIGINT,
  role       TEXT        NOT NULL,   -- 'user' | 'assistant'
  content    TEXT        NOT NULL,
  category   TEXT,
  lang       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_message_turns_chat_created
  ON tg_message_turns (chat_id, created_at DESC);

-- ─── Processed updates (idempotency L2) ──────────────────────────────────────
-- Durable deduplication store. A row here means the update_id was processed
-- by at least one process instance, even across cold starts.

CREATE TABLE IF NOT EXISTS tg_processed_updates (
  update_id    BIGINT      PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Escalation events ───────────────────────────────────────────────────────
-- Records every escalation created by the orchestrator for audit and future
-- operator queue integration.

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

-- ─── Outbound delivery failures ───────────────────────────────────────────────
-- When the channel adapter fails to deliver a reply, the failure is recorded
-- here for monitoring and future retry support.

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
