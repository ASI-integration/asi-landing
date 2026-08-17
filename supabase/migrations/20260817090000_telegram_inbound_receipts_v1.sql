-- Durable ownership and retry claims for authenticated Telegram inbound updates.
-- The stored payload is the narrow TelegramUpdate shape used by the application;
-- webhook headers, bot credentials, and unrelated provider data are never stored.

CREATE TABLE IF NOT EXISTS public.telegram_inbound_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_scope TEXT NOT NULL,
  update_id BIGINT NOT NULL,
  event_kind TEXT NOT NULL,
  chat_id BIGINT,
  message_id BIGINT,
  account_id TEXT,
  property_id TEXT,
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  process_outcome TEXT,
  failure_code TEXT,
  retryable BOOLEAN NOT NULL DEFAULT false,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  retry_count INTEGER NOT NULL DEFAULT 0,
  claim_token UUID NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 minutes'),
  operator_review_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_processed_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  failed_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT telegram_inbound_receipts_identity_unique UNIQUE (bot_scope, update_id),
  CONSTRAINT telegram_inbound_receipts_bot_scope_check CHECK (bot_scope = 'core'),
  CONSTRAINT telegram_inbound_receipts_event_kind_check
    CHECK (event_kind IN ('message', 'edited_message', 'callback_query', 'unknown')),
  CONSTRAINT telegram_inbound_receipts_status_check
    CHECK (status IN ('processing', 'processed', 'failed')),
  CONSTRAINT telegram_inbound_receipts_payload_object_check CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT telegram_inbound_receipts_attempt_count_check CHECK (attempt_count >= 1),
  CONSTRAINT telegram_inbound_receipts_retry_count_check CHECK (retry_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_telegram_inbound_receipts_failure_queue
  ON public.telegram_inbound_receipts (status, retryable, updated_at)
  WHERE status = 'failed';

CREATE INDEX IF NOT EXISTS idx_telegram_inbound_receipts_tenant_scope
  ON public.telegram_inbound_receipts (account_id, property_id, received_at DESC);

ALTER TABLE public.telegram_inbound_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_inbound_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_inbound_receipts FROM anon, authenticated, PUBLIC;

DROP POLICY IF EXISTS telegram_inbound_receipts_service_role_all
  ON public.telegram_inbound_receipts;
CREATE POLICY telegram_inbound_receipts_service_role_all
  ON public.telegram_inbound_receipts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.claim_telegram_inbound_receipt(
  p_bot_scope TEXT,
  p_update_id BIGINT,
  p_event_kind TEXT,
  p_chat_id BIGINT,
  p_message_id BIGINT,
  p_payload JSONB,
  p_payload_hash TEXT,
  p_account_id TEXT,
  p_property_id TEXT,
  p_claim_token UUID
)
RETURNS TABLE (
  action TEXT,
  receipt_id UUID,
  claim_token UUID,
  retry_count INTEGER,
  account_id TEXT,
  property_id TEXT,
  payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  receipt public.telegram_inbound_receipts%ROWTYPE;
BEGIN
  IF p_bot_scope <> 'core'
     OR p_update_id IS NULL
     OR p_event_kind IS NULL
     OR p_payload IS NULL
     OR jsonb_typeof(p_payload) <> 'object'
     OR NULLIF(btrim(p_payload_hash), '') IS NULL
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'telegram_inbound_receipt_invalid_claim' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_bot_scope || ':' || p_update_id::TEXT, 0));

  SELECT * INTO receipt
  FROM public.telegram_inbound_receipts
  WHERE bot_scope = p_bot_scope AND update_id = p_update_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.telegram_inbound_receipts (
      bot_scope, update_id, event_kind, chat_id, message_id, account_id, property_id,
      payload, payload_hash, claim_token
    ) VALUES (
      p_bot_scope, p_update_id, p_event_kind, p_chat_id, p_message_id, p_account_id, p_property_id,
      p_payload, p_payload_hash, p_claim_token
    )
    RETURNING * INTO receipt;
    RETURN QUERY SELECT 'process'::TEXT, receipt.id, receipt.claim_token, receipt.retry_count,
      receipt.account_id, receipt.property_id, receipt.payload;
    RETURN;
  END IF;

  IF receipt.payload_hash <> p_payload_hash
     OR receipt.event_kind <> p_event_kind
     OR receipt.chat_id IS DISTINCT FROM p_chat_id
     OR receipt.message_id IS DISTINCT FROM p_message_id THEN
    RAISE EXCEPTION 'telegram_inbound_receipt_identity_mismatch' USING ERRCODE = '23514';
  END IF;

  IF receipt.status = 'processed' THEN
    RETURN QUERY SELECT 'duplicate'::TEXT, receipt.id, NULL::UUID, receipt.retry_count,
      receipt.account_id, receipt.property_id, receipt.payload;
    RETURN;
  END IF;

  IF receipt.status = 'processing' AND receipt.lease_expires_at > now() THEN
    RETURN QUERY SELECT 'busy'::TEXT, receipt.id, NULL::UUID, receipt.retry_count,
      receipt.account_id, receipt.property_id, receipt.payload;
    RETURN;
  END IF;

  UPDATE public.telegram_inbound_receipts
  SET status = 'processing',
      retryable = false,
      attempt_count = attempt_count + 1,
      retry_count = retry_count + 1,
      claim_token = p_claim_token,
      lease_expires_at = now() + interval '2 minutes',
      last_attempt_at = now(),
      updated_at = now()
  WHERE id = receipt.id
  RETURNING * INTO receipt;

  RETURN QUERY SELECT 'process'::TEXT, receipt.id, receipt.claim_token, receipt.retry_count,
    receipt.account_id, receipt.property_id, receipt.payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_telegram_inbound_receipt_retry(
  p_receipt_id UUID,
  p_expected_account_id TEXT,
  p_expected_property_id TEXT,
  p_claim_token UUID
)
RETURNS TABLE (
  action TEXT,
  receipt_id UUID,
  claim_token UUID,
  retry_count INTEGER,
  account_id TEXT,
  property_id TEXT,
  payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  receipt public.telegram_inbound_receipts%ROWTYPE;
BEGIN
  IF p_receipt_id IS NULL OR NULLIF(btrim(p_expected_account_id), '') IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'telegram_inbound_receipt_retry_scope_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO receipt
  FROM public.telegram_inbound_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telegram_inbound_receipt_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF receipt.account_id IS NULL
     OR receipt.account_id <> p_expected_account_id
     OR (p_expected_property_id IS NOT NULL AND receipt.property_id IS DISTINCT FROM p_expected_property_id) THEN
    RAISE EXCEPTION 'telegram_inbound_receipt_scope_mismatch' USING ERRCODE = '42501';
  END IF;

  IF receipt.status = 'processed' THEN
    RETURN QUERY SELECT 'duplicate'::TEXT, receipt.id, NULL::UUID, receipt.retry_count,
      receipt.account_id, receipt.property_id, receipt.payload;
    RETURN;
  END IF;
  IF receipt.status = 'processing' AND receipt.lease_expires_at > now() THEN
    RETURN QUERY SELECT 'busy'::TEXT, receipt.id, NULL::UUID, receipt.retry_count,
      receipt.account_id, receipt.property_id, receipt.payload;
    RETURN;
  END IF;

  UPDATE public.telegram_inbound_receipts
  SET status = 'processing', retryable = false, attempt_count = attempt_count + 1,
      retry_count = retry_count + 1, claim_token = p_claim_token,
      lease_expires_at = now() + interval '2 minutes', last_attempt_at = now(), updated_at = now()
  WHERE id = receipt.id
  RETURNING * INTO receipt;

  RETURN QUERY SELECT 'process'::TEXT, receipt.id, receipt.claim_token, receipt.retry_count,
    receipt.account_id, receipt.property_id, receipt.payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_telegram_inbound_receipt(
  p_receipt_id UUID,
  p_claim_token UUID,
  p_status TEXT,
  p_process_outcome TEXT,
  p_failure_code TEXT,
  p_operator_review_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed INTEGER;
BEGIN
  IF p_status NOT IN ('processed', 'failed') THEN
    RAISE EXCEPTION 'telegram_inbound_receipt_invalid_transition' USING ERRCODE = '22023';
  END IF;

  UPDATE public.telegram_inbound_receipts
  SET status = p_status,
      process_outcome = p_process_outcome,
      failure_code = CASE WHEN p_status = 'failed' THEN p_failure_code ELSE NULL END,
      retryable = p_status = 'failed',
      operator_review_id = COALESCE(p_operator_review_id, operator_review_id),
      first_processed_at = COALESCE(first_processed_at, CASE WHEN p_status = 'processed' THEN now() END),
      failed_at = CASE WHEN p_status = 'failed' THEN now() ELSE failed_at END,
      processed_at = CASE WHEN p_status = 'processed' THEN now() ELSE processed_at END,
      lease_expires_at = now(),
      updated_at = now()
  WHERE id = p_receipt_id
    AND status = 'processing'
    AND claim_token = p_claim_token;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_telegram_inbound_receipt(TEXT, BIGINT, TEXT, BIGINT, BIGINT, JSONB, TEXT, TEXT, TEXT, UUID)
  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.claim_telegram_inbound_receipt_retry(UUID, TEXT, TEXT, UUID)
  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.complete_telegram_inbound_receipt(UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_telegram_inbound_receipt(TEXT, BIGINT, TEXT, BIGINT, BIGINT, JSONB, TEXT, TEXT, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_telegram_inbound_receipt_retry(UUID, TEXT, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_telegram_inbound_receipt(UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON TABLE public.telegram_inbound_receipts IS
  'Durable, idempotent receipt and retry queue for authenticated Telegram core-bot updates.';
COMMENT ON COLUMN public.telegram_inbound_receipts.payload IS
  'Narrow TelegramUpdate payload required for replay; excludes webhook headers, credentials, and unrelated raw provider data.';

NOTIFY pgrst, 'reload schema';
