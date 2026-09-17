-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Guest Autopilot (international) billing/onboarding lifecycle v1
--
-- Scope: guestautopilot.com account lifecycle only. Does not touch or rename
-- any RU/YooKassa table (operational_payments, ru compliance data, etc.) and
-- does not change the meaning of any existing RU-facing column.
--
-- Adds, on the existing multitenant `accounts` table (20260408000001):
--  - lifecycle_status: the SOLE authoritative onboarding/billing state for
--    accounts that opt into the new lifecycle. NULLABLE, no default — NULL
--    means "this account predates the new lifecycle; legacy
--    subscription_status/trial_started_at/trial_ends_at/subscriptions
--    remain authoritative for it, unchanged, forever." Existing rows are
--    left NULL by this migration (see migration mapping in the PR
--    description) — never defaulted to any lifecycle value, since a
--    non-null sentinel would misleadingly imply they occupy a real
--    position on the new state machine. Legacy subscription_status is
--    maintained only as a compatibility projection once an account does
--    join the new lifecycle — see src/lib/billing/account-lifecycle.ts.
--  - Stripe onboarding references (customer/payment-method/setup-intent) —
--    a dedicated card-on-file capture, no charge
--  - lifecycle timestamps; trial_started_at/trial_ends_at (existing columns)
--    are reused for their existing meaning, now derived from
--    integration_ready_at instead of account creation for accounts that opt
--    into the new lifecycle
--  - future-billing fields (accepted_plan_id, billing_consent_at,
--    stripe_subscription_id) left null until pricing/legal entity approved
--
-- New table `integration_requirements`: a generic, vertical-agnostic model
-- (hospitality channel manager, security/access systems, etc.) that gates
-- integration_ready — intentionally not the existing per-property
-- CHANNEL_MANAGER_ONBOARDING_STATUSES machinery, which is per-connection and
-- Russian-labeled; this is a new, separate, account-level aggregate.
--
-- Conventions match the existing chain: CREATE/ALTER ... IF NOT EXISTS for
-- safe re-runs; RLS service-role-only, mirroring 20260415000001.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) ACCOUNTS — additive lifecycle columns
DO $$
BEGIN
  IF to_regclass('public.accounts') IS NOT NULL THEN
    ALTER TABLE public.accounts
      ADD COLUMN IF NOT EXISTS lifecycle_status TEXT,
      ADD COLUMN IF NOT EXISTS card_verified_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS integration_started_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS integration_ready_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS billing_started_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
      ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT,
      ADD COLUMN IF NOT EXISTS stripe_setup_intent_id TEXT,
      ADD COLUMN IF NOT EXISTS accepted_plan_id TEXT,
      ADD COLUMN IF NOT EXISTS billing_consent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

    -- Existing rows are left NULL (untouched, no backfill) — never gated by
    -- the new signup/card_verified/integration_* states retroactively. Only
    -- accounts created through the new international signup path explicitly
    -- insert lifecycle_status = 'signup'. A CHECK constraint does not apply
    -- to NULL values in standard SQL, so NULL remains valid alongside the
    -- six real lifecycle states.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'accounts_lifecycle_status_check'
    ) THEN
      ALTER TABLE public.accounts
        ADD CONSTRAINT accounts_lifecycle_status_check
        CHECK (lifecycle_status IS NULL OR lifecycle_status IN (
          'signup', 'card_verified', 'integration_in_progress',
          'integration_ready', 'trial_active', 'paid_active'
        ));
    END IF;

    CREATE INDEX IF NOT EXISTS idx_accounts_lifecycle_status
      ON public.accounts(lifecycle_status);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_stripe_customer_id
      ON public.accounts(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
  END IF;
END $$;

-- 2) INTEGRATION REQUIREMENTS — generic, vertical-agnostic acceptance model
CREATE TABLE IF NOT EXISTS public.integration_requirements (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  type               TEXT        NOT NULL,
  label              TEXT        NOT NULL,
  required           BOOLEAN     NOT NULL DEFAULT true,
  status             TEXT        NOT NULL DEFAULT 'pending',
  connected_at       TIMESTAMPTZ,
  verified_at        TIMESTAMPTZ,
  failure_reason     TEXT,
  acceptance_evidence JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT integration_requirements_status_check
    CHECK (status IN ('pending', 'connecting', 'connected', 'verification_failed', 'accepted')),

  CONSTRAINT integration_requirements_account_type_unique
    UNIQUE (account_id, type)
);

CREATE INDEX IF NOT EXISTS idx_integration_requirements_account_id
  ON public.integration_requirements(account_id);

CREATE INDEX IF NOT EXISTS idx_integration_requirements_status
  ON public.integration_requirements(status);

ALTER TABLE public.integration_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_requirements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integration_requirements FROM anon, authenticated;

DROP POLICY IF EXISTS "service_role_full_access" ON public.integration_requirements;
CREATE POLICY "service_role_full_access"
  ON public.integration_requirements
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
