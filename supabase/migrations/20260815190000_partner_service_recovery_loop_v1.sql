-- Partner Service Recovery Loop v1.
-- Additive, service-role-only state. This migration prepares follow-ups but
-- never sends messages, applies compensation, or calls a partner provider.

ALTER TABLE public.partner_communication_decisions
  ADD CONSTRAINT partner_communication_decisions_account_id_id_key UNIQUE (account_id, id);

ALTER TABLE public.partner_communication_actions
  ADD COLUMN public_action_ref TEXT;

UPDATE public.partner_communication_actions
SET public_action_ref = 'pact_' || encode(gen_random_bytes(24), 'hex')
WHERE public_action_ref IS NULL;

ALTER TABLE public.partner_communication_actions
  ALTER COLUMN public_action_ref SET NOT NULL,
  ALTER COLUMN public_action_ref SET DEFAULT ('pact_' || encode(gen_random_bytes(24), 'hex')),
  ADD CONSTRAINT partner_communication_actions_public_ref_format CHECK (
    public_action_ref ~ '^pact_[A-Za-z0-9_-]{32,96}$'
  ),
  ADD CONSTRAINT partner_communication_actions_public_ref_key UNIQUE (public_action_ref);

CREATE TABLE public.partner_service_recovery_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  source_inbox_id UUID NOT NULL,
  source_decision_id UUID NOT NULL,
  action_id UUID,
  handoff_id UUID,
  public_recovery_ref TEXT NOT NULL DEFAULT ('prec_' || encode(gen_random_bytes(24), 'hex')),
  category TEXT NOT NULL CHECK (category IN ('maintenance')),
  severity TEXT NOT NULL CHECK (severity IN ('normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'in_progress', 'awaiting_guest_confirmation', 'recovered', 'unrecovered', 'closed')
  ),
  issue_summary TEXT CHECK (issue_summary IS NULL OR char_length(issue_summary) BETWEEN 1 AND 500),
  followup_text TEXT CHECK (followup_text IS NULL OR char_length(followup_text) BETWEEN 1 AND 1000),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('satisfied', 'not_satisfied')),
  opened_at TIMESTAMPTZ NOT NULL,
  work_started_at TIMESTAMPTZ,
  operation_resolved_at TIMESTAMPTZ,
  followup_prepared_at TIMESTAMPTZ,
  guest_confirmed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_service_recovery_cases_account_id_id_key UNIQUE (account_id, id),
  CONSTRAINT partner_service_recovery_cases_source_key UNIQUE (account_id, source_decision_id),
  CONSTRAINT partner_service_recovery_cases_public_ref_key UNIQUE (public_recovery_ref),
  CONSTRAINT partner_service_recovery_cases_public_ref_format CHECK (
    public_recovery_ref ~ '^prec_[A-Za-z0-9_-]{32,96}$'
  ),
  CONSTRAINT partner_service_recovery_cases_session_fk FOREIGN KEY (account_id, session_id)
    REFERENCES public.partner_communication_sessions(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_service_recovery_cases_inbox_fk FOREIGN KEY (account_id, source_inbox_id)
    REFERENCES public.partner_communication_inbox(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_service_recovery_cases_decision_fk FOREIGN KEY (account_id, source_decision_id)
    REFERENCES public.partner_communication_decisions(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_service_recovery_cases_action_fk FOREIGN KEY (account_id, action_id)
    REFERENCES public.partner_communication_actions(account_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_service_recovery_cases_handoff_fk FOREIGN KEY (account_id, handoff_id)
    REFERENCES public.partner_communication_handoffs(account_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_service_recovery_cases_state_check CHECK (
    (status IN ('open', 'in_progress') AND outcome IS NULL AND guest_confirmed_at IS NULL AND closed_at IS NULL)
    OR (status = 'awaiting_guest_confirmation' AND outcome IS NULL AND operation_resolved_at IS NOT NULL
        AND followup_text IS NOT NULL AND followup_prepared_at IS NOT NULL AND guest_confirmed_at IS NULL AND closed_at IS NULL)
    OR (status = 'recovered' AND outcome = 'satisfied' AND guest_confirmed_at IS NOT NULL AND closed_at IS NOT NULL)
    OR (status = 'unrecovered' AND outcome = 'not_satisfied' AND guest_confirmed_at IS NOT NULL AND closed_at IS NULL)
    OR (status = 'closed' AND closed_at IS NOT NULL)
  )
);

CREATE INDEX idx_partner_service_recovery_cases_account_status
  ON public.partner_service_recovery_cases (account_id, status, updated_at DESC);
CREATE INDEX idx_partner_service_recovery_cases_account_session
  ON public.partner_service_recovery_cases (account_id, session_id, created_at DESC);

CREATE TABLE public.partner_service_recovery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  partner_id TEXT NOT NULL CHECK (char_length(partner_id) BETWEEN 1 AND 200),
  external_partner_account_id TEXT NOT NULL CHECK (char_length(external_partner_account_id) BETWEEN 1 AND 200),
  external_event_id TEXT NOT NULL CHECK (char_length(external_event_id) BETWEEN 1 AND 200),
  event_type TEXT NOT NULL CHECK (event_type IN ('operation.updated', 'guest.resolution.confirmed')),
  event_fingerprint TEXT NOT NULL CHECK (event_fingerprint ~ '^[a-f0-9]{64}$'),
  external_property_id TEXT NOT NULL CHECK (char_length(external_property_id) BETWEEN 1 AND 200),
  external_booking_id TEXT NOT NULL CHECK (char_length(external_booking_id) BETWEEN 1 AND 200),
  external_conversation_id TEXT NOT NULL CHECK (char_length(external_conversation_id) BETWEEN 1 AND 200),
  public_action_ref TEXT CHECK (public_action_ref IS NULL OR char_length(public_action_ref) BETWEEN 37 AND 101),
  public_recovery_ref TEXT CHECK (public_recovery_ref IS NULL OR char_length(public_recovery_ref) BETWEEN 37 AND 101),
  operation_status TEXT CHECK (operation_status IS NULL OR operation_status IN ('requested', 'in_progress', 'resolved', 'blocked')),
  resolution_summary TEXT CHECK (resolution_summary IS NULL OR char_length(resolution_summary) BETWEEN 1 AND 1000),
  satisfied BOOLEAN,
  guest_feedback TEXT CHECK (guest_feedback IS NULL OR char_length(guest_feedback) BETWEEN 1 AND 1000),
  response JSONB CHECK (response IS NULL OR (jsonb_typeof(response) = 'object' AND octet_length(response::text) <= 8192)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT partner_service_recovery_events_identity_key UNIQUE (
    account_id, partner_id, external_partner_account_id, external_event_id
  ),
  CONSTRAINT partner_service_recovery_events_shape_check CHECK (
    (event_type = 'operation.updated' AND public_action_ref IS NOT NULL AND public_recovery_ref IS NULL
      AND operation_status IS NOT NULL AND satisfied IS NULL AND guest_feedback IS NULL)
    OR
    (event_type = 'guest.resolution.confirmed' AND public_recovery_ref IS NOT NULL
      AND public_action_ref IS NULL AND operation_status IS NULL AND resolution_summary IS NULL AND satisfied IS NOT NULL)
  )
);

CREATE INDEX idx_partner_service_recovery_events_account_created
  ON public.partner_service_recovery_events (account_id, created_at DESC);

CREATE TRIGGER partner_service_recovery_cases_updated_at
BEFORE UPDATE ON public.partner_service_recovery_cases
FOR EACH ROW EXECUTE FUNCTION public.set_partner_communication_updated_at();

ALTER TABLE public.partner_service_recovery_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_service_recovery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_service_recovery_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_service_recovery_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.partner_service_recovery_cases FROM anon, authenticated;
REVOKE ALL ON TABLE public.partner_service_recovery_events FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.partner_service_recovery_cases,
  public.partner_service_recovery_events
TO service_role;

COMMENT ON COLUMN public.partner_communication_actions.public_action_ref IS
  'Opaque stable partner-facing action reference; never an internal row identifier.';
COMMENT ON TABLE public.partner_service_recovery_cases IS
  'Tenant-scoped service recovery outcome ledger; operational resolution is distinct from guest recovery.';
COMMENT ON TABLE public.partner_service_recovery_events IS
  'Normalized idempotent partner recovery updates without raw payloads or outbound effects.';
