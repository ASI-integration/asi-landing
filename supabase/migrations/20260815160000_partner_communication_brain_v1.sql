-- Partner Communication Brain v1.
-- Additive, service-role-only authority mappings and decision ledger. Applying
-- this migration does not provision a partner, call a provider, or send a message.

ALTER TABLE public.properties
  ADD CONSTRAINT properties_account_id_id_key UNIQUE (account_id, id);

ALTER TABLE public.partner_account_bindings
  ADD CONSTRAINT partner_account_bindings_account_id_id_key UNIQUE (account_id, id);

ALTER TABLE public.partner_communication_inbox
  ADD CONSTRAINT partner_communication_inbox_account_id_id_key UNIQUE (account_id, id);

CREATE TABLE public.partner_property_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  partner_account_binding_id UUID NOT NULL,
  external_property_id TEXT NOT NULL CHECK (char_length(external_property_id) BETWEEN 1 AND 200),
  property_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_property_bindings_account_binding_fk
    FOREIGN KEY (account_id, partner_account_binding_id)
    REFERENCES public.partner_account_bindings(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_property_bindings_account_property_fk
    FOREIGN KEY (account_id, property_id)
    REFERENCES public.properties(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_property_bindings_external_key
    UNIQUE (partner_account_binding_id, external_property_id),
  CONSTRAINT partner_property_bindings_account_id_id_key UNIQUE (account_id, id)
);

CREATE INDEX idx_partner_property_bindings_account_property
  ON public.partner_property_bindings (account_id, property_id, status);

CREATE TABLE public.partner_booking_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  partner_account_binding_id UUID NOT NULL,
  external_booking_id TEXT NOT NULL CHECK (char_length(external_booking_id) BETWEEN 1 AND 200),
  booking_ops_record_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_booking_bindings_account_binding_fk
    FOREIGN KEY (account_id, partner_account_binding_id)
    REFERENCES public.partner_account_bindings(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_booking_bindings_account_property_fk
    FOREIGN KEY (account_id, property_id)
    REFERENCES public.properties(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_booking_bindings_external_key
    UNIQUE (partner_account_binding_id, external_booking_id),
  CONSTRAINT partner_booking_bindings_account_id_id_key UNIQUE (account_id, id)
);

CREATE INDEX idx_partner_booking_bindings_account_booking
  ON public.partner_booking_bindings (account_id, booking_ops_record_id, status);

CREATE FUNCTION public.enforce_partner_booking_binding_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  canonical_booking public.booking_ops_records%ROWTYPE;
BEGIN
  SELECT * INTO canonical_booking
  FROM public.booking_ops_records
  WHERE id = NEW.booking_ops_record_id;

  IF NOT FOUND
    OR canonical_booking.account_id IS DISTINCT FROM NEW.account_id::text
    OR canonical_booking.property_id IS DISTINCT FROM NEW.property_id::text
  THEN
    RAISE EXCEPTION 'partner_booking_binding_scope_mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER partner_booking_bindings_scope_guard
BEFORE INSERT OR UPDATE OF account_id, booking_ops_record_id, property_id
ON public.partner_booking_bindings
FOR EACH ROW EXECUTE FUNCTION public.enforce_partner_booking_binding_scope();

CREATE TABLE public.partner_communication_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  inbox_id UUID NOT NULL,
  session_id UUID NOT NULL,
  decision_type TEXT NOT NULL CHECK (decision_type IN ('reply', 'clarify', 'escalate', 'no_action')),
  policy TEXT NOT NULL CHECK (policy IN ('auto_allowed', 'review_required', 'blocked')),
  response_text TEXT CHECK (response_text IS NULL OR char_length(response_text) BETWEEN 1 AND 4096),
  confidence NUMERIC(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  reason_codes JSONB NOT NULL CHECK (
    jsonb_typeof(reason_codes) = 'array' AND jsonb_array_length(reason_codes) BETWEEN 1 AND 12
  ),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(evidence) = 'object' AND octet_length(evidence::text) <= 4096
  ),
  operational_actions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(operational_actions) = 'array' AND octet_length(operational_actions::text) <= 4096
  ),
  handoff JSONB CHECK (handoff IS NULL OR jsonb_typeof(handoff) = 'object'),
  resulting_state JSONB NOT NULL CHECK (jsonb_typeof(resulting_state) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_communication_decisions_inbox_fk
    FOREIGN KEY (account_id, inbox_id)
    REFERENCES public.partner_communication_inbox(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_communication_decisions_session_fk
    FOREIGN KEY (account_id, session_id)
    REFERENCES public.partner_communication_sessions(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_communication_decisions_one_per_inbox UNIQUE (account_id, inbox_id)
);

CREATE INDEX idx_partner_communication_decisions_account_session
  ON public.partner_communication_decisions (account_id, session_id, created_at DESC);

ALTER TABLE public.partner_communication_inbox
  DROP CONSTRAINT partner_communication_inbox_status_check,
  DROP CONSTRAINT partner_communication_inbox_processing_state_check,
  ADD CONSTRAINT partner_communication_inbox_status_check
    CHECK (status IN ('received', 'processing', 'processed', 'failed')),
  ADD CONSTRAINT partner_communication_inbox_processing_state_check CHECK (
    (status = 'processed' AND processed_at IS NOT NULL AND last_error_code IS NULL)
    OR (status = 'failed' AND processed_at IS NULL AND last_error_code IS NOT NULL)
    OR (status IN ('received', 'processing') AND processed_at IS NULL AND last_error_code IS NULL)
  );

CREATE TRIGGER partner_property_bindings_updated_at
BEFORE UPDATE ON public.partner_property_bindings
FOR EACH ROW EXECUTE FUNCTION public.set_partner_communication_updated_at();

CREATE TRIGGER partner_booking_bindings_updated_at
BEFORE UPDATE ON public.partner_booking_bindings
FOR EACH ROW EXECUTE FUNCTION public.set_partner_communication_updated_at();

CREATE TRIGGER partner_communication_decisions_updated_at
BEFORE UPDATE ON public.partner_communication_decisions
FOR EACH ROW EXECUTE FUNCTION public.set_partner_communication_updated_at();

CREATE OR REPLACE FUNCTION public.start_partner_communication_inbox_processing(
  target_account_id UUID,
  target_inbox_id UUID
)
RETURNS SETOF public.partner_communication_inbox
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.partner_communication_inbox inbox
  SET processing_attempts = processing_attempts + 1,
      status = 'processing',
      last_error_code = NULL,
      processed_at = NULL
  WHERE inbox.account_id = target_account_id
    AND inbox.id = target_inbox_id
    AND (
      inbox.status IN ('received', 'failed')
      OR (
        inbox.status = 'processed'
        AND NOT EXISTS (
          SELECT 1 FROM public.partner_communication_decisions decision
          WHERE decision.account_id = inbox.account_id AND decision.inbox_id = inbox.id
        )
      )
    )
  RETURNING inbox.*;
$$;

ALTER TABLE public.partner_property_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_booking_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_communication_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_property_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_booking_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_communication_decisions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.partner_property_bindings FROM anon, authenticated;
REVOKE ALL ON TABLE public.partner_booking_bindings FROM anon, authenticated;
REVOKE ALL ON TABLE public.partner_communication_decisions FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_partner_booking_binding_scope() FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.partner_property_bindings,
  public.partner_booking_bindings,
  public.partner_communication_decisions
TO service_role;

COMMENT ON TABLE public.partner_property_bindings IS
  'Server-authoritative external partner property to tenant-owned ASI property mapping.';
COMMENT ON TABLE public.partner_booking_bindings IS
  'Server-authoritative external partner booking to canonical tenant booking mapping.';
COMMENT ON TABLE public.partner_communication_decisions IS
  'One safe final partner response recommendation per authenticated inbox event; no model reasoning.';
