-- Booking Ops Guest Intake Autopilot v1.
-- Internal intake state only. No uncontrolled outbound Telegram/email sending.

CREATE TABLE IF NOT EXISTS public.booking_ops_guest_intake_sessions (
  id UUID PRIMARY KEY,
  booking_ops_record_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  booking_id TEXT,
  intake_status TEXT NOT NULL DEFAULT 'not_started',
  missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  collected_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  channel TEXT NOT NULL DEFAULT 'manual',
  guest_contact_ref TEXT,
  last_guest_activity_at TIMESTAMPTZ,
  fallback_reason TEXT,
  generated_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_ops_guest_intake_status_check
    CHECK (intake_status IN (
      'not_started',
      'waiting_for_guest',
      'partially_completed',
      'validation_needed',
      'completed',
      'fallback_required',
      'expired'
    )),
  CONSTRAINT booking_ops_guest_intake_channel_check
    CHECK (channel IN ('telegram', 'web', 'manual')),
  CONSTRAINT booking_ops_guest_intake_missing_array_check
    CHECK (jsonb_typeof(missing_fields) = 'array'),
  CONSTRAINT booking_ops_guest_intake_errors_array_check
    CHECK (jsonb_typeof(validation_errors) = 'array'),
  CONSTRAINT booking_ops_guest_intake_collected_object_check
    CHECK (jsonb_typeof(collected_fields) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_ops_guest_intake_record
  ON public.booking_ops_guest_intake_sessions (booking_ops_record_id);

CREATE INDEX IF NOT EXISTS idx_booking_ops_guest_intake_booking
  ON public.booking_ops_guest_intake_sessions (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_ops_guest_intake_status
  ON public.booking_ops_guest_intake_sessions (intake_status, updated_at DESC);

ALTER TABLE public.booking_ops_guest_intake_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_ops_guest_intake_sessions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_ops_guest_intake_sessions TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_ops_guest_intake_sessions;
CREATE POLICY "service_role_full_access"
  ON public.booking_ops_guest_intake_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.booking_ops_tasks
  DROP CONSTRAINT IF EXISTS booking_ops_tasks_type_check;

ALTER TABLE public.booking_ops_tasks
  ADD CONSTRAINT booking_ops_tasks_type_check
    CHECK (task_type IN (
      'complete_booking_data',
      'request_guest_documents',
      'verify_guest_documents',
      'prepare_contract',
      'send_contract_manual',
      'follow_up_contract_signature',
      'request_deposit',
      'confirm_deposit',
      'track_deposit_return',
      'collect_mvd_data',
      'prepare_mvd_report',
      'submit_mvd_report',
      'generate_telegram_drafts',
      'review_telegram_drafts',
      'manual_send_telegram_drafts',
      'checkout_confirmed',
      'cleaning_needed',
      'cleaning_assigned',
      'cleaning_in_progress',
      'cleaning_done',
      'unit_inspection_needed',
      'unit_ready_for_next_guest',
      'linen_pickup_needed',
      'linen_replaced',
      'laundry_dropoff_needed',
      'laundry_return_needed',
      'supplies_check_needed',
      'inspection_needed',
      'maintenance_needed',
      'unit_ready_confirmation',
      'guest_intake_operator_fallback'
    ));

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
      'communication_waiting_for_external_input',
      'guest_intake_started',
      'guest_intake_updated',
      'guest_intake_completed',
      'guest_intake_fallback_required',
      'guest_intake_waiting_for_guest'
    ));

NOTIFY pgrst, 'reload schema';
