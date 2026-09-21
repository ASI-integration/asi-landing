-- RU commercial pilot entitlement guard v1.
-- Prevents a new registration/email from silently granting another standard pilot
-- for the same physical property. Additive only; no production apply in this change.

CREATE TABLE IF NOT EXISTS public.ru_commercial_pilot_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_key TEXT NOT NULL UNIQUE CHECK (char_length(property_key) BETWEEN 1 AND 500),
  first_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  first_property_id TEXT NOT NULL CHECK (char_length(trim(first_property_id)) BETWEEN 1 AND 200),
  first_pilot_started_at TIMESTAMPTZ NOT NULL,
  last_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  last_property_id TEXT NOT NULL CHECK (char_length(trim(last_property_id)) BETWEEN 1 AND 200),
  last_pilot_started_at TIMESTAMPTZ NOT NULL,
  grant_count INTEGER NOT NULL DEFAULT 1 CHECK (grant_count >= 1),
  operator_override_count INTEGER NOT NULL DEFAULT 0 CHECK (operator_override_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ru_commercial_pilot_entitlements_last_account
  ON public.ru_commercial_pilot_entitlements (last_account_id, updated_at DESC);

COMMENT ON TABLE public.ru_commercial_pilot_entitlements IS
  'RU standard-pilot anti-abuse ledger. property_key is a server-side normalized property identity; email/phone changes do not reset entitlement. Re-grants require explicit operator override.';

ALTER TABLE public.ru_commercial_pilot_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ru_commercial_pilot_entitlements FROM PUBLIC;
REVOKE ALL ON TABLE public.ru_commercial_pilot_entitlements FROM anon;
REVOKE ALL ON TABLE public.ru_commercial_pilot_entitlements FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ru_commercial_pilot_entitlements TO service_role;

DROP POLICY IF EXISTS ru_commercial_pilot_entitlements_service_role_all
  ON public.ru_commercial_pilot_entitlements;
CREATE POLICY ru_commercial_pilot_entitlements_service_role_all
  ON public.ru_commercial_pilot_entitlements FOR ALL TO service_role
  USING (true) WITH CHECK (true);
