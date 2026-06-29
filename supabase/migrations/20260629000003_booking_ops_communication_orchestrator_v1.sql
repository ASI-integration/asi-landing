-- Booking Ops Communication Orchestrator v1.
-- Internal intents/drafts only. No external Telegram or email sending.

CREATE TABLE IF NOT EXISTS public.booking_ops_communication_intents (
  id UUID PRIMARY KEY,
  booking_ops_record_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  booking_id TEXT,
  related_task_id UUID REFERENCES public.booking_ops_tasks(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL,
  actor_label TEXT,
  purpose TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'draft_ready',
  message_text TEXT NOT NULL,
  message_template_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ,
  CONSTRAINT booking_ops_communication_actor_check
    CHECK (actor_type IN ('guest', 'cleaner', 'laundry', 'master', 'admin', 'owner')),
  CONSTRAINT booking_ops_communication_purpose_check
    CHECK (purpose IN (
      'request_guest_documents',
      'request_contract_confirmation',
      'request_deposit_payment',
      'request_mvd_data',
      'send_checkin_instructions',
      'remind_guest_before_checkin',
      'checkout_reminder',
      'cleaning_assignment',
      'cleaning_reminder',
      'inspection_request',
      'issue_followup',
      'linen_pickup_request',
      'linen_delivery_request',
      'linen_status_check',
      'maintenance_request',
      'repair_status_check',
      'preparation_blocked_notice',
      'readiness_confirmation_needed',
      'guest_data_missing_notice',
      'unit_ready_notice',
      'issue_escalation_notice'
    )),
  CONSTRAINT booking_ops_communication_channel_check
    CHECK (channel IN ('telegram', 'email', 'phone', 'internal', 'manual')),
  CONSTRAINT booking_ops_communication_status_check
    CHECK (status IN ('draft_ready', 'waiting_for_external_input', 'completed', 'superseded', 'cancelled')),
  CONSTRAINT booking_ops_communication_message_check
    CHECK (length(trim(message_text)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_booking_ops_communication_record_updated
  ON public.booking_ops_communication_intents (booking_ops_record_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_ops_communication_booking
  ON public.booking_ops_communication_intents (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_ops_communication_active_key
  ON public.booking_ops_communication_intents (
    booking_ops_record_id,
    actor_type,
    purpose,
    COALESCE(related_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status IN ('draft_ready', 'waiting_for_external_input');

ALTER TABLE public.booking_ops_communication_intents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_ops_communication_intents FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_ops_communication_intents TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_ops_communication_intents;
CREATE POLICY "service_role_full_access"
  ON public.booking_ops_communication_intents
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.booking_ops_events
  DROP CONSTRAINT IF EXISTS booking_ops_events_event_type_check;

ALTER TABLE public.booking_ops_events
  ADD CONSTRAINT booking_ops_events_event_type_check
    CHECK (event_type IN (
      'booking_created',
      'booking_updated',
      'readiness_status_changed',
      'readiness_completed',
      'operational_task_created',
      'task_action_run',
      'telegram_draft_created',
      'telegram_draft_reused',
      'task_status_changed',
      'completion_effect_applied',
      'completion_effect_suggested',
      'turnover_started',
      'unit_readiness_changed',
      'communication_intent_created',
      'communication_draft_created',
      'communication_intent_superseded',
      'communication_waiting_for_external_input'
    ));

NOTIFY pgrst, 'reload schema';
