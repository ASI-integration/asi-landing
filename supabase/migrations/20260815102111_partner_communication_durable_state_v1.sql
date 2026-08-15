-- Partner Communication Durable State v1.
-- Additive, service-role-only persistence foundation. This migration does not
-- activate a partner route, provider call, worker, or message delivery path.

CREATE TABLE public.partner_account_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  partner_id TEXT NOT NULL CHECK (char_length(partner_id) BETWEEN 1 AND 200),
  external_account_id TEXT NOT NULL CHECK (char_length(external_account_id) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_account_bindings_external_identity_key
    UNIQUE (partner_id, external_account_id)
);

CREATE INDEX idx_partner_account_bindings_account
  ON public.partner_account_bindings (account_id, status, updated_at DESC);

CREATE TABLE public.partner_communication_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  partner_id TEXT NOT NULL CHECK (char_length(partner_id) BETWEEN 1 AND 200),
  external_partner_account_id TEXT NOT NULL
    CHECK (char_length(external_partner_account_id) BETWEEN 1 AND 200),
  canonical_conversation_key TEXT NOT NULL
    CHECK (char_length(canonical_conversation_key) BETWEEN 1 AND 800),
  external_property_id TEXT NOT NULL CHECK (char_length(external_property_id) BETWEEN 1 AND 200),
  external_booking_id TEXT NOT NULL CHECK (char_length(external_booking_id) BETWEEN 1 AND 200),
  external_guest_id TEXT CHECK (
    external_guest_id IS NULL OR char_length(external_guest_id) BETWEEN 1 AND 200
  ),
  external_conversation_id TEXT NOT NULL
    CHECK (char_length(external_conversation_id) BETWEEN 1 AND 200),
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'awaiting_input', 'escalated', 'resolved')),
  summary TEXT CHECK (summary IS NULL OR char_length(summary) BETWEEN 1 AND 2000),
  state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_communication_sessions_account_id_id_key UNIQUE (account_id, id),
  CONSTRAINT partner_communication_sessions_canonical_identity_key UNIQUE (
    account_id,
    partner_id,
    external_partner_account_id,
    canonical_conversation_key
  ),
  CONSTRAINT partner_communication_sessions_external_identity_key UNIQUE (
    account_id,
    partner_id,
    external_partner_account_id,
    external_conversation_id
  )
);

CREATE INDEX idx_partner_communication_sessions_account_updated
  ON public.partner_communication_sessions (account_id, updated_at DESC);
CREATE INDEX idx_partner_communication_sessions_account_booking
  ON public.partner_communication_sessions (account_id, partner_id, external_booking_id);
CREATE INDEX idx_partner_communication_sessions_account_property
  ON public.partner_communication_sessions (account_id, partner_id, external_property_id);

CREATE TABLE public.partner_communication_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  canonical_message_key TEXT NOT NULL CHECK (char_length(canonical_message_key) BETWEEN 1 AND 800),
  external_message_id TEXT NOT NULL CHECK (char_length(external_message_id) BETWEEN 1 AND 200),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'operator', 'system')),
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4096),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object'
    AND octet_length(metadata::text) <= 4096
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_communication_turns_session_fk
    FOREIGN KEY (account_id, session_id)
    REFERENCES public.partner_communication_sessions(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT partner_communication_turns_message_key UNIQUE (
    account_id,
    session_id,
    canonical_message_key
  ),
  CONSTRAINT partner_communication_turns_external_message_key UNIQUE (
    account_id,
    session_id,
    external_message_id
  )
);

CREATE INDEX idx_partner_communication_turns_account_session_created
  ON public.partner_communication_turns (account_id, session_id, created_at DESC);

