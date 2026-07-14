-- Baseline the Communication Backbone tables that were previously documented
-- only in docs/migrations/comm-backbone-v1.sql. This migration intentionally
-- runs before 20260410000001_tg_contacts_vk_id.sql.

CREATE TABLE IF NOT EXISTS public.tg_contacts (
  id TEXT PRIMARY KEY,
  telegram_id TEXT UNIQUE,
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_contacts_telegram_id
  ON public.tg_contacts (telegram_id);
CREATE INDEX IF NOT EXISTS idx_tg_contacts_phone
  ON public.tg_contacts (phone);
CREATE INDEX IF NOT EXISTS idx_tg_contacts_email
  ON public.tg_contacts (email);

CREATE TABLE IF NOT EXISTS public.tg_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  contact_id TEXT REFERENCES public.tg_contacts(id),
  lead_id TEXT,
  reservation_id TEXT,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  current_state TEXT NOT NULL DEFAULT 'new',
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_conversations_channel_chat
  ON public.tg_conversations (channel, chat_id);
CREATE INDEX IF NOT EXISTS idx_tg_conversations_contact
  ON public.tg_conversations (contact_id);
CREATE INDEX IF NOT EXISTS idx_tg_conversations_reservation
  ON public.tg_conversations (reservation_id);
CREATE INDEX IF NOT EXISTS idx_tg_conversations_status
  ON public.tg_conversations (status);

CREATE TABLE IF NOT EXISTS public.comm_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.tg_conversations(id),
  direction TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  meta JSONB,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_messages_conversation
  ON public.comm_messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_comm_messages_direction
  ON public.comm_messages (direction);
CREATE INDEX IF NOT EXISTS idx_comm_messages_created
  ON public.comm_messages (created_at DESC);

CREATE TABLE IF NOT EXISTS public.comm_dlq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_key TEXT NOT NULL,
  target_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  error_detail TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'failed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_comm_dlq_status
  ON public.comm_dlq (status);
CREATE INDEX IF NOT EXISTS idx_comm_dlq_conv_key
  ON public.comm_dlq (conversation_key);
CREATE INDEX IF NOT EXISTS idx_comm_dlq_created
  ON public.comm_dlq (created_at DESC);

CREATE TABLE IF NOT EXISTS public.comm_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  conversation_id UUID,
  chat_id BIGINT,
  channel TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_events_type
  ON public.comm_events (type);
CREATE INDEX IF NOT EXISTS idx_comm_events_conv
  ON public.comm_events (conversation_id);
CREATE INDEX IF NOT EXISTS idx_comm_events_created
  ON public.comm_events (created_at DESC);

CREATE TABLE IF NOT EXISTS public.pending_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT NOT NULL,
  conversation_id UUID REFERENCES public.tg_conversations(id),
  draft_text TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_messages_chat_id
  ON public.pending_messages (chat_id);
CREATE INDEX IF NOT EXISTS idx_pending_messages_status
  ON public.pending_messages (status);
CREATE INDEX IF NOT EXISTS idx_pending_messages_created
  ON public.pending_messages (created_at DESC);

ALTER TABLE public.tg_conversation_sessions
  ADD COLUMN IF NOT EXISTS conv_id UUID REFERENCES public.tg_conversations(id);

-- These tables contain internal communication data and are accessed only by
-- the server-side service-role client.
ALTER TABLE public.tg_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tg_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comm_dlq ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tg_contacts FROM anon, authenticated;
REVOKE ALL ON TABLE public.tg_conversations FROM anon, authenticated;
REVOKE ALL ON TABLE public.comm_messages FROM anon, authenticated;
REVOKE ALL ON TABLE public.comm_dlq FROM anon, authenticated;
REVOKE ALL ON TABLE public.comm_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.pending_messages FROM anon, authenticated;
