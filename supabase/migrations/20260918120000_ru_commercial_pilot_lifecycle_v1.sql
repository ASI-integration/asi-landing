-- RU commercial pilot lifecycle v1 (P0-01).
-- Canonical persisted commercial state for asi-global.ru pilot contract.
-- Does NOT touch Guest Autopilot billing lifecycle, CRM contact statuses,
-- or Ops v17 onboarding wizard. Additive only; no backfill of pilot_started_at.

CREATE TABLE IF NOT EXISTS public.ru_commercial_pilot_lifecycle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL
    CHECK (char_length(trim(property_id)) BETWEEN 1 AND 200),
  status TEXT NOT NULL
    CHECK (status IN (
      'application',
      'setup',
      'ready',
      'pilot_active',
      'pilot_completed',
      'report_ready',
      'continued',
      'stopped'
    )),
  setup_started_at TIMESTAMPTZ NULL,
  ready_at TIMESTAMPTZ NULL,
  pilot_started_at TIMESTAMPTZ NULL,
  pilot_ends_at TIMESTAMPTZ NULL,
  pilot_completed_at TIMESTAMPTZ NULL,
  report_ready_at TIMESTAMPTZ NULL,
  continuation_decided_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ru_commercial_pilot_lifecycle_account_property_key
    UNIQUE (account_id, property_id),
  -- Pilot window is all-or-nothing.
  CONSTRAINT ru_commercial_pilot_lifecycle_pilot_window_chk
    CHECK (
      (pilot_started_at IS NULL AND pilot_ends_at IS NULL)
      OR (pilot_started_at IS NOT NULL AND pilot_ends_at IS NOT NULL)
    ),
  -- Pilot start is impossible without ready_at, and must not precede it.
  CONSTRAINT ru_commercial_pilot_lifecycle_pilot_after_ready_chk
    CHECK (
      pilot_started_at IS NULL
      OR (ready_at IS NOT NULL AND pilot_started_at >= ready_at)
    ),
  -- Status → timestamp consistency (SSOT cannot hold impossible rows).
  CONSTRAINT ru_commercial_pilot_lifecycle_status_ready_at_chk
    CHECK (
      status IN ('application', 'setup')
      OR ready_at IS NOT NULL
    ),
  CONSTRAINT ru_commercial_pilot_lifecycle_status_pilot_window_chk
    CHECK (
      status IN ('application', 'setup', 'ready')
      OR (pilot_started_at IS NOT NULL AND pilot_ends_at IS NOT NULL)
    ),
  CONSTRAINT ru_commercial_pilot_lifecycle_status_completed_at_chk
    CHECK (
      status IN ('application', 'setup', 'ready', 'pilot_active')
      OR pilot_completed_at IS NOT NULL
    )
  -- report_ready_at / continuation_decided_at intentionally NOT required yet:
  -- report_ready / continued / stopped are reserved; wiring is a later P0.
);

CREATE INDEX IF NOT EXISTS idx_ru_commercial_pilot_lifecycle_account_status
  ON public.ru_commercial_pilot_lifecycle (account_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ru_commercial_pilot_lifecycle_property
  ON public.ru_commercial_pilot_lifecycle (property_id);

COMMENT ON TABLE public.ru_commercial_pilot_lifecycle IS
  'RU commercial pilot SSOT: application→setup→ready→pilot_active→pilot_completed (+ later report/continued/stopped). Separate from Guest Autopilot Stripe trial and CRM/ops-v17 states.';

ALTER TABLE public.ru_commercial_pilot_lifecycle ENABLE ROW LEVEL SECURITY;

-- Internal server-side table: Data API via service_role only (see docs/supabase-data-api-grants.md).
REVOKE ALL ON TABLE public.ru_commercial_pilot_lifecycle FROM PUBLIC;
REVOKE ALL ON TABLE public.ru_commercial_pilot_lifecycle FROM anon;
REVOKE ALL ON TABLE public.ru_commercial_pilot_lifecycle FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.ru_commercial_pilot_lifecycle
  TO service_role;

DROP POLICY IF EXISTS ru_commercial_pilot_lifecycle_service_role_all
  ON public.ru_commercial_pilot_lifecycle;
CREATE POLICY ru_commercial_pilot_lifecycle_service_role_all
  ON public.ru_commercial_pilot_lifecycle
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
