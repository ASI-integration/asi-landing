-- Create the Telegram conversation persistence tables before their RLS
-- policies are applied by 20260325000001_rls_policies_telegram_payments.sql.

CREATE TABLE IF NOT EXISTS public.tg_conversation_sessions (
  chat_id BIGINT PRIMARY KEY,
  guest_id TEXT,
  property_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tg_message_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT NOT NULL REFERENCES public.tg_conversation_sessions(chat_id),
  update_id BIGINT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  category TEXT,
  lang TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_message_turns_chat_created_at
  ON public.tg_message_turns (chat_id, created_at);
