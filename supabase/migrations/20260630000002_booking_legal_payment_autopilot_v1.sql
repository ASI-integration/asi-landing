-- Guest Legal & Payment Autopilot v1.
-- Provider-ready operational placeholders only; no external contract, payment, or state submission calls.

CREATE TABLE IF NOT EXISTS public.booking_guest_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  guest_id TEXT,
  document_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  storage_ref TEXT,
  masked_document_number TEXT,
  issued_country TEXT,
  expires_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verified_by TEXT,
  rejection_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_guest_documents_status_check
    CHECK (status IN ('requested', 'received', 'verified', 'rejected', 'expired', 'missing')),
  CONSTRAINT booking_guest_documents_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_booking_guest_documents_booking
  ON public.booking_guest_documents (booking_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_ref TEXT,
  status TEXT NOT NULL DEFAULT 'not_started',
  template_key TEXT,
  document_ref TEXT,
  sent_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_contracts_provider_check
    CHECK (provider IN ('manual', 'okidoki', 'other')),
  CONSTRAINT booking_contracts_status_check
    CHECK (status IN ('not_started', 'prepared', 'sent', 'signed', 'rejected', 'expired', 'failed')),
  CONSTRAINT booking_contracts_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_contracts_booking_provider
  ON public.booking_contracts (booking_id, provider);

CREATE TABLE IF NOT EXISTS public.booking_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_ref TEXT,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'RUB',
  status TEXT NOT NULL DEFAULT 'not_requested',
  requested_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_deposits_provider_check
    CHECK (provider IN ('manual', 'payment_link', 'stripe', 'yoo_money', 'other')),
  CONSTRAINT booking_deposits_status_check
    CHECK (status IN (
      'not_requested',
      'requested',
      'received',
      'refunded',
      'partially_refunded',
      'failed',
      'waived'
    )),
  CONSTRAINT booking_deposits_currency_check
    CHECK (length(trim(currency)) BETWEEN 3 AND 12),
  CONSTRAINT booking_deposits_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_deposits_booking_provider
  ON public.booking_deposits (booking_id, provider);

CREATE TABLE IF NOT EXISTS public.booking_mvd_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_ref TEXT,
  status TEXT NOT NULL DEFAULT 'not_started',
  prepared_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  rejection_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_mvd_reports_provider_check
    CHECK (provider IN ('manual', 'integration', 'other')),
  CONSTRAINT booking_mvd_reports_status_check
    CHECK (status IN ('not_started', 'prepared', 'submitted', 'accepted', 'rejected', 'failed')),
  CONSTRAINT booking_mvd_reports_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_mvd_reports_booking_provider
  ON public.booking_mvd_reports (booking_id, provider);

ALTER TABLE public.booking_guest_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_mvd_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_guest_documents FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_contracts FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_deposits FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_mvd_reports FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_guest_documents TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_contracts TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_deposits TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_mvd_reports TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_guest_documents;
CREATE POLICY "service_role_full_access"
  ON public.booking_guest_documents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_contracts;
CREATE POLICY "service_role_full_access"
  ON public.booking_contracts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_deposits;
CREATE POLICY "service_role_full_access"
  ON public.booking_deposits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_mvd_reports;
CREATE POLICY "service_role_full_access"
  ON public.booking_mvd_reports
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
