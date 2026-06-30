-- In-stay & Checkout Autopilot v1.
-- Operational state for post-check-in period. No access secrets or payment details.

CREATE TABLE IF NOT EXISTS public.booking_instay_checkout (
  id UUID PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_checked_in',
  checkout_instructions_status TEXT NOT NULL DEFAULT 'not_prepared',
  checkout_confirmation_status TEXT NOT NULL DEFAULT 'not_requested',
  planned_checkout_at TIMESTAMPTZ,
  actual_checkout_at TIMESTAMPTZ,
  inspection_status TEXT NOT NULL DEFAULT 'not_started',
  deposit_return_status TEXT NOT NULL DEFAULT 'not_ready',
  closure_status TEXT NOT NULL DEFAULT 'open',
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_instay_checkout_booking_unique UNIQUE (booking_id),
  CONSTRAINT booking_instay_checkout_status_check
    CHECK (status IN (
      'not_checked_in',
      'in_stay',
      'guest_issue_open',
      'guest_issue_blocked',
      'checkout_preparing',
      'checkout_instructions_queued',
      'checkout_pending',
      'checked_out',
      'inspection_pending',
      'inspection_done',
      'deposit_return_ready',
      'ready_to_close',
      'closed',
      'blocked'
    )),
  CONSTRAINT booking_instay_checkout_instructions_check
    CHECK (checkout_instructions_status IN ('not_prepared', 'prepared', 'queued', 'sent', 'failed')),
  CONSTRAINT booking_instay_checkout_confirmation_check
    CHECK (checkout_confirmation_status IN ('not_requested', 'requested', 'confirmed', 'missed')),
  CONSTRAINT booking_instay_checkout_inspection_check
    CHECK (inspection_status IN ('not_started', 'scheduled', 'done', 'issue_found', 'failed')),
  CONSTRAINT booking_instay_checkout_deposit_check
    CHECK (deposit_return_status IN ('not_ready', 'ready', 'held', 'partially_held', 'returned', 'waived')),
  CONSTRAINT booking_instay_checkout_closure_check
    CHECK (closure_status IN ('open', 'ready_to_close', 'closed', 'blocked'))
);

CREATE INDEX IF NOT EXISTS idx_booking_instay_checkout_updated
  ON public.booking_instay_checkout (updated_at DESC);

ALTER TABLE public.booking_instay_checkout ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_instay_checkout FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_instay_checkout TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_instay_checkout;
CREATE POLICY "service_role_full_access"
  ON public.booking_instay_checkout
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.booking_guest_stay_issues (
  id UUID PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT NOT NULL DEFAULT 'guest',
  description TEXT,
  resolution TEXT,
  assigned_to_type TEXT,
  assigned_to_ref TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_guest_stay_issues_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'urgent')),
  CONSTRAINT booking_guest_stay_issues_status_check
    CHECK (status IN ('open', 'triaged', 'assigned', 'resolved', 'blocked', 'cancelled')),
  CONSTRAINT booking_guest_stay_issues_source_check
    CHECK (source IN ('guest', 'admin', 'cleaner', 'master', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_booking_guest_stay_issues_booking
  ON public.booking_guest_stay_issues (booking_id, status, updated_at DESC);

ALTER TABLE public.booking_guest_stay_issues ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_guest_stay_issues FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_guest_stay_issues TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_guest_stay_issues;
CREATE POLICY "service_role_full_access"
  ON public.booking_guest_stay_issues
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
      'checkout_instructions',
      'checkout_confirmation_request',
      'guest_issue_acknowledgement',
      'guest_stay_issue_followup',
      'deposit_return_readiness_notice',
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
