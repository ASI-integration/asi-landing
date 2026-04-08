-- ============================================================================
-- Multitenant Communication Schema v1
--
-- NOTE:
-- This repo already has a `users` table used by existing auth/subscription code
-- (see `supabase/migrations/001_initial_schema.sql`). Applying this file to the
-- same database will conflict unless you migrate/rename the existing tables.
-- ============================================================================

-- 1. ACCOUNTS
create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan_code text not null default 'small',
  subscription_status text not null default 'trial',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  billing_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint accounts_plan_code_check
    check (plan_code in ('small', 'growth', 'enterprise')),

  constraint accounts_subscription_status_check
    check (subscription_status in ('trial', 'active', 'paused', 'canceled'))
);

create index idx_accounts_plan_code on accounts(plan_code);
create index idx_accounts_subscription_status on accounts(subscription_status);


-- 2. USERS
create table users (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'owner',
  auth_provider text,
  auth_provider_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint users_role_check
    check (role in ('owner', 'manager', 'operator'))
);

create unique index uq_users_account_email on users(account_id, email);
create index idx_users_account_id on users(account_id);


-- 3. PROPERTIES
create table properties (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  address_line text,
  city text,
  country text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint properties_status_check
    check (status in ('draft', 'active', 'inactive'))
);

create index idx_properties_account_id on properties(account_id);
create index idx_properties_status on properties(status);


-- 4. CHANNELS
create table channels (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  type text not null,
  status text not null default 'pending',
  external_id text,
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint channels_type_check
    check (type in ('telegram', 'email', 'vk')),

  constraint channels_status_check
    check (status in ('connected', 'pending', 'error'))
);

create index idx_channels_account_id on channels(account_id);
create index idx_channels_property_id on channels(property_id);
create index idx_channels_type on channels(type);
create index idx_channels_status on channels(status);


-- 5. CONVERSATIONS
create table conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  channel_id uuid not null references channels(id) on delete cascade,
  external_chat_id text not null,
  participant_type text not null default 'guest',
  status text not null default 'open',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint conversations_participant_type_check
    check (participant_type in ('guest', 'owner', 'operator', 'unknown')),

  constraint conversations_status_check
    check (status in ('open', 'waiting_operator', 'resolved'))
);

create index idx_conversations_account_id on conversations(account_id);
create index idx_conversations_property_id on conversations(property_id);
create index idx_conversations_channel_id on conversations(channel_id);
create index idx_conversations_external_chat_id on conversations(external_chat_id);
create index idx_conversations_last_message_at on conversations(last_message_at desc);


-- 6. MESSAGE_TURNS
create table message_turns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null,
  content text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint message_turns_role_check
    check (role in ('user', 'assistant', 'operator', 'system'))
);

create index idx_message_turns_account_id on message_turns(account_id);
create index idx_message_turns_conversation_id on message_turns(conversation_id);
create index idx_message_turns_created_at on message_turns(created_at desc);

