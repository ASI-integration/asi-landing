-- Telegram Identity + Conversation Memory v1.
-- Persistent role/scenario/property binding per telegram_user_id (not username).

CREATE TABLE IF NOT EXISTS public.tg_telegram_conversation_memory (
  telegram_user_id TEXT PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  telegram_username TEXT,
  display_name TEXT,
  crm_contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'unknown'
    CHECK (role IN ('guest', 'owner', 'lead', 'support', 'tester', 'operator', 'unknown')),
  active_scenario TEXT
    CHECK (
      active_scenario IS NULL
      OR active_scenario IN ('owner_onboarding', 'guest_test', 'support', 'emergency')
    ),
  property_id TEXT,
  guest_test_active BOOLEAN NOT NULL DEFAULT FALSE,
  communication_mode TEXT NOT NULL DEFAULT 'autopilot'
    CHECK (communication_mode IN ('manual', 'draft', 'autopilot')),
  lead_source TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_telegram_conversation_memory_chat_id
  ON public.tg_telegram_conversation_memory (chat_id);

CREATE INDEX IF NOT EXISTS idx_tg_telegram_conversation_memory_crm_contact
  ON public.tg_telegram_conversation_memory (crm_contact_id)
  WHERE crm_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tg_telegram_conversation_memory_guest_test
  ON public.tg_telegram_conversation_memory (guest_test_active, property_id)
  WHERE guest_test_active = TRUE;

ALTER TABLE public.tg_telegram_conversation_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON public.tg_telegram_conversation_memory;
CREATE POLICY "service_role_full_access"
  ON public.tg_telegram_conversation_memory
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- CRM events: guest_test results and operator follow-up loop.
ALTER TABLE public.crm_events
  DROP CONSTRAINT IF EXISTS crm_events_type_check;

ALTER TABLE public.crm_events
  ADD CONSTRAINT crm_events_type_check
  CHECK (
    event_type IN (
      'escalation',
      'missing_data',
      'blocked',
      'auto_reply',
      'message_inbound',
      'message_outbound',
      'role_selected_owner',
      'role_selected_lead',
      'role_selected_guest',
      'guest_test_ready',
      'guest_test_started',
      'guest_test_question',
      'operator_followup_required',
      'operator_followup_sent',
      'pilot_application_submitted',
      'pilot_selected',
      'status_change',
      'note'
    )
  );
