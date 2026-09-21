-- RU legal onboarding and account-scoped special offers v1.
-- Additive only. This migration is intentionally NOT applied by the feature PR.
-- Production persistence remains gated pending Russian personal-data localization review.

CREATE TABLE IF NOT EXISTS public.ru_legal_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  accepted_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL
    CHECK (document_type IN ('offer', 'personal_data_consent')),
  document_version TEXT NOT NULL
    CHECK (char_length(trim(document_version)) BETWEEN 1 AND 32),
  document_sha256 TEXT NOT NULL
    CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_snapshot TEXT NULL,
  ip_address TEXT NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ru_legal_acceptances_account_document_version_key
    UNIQUE (account_id, document_type, document_version)
);

CREATE INDEX IF NOT EXISTS idx_ru_legal_acceptances_account_current
  ON public.ru_legal_acceptances (account_id, document_type, document_version);

COMMENT ON TABLE public.ru_legal_acceptances IS
  'Server-owned RU legal evidence. Production writes require the application localization gate and legal review.';

ALTER TABLE public.ru_legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ru_legal_acceptances FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ru_legal_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.ru_legal_acceptances TO service_role;

DROP POLICY IF EXISTS ru_legal_acceptances_service_role_all ON public.ru_legal_acceptances;
CREATE POLICY ru_legal_acceptances_service_role_all
  ON public.ru_legal_acceptances
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- A special price is account-scoped and inert until explicitly enabled.
-- No provisional community offer is seeded or granted automatically.
CREATE TABLE IF NOT EXISTS public.ru_account_special_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  offer_code TEXT NOT NULL CHECK (offer_code ~ '^[a-z0-9_:-]{1,80}$'),
  monthly_price_rub INTEGER NOT NULL CHECK (monthly_price_rub > 0),
  enabled BOOLEAN NOT NULL DEFAULT false,
  starts_at TIMESTAMPTZ NULL,
  ends_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ru_account_special_offers_account_code_key UNIQUE (account_id, offer_code),
  CONSTRAINT ru_account_special_offers_window_chk
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

COMMENT ON TABLE public.ru_account_special_offers IS
  'Explicit account-level RU commercial offer assignment. Never infer eligibility from signup or self-reported community membership.';

ALTER TABLE public.ru_account_special_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ru_account_special_offers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ru_account_special_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ru_account_special_offers TO service_role;

DROP POLICY IF EXISTS ru_account_special_offers_service_role_all ON public.ru_account_special_offers;
CREATE POLICY ru_account_special_offers_service_role_all
  ON public.ru_account_special_offers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
