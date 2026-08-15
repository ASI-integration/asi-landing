-- Partner Authenticated Inbox v1.
-- Additive, service-role-only input boundary. This migration does not provision
-- credentials, invoke AI, call a provider, or send a message.

CREATE TABLE public.partner_api_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_account_binding_id UUID NOT NULL
    REFERENCES public.partner_account_bindings(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE
    CHECK (char_length(credential_id) BETWEEN 1 AND 200),
  token_hash TEXT NOT NULL
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_partner_api_credentials_binding
  ON public.partner_api_credentials (partner_account_binding_id, status);

CREATE TABLE public.partner_communication_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  partner_id TEXT NOT NULL CHECK (char_length(partner_id) BETWEEN 1 AND 200),
  external_partner_account_id TEXT NOT NULL
    CHECK (char_length(external_partner_account_id) BETWEEN 1 AND 200),
  external_event_id TEXT NOT NULL CHECK (char_length(external_event_id) BETWEEN 1 AND 200),
  canonical_event_key TEXT NOT NULL CHECK (char_length(canonical_event_key) BETWEEN 1 AND 800),
  event_fingerprint TEXT NOT NULL CHECK (event_fingerprint ~ '^[0-9a-f]{64}$'),
  schema_version TEXT NOT NULL CHECK (char_length(schema_version) BETWEEN 1 AND 120),
  event_type TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 120),
  occurred_at TIMESTAMPTZ NOT NULL,
  external_property_id TEXT NOT NULL CHECK (char_length(external_property_id) BETWEEN 1 AND 200),
  external_booking_id TEXT NOT NULL CHECK (char_length(external_booking_id) BETWEEN 1 AND 200),
  external_guest_id TEXT CHECK (
    external_guest_id IS NULL OR char_length(external_guest_id) BETWEEN 1 AND 200
  ),
  external_conversation_id TEXT NOT NULL
    CHECK (char_length(external_conversation_id) BETWEEN 1 AND 200),
  external_message_id TEXT NOT NULL CHECK (char_length(external_message_id) BETWEEN 1 AND 200),
  message_text TEXT NOT NULL CHECK (char_length(message_text) BETWEEN 1 AND 4096),
  booking_status TEXT CHECK (
    booking_status IS NULL OR booking_status IN ('confirmed', 'checked_in', 'checked_out', 'cancelled')
  ),
  check_in_at TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  preferred_language TEXT CHECK (preferred_language IS NULL OR preferred_language = 'ru'),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
  processing_attempts INTEGER NOT NULL DEFAULT 0 CHECK (processing_attempts >= 0),
  last_error_code TEXT CHECK (
    last_error_code IS NULL OR char_length(last_error_code) BETWEEN 1 AND 120
  ),
  audit_ref TEXT NOT NULL UNIQUE CHECK (char_length(audit_ref) BETWEEN 20 AND 120),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_communication_inbox_event_identity_key UNIQUE (
    account_id,
    partner_id,
    external_partner_account_id,
    external_event_id
  ),
  CONSTRAINT partner_communication_inbox_canonical_event_key UNIQUE (
    account_id,
    canonical_event_key
  ),
  CONSTRAINT partner_communication_inbox_processing_state_check CHECK (
    (status = 'processed' AND processed_at IS NOT NULL AND last_error_code IS NULL)
    OR (status = 'failed' AND processed_at IS NULL AND last_error_code IS NOT NULL)
    OR (status = 'received' AND processed_at IS NULL AND last_error_code IS NULL)
  )
);

CREATE INDEX idx_partner_communication_inbox_account_status
  ON public.partner_communication_inbox (account_id, status, received_at);

CREATE TRIGGER partner_api_credentials_updated_at
BEFORE UPDATE ON public.partner_api_credentials
FOR EACH ROW EXECUTE FUNCTION public.set_partner_communication_updated_at();

CREATE TRIGGER partner_communication_inbox_updated_at
BEFORE UPDATE ON public.partner_communication_inbox
FOR EACH ROW EXECUTE FUNCTION public.set_partner_communication_updated_at();

CREATE FUNCTION public.start_partner_communication_inbox_processing(
  target_account_id UUID,
  target_inbox_id UUID
)
RETURNS SETOF public.partner_communication_inbox
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.partner_communication_inbox
  SET processing_attempts = processing_attempts + 1,
      status = 'received',
      last_error_code = NULL,
      processed_at = NULL
  WHERE account_id = target_account_id
    AND id = target_inbox_id
    AND status <> 'processed'
  RETURNING *;
$$;

ALTER TABLE public.partner_api_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_communication_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_api_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_communication_inbox FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.partner_api_credentials FROM anon, authenticated;
REVOKE ALL ON TABLE public.partner_communication_inbox FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.start_partner_communication_inbox_processing(UUID, UUID) FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.partner_api_credentials,
  public.partner_communication_inbox
TO service_role;
GRANT EXECUTE ON FUNCTION public.start_partner_communication_inbox_processing(UUID, UUID)
TO service_role;

COMMENT ON TABLE public.partner_api_credentials IS
  'Server-only partner credentials. token_hash contains SHA-256 only; plaintext tokens are never stored.';
COMMENT ON TABLE public.partner_communication_inbox IS
  'Normalized authenticated Partner Communication Contract events; no raw body, headers, or provider payload.';
