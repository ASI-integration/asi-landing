-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Multitenant account/workspace layer v1 (safe, non-conflicting)
-- Goal: introduce accounts + membership + comm primitives without touching the
--       existing public.users / sessions / subscriptions model.
--
-- Conventions:
--  - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS for safe re-runs
--  - Do not create/rename any existing tables
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) ACCOUNTS
CREATE TABLE IF NOT EXISTS accounts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  plan_code           TEXT        NOT NULL DEFAULT 'small',
  subscription_status TEXT        NOT NULL DEFAULT 'trial',
  trial_started_at    TIMESTAMPTZ,
  trial_ends_at       TIMESTAMPTZ,
  billing_customer_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT accounts_plan_code_check
    CHECK (plan_code IN ('small', 'growth', 'enterprise')),

  CONSTRAINT accounts_subscription_status_check
    CHECK (subscription_status IN ('trial', 'active', 'paused', 'canceled'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_plan_code
  ON accounts(plan_code);

CREATE INDEX IF NOT EXISTS idx_accounts_subscription_status
  ON accounts(subscription_status);

CREATE INDEX IF NOT EXISTS idx_accounts_created_at
  ON accounts(created_at DESC);

-- 2) ACCOUNT MEMBERS (replaces draft "users" table; links to existing public.users)
CREATE TABLE IF NOT EXISTS account_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT account_members_role_check
    CHECK (role IN ('owner', 'manager', 'operator')),

  CONSTRAINT account_members_account_user_unique
    UNIQUE (account_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_account_members_account_id
  ON account_members(account_id);

CREATE INDEX IF NOT EXISTS idx_account_members_user_id
  ON account_members(user_id);

CREATE INDEX IF NOT EXISTS idx_account_members_created_at
  ON account_members(created_at DESC);

-- 3) PROPERTIES
CREATE TABLE IF NOT EXISTS properties (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  address_line TEXT,
  city         TEXT,
  country      TEXT,
  status       TEXT        NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT properties_status_check
    CHECK (status IN ('draft', 'active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS idx_properties_account_id
  ON properties(account_id);

CREATE INDEX IF NOT EXISTS idx_properties_status
  ON properties(status);

CREATE INDEX IF NOT EXISTS idx_properties_created_at
  ON properties(created_at DESC);

-- 4) CHANNELS
CREATE TABLE IF NOT EXISTS channels (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id   UUID        REFERENCES properties(id) ON DELETE SET NULL,
  type          TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending',
  external_id   TEXT,
  settings_json JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT channels_type_check
    CHECK (type IN ('telegram', 'email', 'vk')),

  CONSTRAINT channels_status_check
    CHECK (status IN ('connected', 'pending', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_channels_account_id
  ON channels(account_id);

CREATE INDEX IF NOT EXISTS idx_channels_property_id
  ON channels(property_id);

CREATE INDEX IF NOT EXISTS idx_channels_type
  ON channels(type);

CREATE INDEX IF NOT EXISTS idx_channels_status
  ON channels(status);

CREATE INDEX IF NOT EXISTS idx_channels_created_at
  ON channels(created_at DESC);

-- 5) CONVERSATIONS
CREATE TABLE IF NOT EXISTS conversations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id       UUID        REFERENCES properties(id) ON DELETE SET NULL,
  channel_id        UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_chat_id  TEXT        NOT NULL,
  participant_type  TEXT        NOT NULL DEFAULT 'guest',
  status            TEXT        NOT NULL DEFAULT 'open',
  last_message_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT conversations_participant_type_check
    CHECK (participant_type IN ('guest', 'owner', 'operator', 'unknown')),

  CONSTRAINT conversations_status_check
    CHECK (status IN ('open', 'waiting_operator', 'resolved')),

  -- Prevent accidental duplicates from provider retries per channel.
  CONSTRAINT conversations_channel_external_chat_unique
    UNIQUE (channel_id, external_chat_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_account_id
  ON conversations(account_id);

CREATE INDEX IF NOT EXISTS idx_conversations_property_id
  ON conversations(property_id);

CREATE INDEX IF NOT EXISTS idx_conversations_channel_id
  ON conversations(channel_id);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at
  ON conversations(last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_created_at
  ON conversations(created_at DESC);

-- 6) MESSAGE TURNS
CREATE TABLE IF NOT EXISTS message_turns (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL,
  content         TEXT        NOT NULL,
  metadata_json   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT message_turns_role_check
    CHECK (role IN ('user', 'assistant', 'operator', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_message_turns_account_id
  ON message_turns(account_id);

CREATE INDEX IF NOT EXISTS idx_message_turns_conversation_id
  ON message_turns(conversation_id);

CREATE INDEX IF NOT EXISTS idx_message_turns_created_at
  ON message_turns(created_at DESC);

