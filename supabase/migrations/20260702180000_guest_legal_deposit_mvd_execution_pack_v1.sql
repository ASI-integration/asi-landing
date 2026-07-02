-- Guest Legal, Deposit & MVD Execution Pack v1.
-- Manual/provider placeholders only. No external legal, payment, or MVD calls.

ALTER TABLE public.booking_guest_documents
  DROP CONSTRAINT IF EXISTS booking_guest_documents_status_check;
ALTER TABLE public.booking_guest_documents
  ALTER COLUMN status SET DEFAULT 'not_requested';
ALTER TABLE public.booking_guest_documents
  ADD CONSTRAINT booking_guest_documents_status_check CHECK (status IN (
    'not_requested', 'requested', 'partially_received', 'received', 'needs_review',
    'verified', 'rejected', 'blocked', 'expired', 'missing'
  ));

ALTER TABLE public.booking_contracts
  DROP CONSTRAINT IF EXISTS booking_contracts_status_check;
ALTER TABLE public.booking_contracts
  ADD CONSTRAINT booking_contracts_status_check CHECK (status IN (
    'not_started', 'draft_needed', 'draft_ready', 'sent_for_signature_placeholder',
    'signed_manual', 'signed_provider_placeholder', 'needs_review', 'blocked',
    'prepared', 'sent', 'signed', 'rejected', 'expired', 'failed'
  ));

ALTER TABLE public.booking_deposits
  DROP CONSTRAINT IF EXISTS booking_deposits_status_check;
ALTER TABLE public.booking_deposits
  ADD CONSTRAINT booking_deposits_status_check CHECK (status IN (
    'not_requested', 'request_draft_ready', 'requested_placeholder', 'pending',
    'paid_manual', 'paid_provider_placeholder', 'failed', 'refunded_manual',
    'disputed', 'waived_manual', 'blocked', 'requested', 'received', 'refunded',
    'partially_refunded', 'waived'
  ));

ALTER TABLE public.booking_mvd_reports
  DROP CONSTRAINT IF EXISTS booking_mvd_reports_status_check;
ALTER TABLE public.booking_mvd_reports
  ADD CONSTRAINT booking_mvd_reports_status_check CHECK (status IN (
    'not_required', 'not_started', 'data_needed', 'draft_ready', 'export_ready',
    'submitted_manual', 'submitted_provider_placeholder', 'accepted_manual',
    'rejected', 'needs_review', 'blocked', 'prepared', 'submitted', 'accepted', 'failed'
  ));

CREATE TABLE IF NOT EXISTS public.booking_guest_legal_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_setup_id UUID,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'incomplete' CHECK (status IN (
    'incomplete', 'ready_for_operator_review', 'ready_for_checkin', 'blocked'
  )),
  documents_status TEXT NOT NULL DEFAULT 'not_requested',
  contract_status TEXT NOT NULL DEFAULT 'not_started',
  deposit_status TEXT NOT NULL DEFAULT 'not_requested',
  mvd_status TEXT NOT NULL DEFAULT 'not_started',
  availability_status TEXT,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blockers) = 'array'),
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  safe_summary TEXT,
  last_checked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_guest_legal_readiness_property
  ON public.booking_guest_legal_readiness (property_setup_id, property_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_legal_execution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'documents_requested', 'documents_received', 'documents_verified',
    'contract_draft_created', 'contract_signed_manual', 'deposit_request_created',
    'deposit_paid_manual', 'deposit_waived_manual', 'mvd_draft_created',
    'mvd_export_ready', 'mvd_submitted_manual', 'mvd_accepted_manual',
    'mvd_not_required', 'readiness_recomputed', 'checkin_blocked',
    'legal_flow_blocked', 'note_added'
  )),
  status TEXT NOT NULL,
  safe_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_legal_execution_events_booking
  ON public.booking_legal_execution_events (booking_id, created_at DESC);

ALTER TABLE public.booking_guest_legal_readiness ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_legal_execution_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_guest_legal_readiness FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_legal_execution_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_guest_legal_readiness TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_legal_execution_events TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_guest_legal_readiness;
CREATE POLICY "service_role_full_access" ON public.booking_guest_legal_readiness
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_legal_execution_events;
CREATE POLICY "service_role_full_access" ON public.booking_legal_execution_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