CREATE TABLE public.partner_communication_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'acknowledged', 'resolved', 'cancelled')),
  reason_code TEXT NOT NULL CHECK (char_length(reason_code) BETWEEN 1 AND 120),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_operator_id UUID,
  resolution_summary TEXT CHECK (
    resolution_summary IS NULL OR char_length(resolution_summary) BETWEEN 1 AND 1000
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_communication_handoffs_account_id_id_key UNIQUE (account_id, id),
  CONSTRAINT partner_communication_handoffs_session_fk
    FOREIGN KEY (account_id, session_id)
    REFERENCES public.partner_communication_sessions(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT partner_communication_handoffs_timestamp_check CHECK (
    (status IN ('pending', 'acknowledged') AND resolved_at IS NULL)
    OR (status IN ('resolved', 'cancelled') AND resolved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_partner_communication_handoffs_one_active
  ON public.partner_communication_handoffs (account_id, session_id)
  WHERE status IN ('pending', 'acknowledged');
CREATE INDEX idx_partner_communication_handoffs_account_status
  ON public.partner_communication_handoffs (account_id, status, updated_at DESC);

CREATE TABLE public.partner_communication_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 800),
  action_type TEXT NOT NULL CHECK (char_length(action_type) BETWEEN 1 AND 120),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'recommended' CHECK (
    status IN ('recommended', 'requested', 'in_progress', 'resolved', 'blocked', 'cancelled')
  ),
  reason_code TEXT NOT NULL CHECK (char_length(reason_code) BETWEEN 1 AND 120),
  external_action_reference TEXT CHECK (
    external_action_reference IS NULL OR char_length(external_action_reference) BETWEEN 1 AND 200
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT partner_communication_actions_account_id_id_key UNIQUE (account_id, id),
  CONSTRAINT partner_communication_actions_session_fk
    FOREIGN KEY (account_id, session_id)
    REFERENCES public.partner_communication_sessions(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT partner_communication_actions_idempotency_key UNIQUE (
    account_id,
    session_id,
    idempotency_key
  ),
  CONSTRAINT partner_communication_actions_resolved_timestamp_check CHECK (
    status <> 'resolved' OR resolved_at IS NOT NULL
  )
);

CREATE INDEX idx_partner_communication_actions_account_status
  ON public.partner_communication_actions (account_id, status, updated_at DESC);
CREATE INDEX idx_partner_communication_actions_account_session
  ON public.partner_communication_actions (account_id, session_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_partner_communication_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER partner_account_bindings_updated_at
BEFORE UPDATE ON public.partner_account_bindings
FOR EACH ROW EXECUTE FUNCTION public.set_partner_communication_updated_at();

CREATE TRIGGER partner_communication_sessions_updated_at
BEFORE UPDATE ON public.partner_communication_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_partner_communication_updated_at();

CREATE TRIGGER partner_communication_handoffs_updated_at
BEFORE UPDATE ON public.partner_communication_handoffs
FOR EACH ROW EXECUTE FUNCTION public.set_partner_communication_updated_at();

CREATE TRIGGER partner_communication_actions_updated_at
BEFORE UPDATE ON public.partner_communication_actions
FOR EACH ROW EXECUTE FUNCTION public.set_partner_communication_updated_at();

ALTER TABLE public.partner_account_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_communication_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_communication_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_communication_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_communication_actions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.partner_account_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_communication_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_communication_turns FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_communication_handoffs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_communication_actions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.partner_account_bindings FROM anon, authenticated;
REVOKE ALL ON TABLE public.partner_communication_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.partner_communication_turns FROM anon, authenticated;
REVOKE ALL ON TABLE public.partner_communication_handoffs FROM anon, authenticated;
REVOKE ALL ON TABLE public.partner_communication_actions FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.partner_account_bindings,
  public.partner_communication_sessions,
  public.partner_communication_turns,
  public.partner_communication_handoffs,
  public.partner_communication_actions
TO service_role;

COMMENT ON TABLE public.partner_account_bindings IS
  'Server-side external partner account to canonical ASI account binding; no credentials or secrets.';
COMMENT ON TABLE public.partner_communication_sessions IS
  'Tenant-scoped durable partner conversation state; service-role only.';
COMMENT ON TABLE public.partner_communication_turns IS
  'Bounded partner conversation turns without raw provider payloads; service-role only.';
COMMENT ON TABLE public.partner_communication_handoffs IS
  'Durable human handoff state with at most one active handoff per tenant-scoped session.';
COMMENT ON TABLE public.partner_communication_actions IS
  'Idempotent partner operational action ledger; state only and no provider execution.';
