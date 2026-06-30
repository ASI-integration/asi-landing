-- Check-in Execution Autopilot v1.
-- Internal execution state only. Access secrets must be stored by reference only.

CREATE TABLE IF NOT EXISTS public.booking_checkin_execution (
  id UUID PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_ready',
  instructions_status TEXT NOT NULL DEFAULT 'not_prepared',
  arrival_status TEXT NOT NULL DEFAULT 'unknown',
  access_status TEXT NOT NULL DEFAULT 'unknown',
  planned_arrival_at TIMESTAMPTZ,
  actual_checkin_at TIMESTAMPTZ,
  access_method TEXT,
  access_secret_ref TEXT,
  last_guest_touch_at TIMESTAMPTZ,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_checkin_execution_booking_unique UNIQUE (booking_id),
  CONSTRAINT booking_checkin_execution_status_check
    CHECK (status IN (
      'not_ready',
      'ready_to_send_instructions',
      'instructions_queued',
      'instructions_sent',
      'arrival_pending',
      'arrival_confirmed',
      'access_ready',
      'access_issue',
      'checked_in',
      'blocked'
    )),
  CONSTRAINT booking_checkin_execution_instructions_check
    CHECK (instructions_status IN ('not_prepared', 'prepared', 'queued', 'sent', 'failed')),
  CONSTRAINT booking_checkin_execution_arrival_check
    CHECK (arrival_status IN ('unknown', 'requested', 'confirmed', 'missed', 'changed')),
  CONSTRAINT booking_checkin_execution_access_check
    CHECK (access_status IN ('unknown', 'ready', 'issue', 'resolved'))
);

CREATE INDEX IF NOT EXISTS idx_booking_checkin_execution_updated
  ON public.booking_checkin_execution (updated_at DESC);

ALTER TABLE public.booking_checkin_execution ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_checkin_execution FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_checkin_execution TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_checkin_execution;
CREATE POLICY "service_role_full_access"
  ON public.booking_checkin_execution
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.booking_ops_communication_intents
  DROP CONSTRAINT IF EXISTS booking_ops_communication_purpose_check;

ALTER TABLE public.booking_ops_communication_intents
  ADD CONSTRAINT booking_ops_communication_purpose_check
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
      'checkin_instructions',
      'arrival_confirmation_request',
      'access_issue_followup',
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
    ));

NOTIFY pgrst, 'reload schema';
