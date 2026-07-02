-- Pilot Auto-Run End-to-End v1.
-- Internal orchestration audit only. No external calls, OTA publishing or message delivery.

CREATE TABLE IF NOT EXISTS public.booking_pilot_autorun_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL,
  scope_ref text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  steps_attempted jsonb NOT NULL DEFAULT '[]'::jsonb,
  steps_completed jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  safe_summary text,
  started_at timestamptz,
  finished_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_pilot_autorun_runs_scope_check CHECK (
    scope_type IN ('lead', 'property_setup', 'booking', 'batch')
  ),
  CONSTRAINT booking_pilot_autorun_runs_status_check CHECK (
    status IN ('queued', 'running', 'completed', 'completed_with_warnings', 'blocked', 'failed', 'dry_run')
  )
);

CREATE INDEX IF NOT EXISTS idx_booking_pilot_autorun_runs_scope
  ON public.booking_pilot_autorun_runs (scope_type, scope_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_pilot_autorun_runs_status
  ON public.booking_pilot_autorun_runs (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_pilot_autorun_step_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.booking_pilot_autorun_runs(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  status text NOT NULL,
  safe_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_pilot_autorun_step_events_status_check CHECK (
    status IN ('planned', 'completed', 'skipped', 'blocked', 'warning', 'failed')
  ),
  CONSTRAINT booking_pilot_autorun_step_events_run_step_unique UNIQUE (run_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_booking_pilot_autorun_step_events_run
  ON public.booking_pilot_autorun_step_events (run_id, created_at);

ALTER TABLE public.booking_pilot_autorun_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_pilot_autorun_step_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.booking_pilot_autorun_runs FROM anon, authenticated;
REVOKE ALL ON public.booking_pilot_autorun_step_events FROM anon, authenticated;
GRANT ALL ON public.booking_pilot_autorun_runs TO service_role;
GRANT ALL ON public.booking_pilot_autorun_step_events TO service_role;

COMMENT ON TABLE public.booking_pilot_autorun_runs IS
  'Safe internal audit for the pilot lead, property setup and booking orchestration pipeline.';
COMMENT ON TABLE public.booking_pilot_autorun_step_events IS
  'Step-level pilot autorun audit. Summaries must not contain secrets or raw provider credentials.';
