-- ============================================================================
-- Communication Backbone v1 — Production Spine
-- Migration: comm-backbone-v1.sql
--
-- Run this in the Supabase SQL editor (or via supabase db push).
-- All statements are idempotent (IF NOT EXISTS / OR REPLACE).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. tg_contacts — unified guest identity across channels
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tg_contacts (
  id           TEXT        PRIMARY KEY,           -- guest_<random>
  telegram_id  TEXT        UNIQUE,                -- Telegram chat_id string
  phone        TEXT        UNIQUE,                -- normalised (+7XXXXXXXXXX)
  email        TEXT        UNIQUE,
  first_name   TEXT,
  last_name    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_contacts_telegram_id ON tg_contacts (telegram_id);
CREATE INDEX IF NOT EXISTS idx_tg_contacts_phone       ON tg_contacts (phone);
CREATE INDEX IF NOT EXISTS idx_tg_contacts_email       ON tg_contacts (email);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. tg_conversations — Conversation domain entity
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tg_conversations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         TEXT        NOT NULL,                        -- telegram | email | phone | max
  chat_id         TEXT        NOT NULL,                        -- provider-specific chat identifier
  contact_id      TEXT        REFERENCES tg_contacts(id),
  lead_id         TEXT,                                        -- FK to leads table (if exists)
  reservation_id  TEXT,                                        -- FK to tg_guest_reservations
  property_id     TEXT,

  status          TEXT        NOT NULL DEFAULT 'active',       -- active | paused | closed | escalated
  current_state   TEXT        NOT NULL DEFAULT 'new',          -- ConversationState enum

  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_conversations_channel_chat ON tg_conversations (channel, chat_id);
CREATE INDEX IF NOT EXISTS idx_tg_conversations_contact      ON tg_conversations (contact_id);
CREATE INDEX IF NOT EXISTS idx_tg_conversations_reservation  ON tg_conversations (reservation_id);
CREATE INDEX IF NOT EXISTS idx_tg_conversations_status       ON tg_conversations (status);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. comm_messages — full message audit record
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comm_messages (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      UUID        REFERENCES tg_conversations(id),
  direction            TEXT        NOT NULL,                   -- inbound | outbound
  type                 TEXT        NOT NULL DEFAULT 'text',    -- text | image | voice | system
  content              TEXT        NOT NULL,
  meta                 JSONB,                                  -- raw provider payload
  delivery_status      TEXT        NOT NULL DEFAULT 'pending', -- pending | sent | delivered | failed
  provider_message_id  TEXT,                                   -- Telegram message_id, etc.
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_messages_conversation ON comm_messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_comm_messages_direction    ON comm_messages (direction);
CREATE INDEX IF NOT EXISTS idx_comm_messages_created      ON comm_messages (created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. comm_dlq — dead-letter queue for failed outbound messages
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comm_dlq (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_key  TEXT        NOT NULL,                      -- channel:chatId
  target_id         TEXT        NOT NULL,
  message_text      TEXT        NOT NULL,
  error_detail      TEXT,
  attempts          INT         NOT NULL DEFAULT 0,
  status            TEXT        NOT NULL DEFAULT 'failed',     -- failed | replayed | re_failed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_comm_dlq_status      ON comm_dlq (status);
CREATE INDEX IF NOT EXISTS idx_comm_dlq_conv_key    ON comm_dlq (conversation_key);
CREATE INDEX IF NOT EXISTS idx_comm_dlq_created     ON comm_dlq (created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. comm_events — integration event log (feeds pricing / ops / automation)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comm_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type             TEXT        NOT NULL,     -- conversation.started | message.received | …
  conversation_id  UUID,
  chat_id          BIGINT,
  channel          TEXT,
  payload          JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_events_type        ON comm_events (type);
CREATE INDEX IF NOT EXISTS idx_comm_events_conv        ON comm_events (conversation_id);
CREATE INDEX IF NOT EXISTS idx_comm_events_created     ON comm_events (created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. pending_messages — ASSISTED mode: AI drafts awaiting operator approval
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pending_messages (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id          BIGINT      NOT NULL,
  conversation_id  UUID        REFERENCES tg_conversations(id),
  draft_text       TEXT        NOT NULL,
  context          TEXT,                                       -- brief routing context
  status           TEXT        NOT NULL DEFAULT 'pending',     -- pending | approved | rejected | sent
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_messages_chat_id ON pending_messages (chat_id);
CREATE INDEX IF NOT EXISTS idx_pending_messages_status  ON pending_messages (status);
CREATE INDEX IF NOT EXISTS idx_pending_messages_created ON pending_messages (created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 7. tg_conversation_sessions — add conv_id FK (non-breaking)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE tg_conversation_sessions
  ADD COLUMN IF NOT EXISTS conv_id UUID REFERENCES tg_conversations(id);
