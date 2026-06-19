-- Restore CRM eventing required by Guest Concierge Autopilot v1 and Automation Loop v1.

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS property_id TEXT,
  ADD COLUMN IF NOT EXISTS last_message TEXT,
  ADD COLUMN IF NOT EXISTS lead_id UUID,
  ADD COLUMN IF NOT EXISTS awaiting_reply BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.crm_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message_text TEXT,
  property_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.crm_events DROP CONSTRAINT IF EXISTS crm_events_type_check;
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
      'guest_test_passed_basic',
      'guest_test_missing_data',
      'guest_concierge_answered',
      'operator_followup_required',
      'operator_followup_sent',
      'operator_reply_sent',
      'pilot_application_submitted',
      'pilot_selected',
      'status_change',
      'note'
    )
  );

CREATE INDEX IF NOT EXISTS idx_crm_events_contact_created
  ON public.crm_events (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_events_unack_reaction
  ON public.crm_events (contact_id, created_at DESC)
  WHERE acknowledged_at IS NULL AND event_type IN ('escalation', 'missing_data', 'guest_test_missing_data', 'operator_followup_required');

ALTER TABLE public.crm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON public.crm_events;
CREATE POLICY "service_role_full_access"
  ON public.crm_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
