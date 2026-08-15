-- Partner Review & Reputation Engine v1.
-- Additive, service-role-only review ingestion and intelligence. This migration
-- does not publish review replies, call a review provider, manipulate reviews,
-- send guest messages, create operational tasks, or apply compensation.

CREATE TABLE public.partner_guest_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  partner_account_binding_id UUID NOT NULL,
  partner_booking_binding_id UUID NOT NULL,
  property_id UUID NOT NULL,
  booking_ops_record_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  external_review_id TEXT NOT NULL CHECK (
    char_length(external_review_id) BETWEEN 1 AND 200
    AND external_review_id ~ '^[[:alnum:]][[:alnum:]._:$/+@-]*$'
  ),
  source TEXT NOT NULL CHECK (
    char_length(source) BETWEEN 1 AND 80
    AND source ~ '^[a-z0-9][a-z0-9._-]*$'
  ),
  public_review_ref TEXT NOT NULL DEFAULT ('prev_' || encode(gen_random_bytes(24), 'hex')),
  review_fingerprint TEXT NOT NULL CHECK (review_fingerprint ~ '^[a-f0-9]{64}$'),
  rating_value NUMERIC(8,3) NOT NULL CHECK (rating_value > 0),
  rating_scale_max NUMERIC(8,3) NOT NULL CHECK (rating_scale_max BETWEEN 1 AND 100),
  normalized_rating NUMERIC(9,6) NOT NULL CHECK (normalized_rating BETWEEN 0 AND 1),
  title TEXT CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 300),
  review_text TEXT NOT NULL CHECK (char_length(review_text) BETWEEN 1 AND 4096),
  language TEXT CHECK (
    language IS NULL OR (
      char_length(language) BETWEEN 2 AND 35
      AND language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
    )
  ),
  published_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('positive', 'mixed', 'negative')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  categories JSONB NOT NULL CHECK (
    jsonb_typeof(categories) = 'array'
    AND jsonb_array_length(categories) BETWEEN 0 AND 18
    AND categories <@ '["cleanliness","maintenance","heating","water","access","checkin","checkout","communication","noise","wifi","parking","amenities","accuracy","value","safety","payment","staff","other"]'::jsonb
  ),
  reputation_risk TEXT NOT NULL CHECK (reputation_risk IN ('low', 'medium', 'high', 'critical')),
  recovery_context TEXT NOT NULL CHECK (
    recovery_context IN (
      'no_recovery_case', 'recovered_before_review', 'unrecovered_before_review',
      'awaiting_guest_confirmation', 'multiple_recovery_cases'
    )
  ),
  recovery_facts JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(recovery_facts) = 'array'
    AND jsonb_array_length(recovery_facts) BETWEEN 0 AND 5
    AND octet_length(recovery_facts::text) <= 8192
  ),
  sensitive_allegations JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(sensitive_allegations) = 'array'
    AND jsonb_array_length(sensitive_allegations) BETWEEN 0 AND 8
    AND sensitive_allegations <@ '["legal","safety","discrimination","injury","theft","payment_dispute","refund_dispute","personal_data"]'::jsonb
  ),
  response_text TEXT NOT NULL CHECK (char_length(response_text) BETWEEN 1 AND 2000),
  response_policy TEXT NOT NULL CHECK (response_policy IN ('draft_safe', 'review_required', 'blocked')),
  response_reason_codes JSONB NOT NULL CHECK (
    jsonb_typeof(response_reason_codes) = 'array'
    AND jsonb_array_length(response_reason_codes) BETWEEN 1 AND 12
    AND octet_length(response_reason_codes::text) <= 2048
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_guest_reviews_account_id_id_key UNIQUE (account_id, id),
  CONSTRAINT partner_guest_reviews_signal_scope_key UNIQUE (
    account_id, id, property_id, booking_ops_record_id
  ),
  CONSTRAINT partner_guest_reviews_external_identity_key UNIQUE (
    partner_account_binding_id, source, external_review_id
  ),
  CONSTRAINT partner_guest_reviews_public_ref_key UNIQUE (public_review_ref),
  CONSTRAINT partner_guest_reviews_public_ref_format CHECK (
    public_review_ref ~ '^prev_[A-Za-z0-9_-]{32,96}$'
  ),
  CONSTRAINT partner_guest_reviews_rating_check CHECK (
    rating_value <= rating_scale_max
    AND abs(normalized_rating - (rating_value / rating_scale_max)) <= 0.000001
  ),
  CONSTRAINT partner_guest_reviews_account_binding_fk
    FOREIGN KEY (account_id, partner_account_binding_id)
    REFERENCES public.partner_account_bindings(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_guest_reviews_booking_binding_fk
    FOREIGN KEY (account_id, partner_booking_binding_id)
    REFERENCES public.partner_booking_bindings(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_guest_reviews_property_fk
    FOREIGN KEY (account_id, property_id)
    REFERENCES public.properties(account_id, id) ON DELETE CASCADE
);

CREATE FUNCTION public.enforce_partner_guest_review_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  booking_binding public.partner_booking_bindings%ROWTYPE;
  canonical_booking public.booking_ops_records%ROWTYPE;
BEGIN
  SELECT * INTO booking_binding
  FROM public.partner_booking_bindings
  WHERE id = NEW.partner_booking_binding_id;

  SELECT * INTO canonical_booking
  FROM public.booking_ops_records
  WHERE id = NEW.booking_ops_record_id;

  IF NOT FOUND
    OR booking_binding.account_id IS DISTINCT FROM NEW.account_id
    OR booking_binding.partner_account_binding_id IS DISTINCT FROM NEW.partner_account_binding_id
    OR booking_binding.property_id IS DISTINCT FROM NEW.property_id
    OR booking_binding.booking_ops_record_id IS DISTINCT FROM NEW.booking_ops_record_id
    OR booking_binding.status IS DISTINCT FROM 'active'
    OR canonical_booking.account_id IS DISTINCT FROM NEW.account_id::text
    OR canonical_booking.property_id IS DISTINCT FROM NEW.property_id::text
  THEN
    RAISE EXCEPTION 'partner_guest_review_scope_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER partner_guest_reviews_scope_guard
BEFORE INSERT OR UPDATE OF account_id, partner_account_binding_id, partner_booking_binding_id, property_id, booking_ops_record_id
ON public.partner_guest_reviews
FOR EACH ROW EXECUTE FUNCTION public.enforce_partner_guest_review_scope();

CREATE INDEX idx_partner_guest_reviews_property_received
  ON public.partner_guest_reviews (account_id, property_id, received_at DESC);
CREATE INDEX idx_partner_guest_reviews_booking
  ON public.partner_guest_reviews (account_id, booking_ops_record_id, received_at DESC);

CREATE TABLE public.partner_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  partner_account_binding_id UUID NOT NULL,
  external_event_id TEXT NOT NULL CHECK (
    char_length(external_event_id) BETWEEN 1 AND 200
    AND external_event_id ~ '^[[:alnum:]][[:alnum:]._:$/+@-]*$'
  ),
  event_fingerprint TEXT NOT NULL CHECK (event_fingerprint ~ '^[a-f0-9]{64}$'),
  review_id UUID,
  audit_ref TEXT NOT NULL UNIQUE CHECK (audit_ref ~ '^pra_[A-Za-z0-9_-]{32,96}$'),
  response JSONB CHECK (
    response IS NULL OR (jsonb_typeof(response) = 'object' AND octet_length(response::text) <= 16384)
  ),
  error_code TEXT CHECK (
    error_code IS NULL OR error_code IN ('partner_review_conflict', 'partner_review_processing_failed')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT partner_review_events_identity_key UNIQUE (
    account_id, partner_account_binding_id, external_event_id
  ),
  CONSTRAINT partner_review_events_account_binding_fk
    FOREIGN KEY (account_id, partner_account_binding_id)
    REFERENCES public.partner_account_bindings(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_review_events_review_fk
    FOREIGN KEY (account_id, review_id)
    REFERENCES public.partner_guest_reviews(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_review_events_completion_check CHECK (
    (processed_at IS NULL AND review_id IS NULL AND response IS NULL AND error_code IS NULL)
    OR (processed_at IS NOT NULL AND review_id IS NOT NULL AND response IS NOT NULL AND error_code IS NULL)
    OR (processed_at IS NOT NULL AND review_id IS NULL AND response IS NULL AND error_code IS NOT NULL)
  )
);

CREATE INDEX idx_partner_review_events_account_created
  ON public.partner_review_events (account_id, created_at DESC);

CREATE TABLE public.partner_reputation_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  review_id UUID NOT NULL,
  property_id UUID NOT NULL,
  booking_ops_record_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (
    category IN (
      'cleanliness','maintenance','heating','water','access','checkin','checkout',
      'communication','noise','wifi','parking','amenities','accuracy','value',
      'safety','payment','staff','other'
    )
  ),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  source TEXT NOT NULL CHECK (char_length(source) BETWEEN 1 AND 80),
  recovery_context TEXT NOT NULL CHECK (
    recovery_context IN (
      'no_recovery_case', 'recovered_before_review', 'unrecovered_before_review',
      'awaiting_guest_confirmation', 'multiple_recovery_cases'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_reputation_signals_review_category_key UNIQUE (account_id, review_id, category),
  CONSTRAINT partner_reputation_signals_review_scope_fk
    FOREIGN KEY (account_id, review_id, property_id, booking_ops_record_id)
    REFERENCES public.partner_guest_reviews(account_id, id, property_id, booking_ops_record_id)
    ON DELETE CASCADE,
  CONSTRAINT partner_reputation_signals_property_fk
    FOREIGN KEY (account_id, property_id)
    REFERENCES public.properties(account_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_partner_reputation_signals_property_category
  ON public.partner_reputation_signals (account_id, property_id, category, created_at DESC);

CREATE TRIGGER partner_guest_reviews_updated_at
BEFORE UPDATE ON public.partner_guest_reviews
FOR EACH ROW EXECUTE FUNCTION public.set_partner_communication_updated_at();

ALTER TABLE public.partner_guest_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_reputation_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_guest_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_review_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_reputation_signals FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.partner_guest_reviews FROM anon, authenticated;
REVOKE ALL ON TABLE public.partner_review_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.partner_reputation_signals FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_partner_guest_review_scope() FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.partner_guest_reviews,
  public.partner_review_events,
  public.partner_reputation_signals
TO service_role;

COMMENT ON TABLE public.partner_guest_reviews IS
  'Canonical tenant-scoped guest reputation reviews with deterministic immutable v1 analysis and unpublished response drafts.';
COMMENT ON TABLE public.partner_review_events IS
  'Authenticated idempotency ledger for review.received events; contains no raw request, credentials, or outbound action.';
COMMENT ON TABLE public.partner_reputation_signals IS
  'Idempotent operational root-cause intelligence derived from guest reviews; does not create or execute operational tasks.';
COMMENT ON COLUMN public.partner_guest_reviews.public_review_ref IS
  'Opaque high-entropy partner-facing review reference; never an internal UUID.';
COMMENT ON COLUMN public.partner_guest_reviews.response_text IS
  'Unpublished deterministic response draft. No provider publication exists in v1.';
