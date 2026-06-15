-- Internal CRM v1: contacts and communication events for early access / pilots.

CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'unknown',
  source TEXT NOT NULL DEFAULT 'manual',
  contact TEXT,
  telegram_user_id TEXT,
  telegram_username TEXT,
  telegram_chat_id TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  property_id TEXT,
  property_count INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  next_action_due_at TIMESTAMPTZ,
  last_message TEXT,
  last_activity_at TIMESTAMPTZ,
  lead_id UUID,
  awaiting_reply BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT crm_contacts_role_check
    CHECK (role IN ('lead', 'owner', 'manager', 'guest', 'unknown')),

  CONSTRAINT crm_contacts_source_check
    CHECK (source IN ('telegram', 'landing', 'manual', 'test')),

  CONSTRAINT crm_contacts_status_check
    CHECK (
      status IN (
        'new',
        'needs_clarification',
        'qualified',
        'creating_object',
        'object_filled',
        'testing_communication',
        'pilot_active',
        'paused',
        'not_fit'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_telegram_user_id
  ON public.crm_contacts (telegram_user_id)
  WHERE telegram_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_telegram_chat_id
  ON public.crm_contacts (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_status_activity
  ON public.crm_contacts (status, last_activity_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_property_id
  ON public.crm_contacts (property_id)
  WHERE property_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.crm_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message_text TEXT,
  property_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT crm_events_type_check
    CHECK (
      event_type IN (
        'escalation',
        'missing_data',
        'blocked',
        'auto_reply',
        'message_inbound',
        'message_outbound',
        'status_change',
        'note'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_crm_events_contact_created
  ON public.crm_events (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_events_unack_escalation
  ON public.crm_events (contact_id, created_at DESC)
  WHERE acknowledged_at IS NULL AND event_type IN ('escalation', 'missing_data');

ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.crm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.crm_contacts FROM anon, authenticated;
REVOKE ALL ON TABLE public.crm_events FROM anon, authenticated;

DROP POLICY IF EXISTS "service_role_full_access" ON public.crm_contacts;
DROP POLICY IF EXISTS "service_role_full_access" ON public.crm_events;

CREATE POLICY "service_role_full_access"
  ON public.crm_contacts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access"
  ON public.crm_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
