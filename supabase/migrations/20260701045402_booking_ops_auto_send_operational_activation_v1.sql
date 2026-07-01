-- Operational activation remains fail-closed globally. Only explicit narrow
-- scopes may permit actual delivery, and every execution still re-runs the
-- existing communication policy engine.

CREATE TABLE IF NOT EXISTS public.booking_ops_communication_auto_send_scopes (
  id UUID PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_ref TEXT,
  scope_ref_key TEXT GENERATED ALWAYS AS (COALESCE(scope_ref, '')) STORED,
  actual_send_enabled BOOLEAN NOT NULL DEFAULT false,
  enabled_by TEXT,
  enabled_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  reason TEXT,
  max_batch_size INTEGER NOT NULL DEFAULT 10,
  allowed_channels JSONB NOT NULL DEFAULT '["telegram","email"]'::jsonb,
  allowed_message_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  dry_run_only BOOLEAN NOT NULL DEFAULT true,
  emergency_stop BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_ops_auto_send_scope_type_check
    CHECK (scope_type IN ('global', 'owner', 'property', 'booking', 'pilot')),
  CONSTRAINT booking_ops_auto_send_scope_ref_check
    CHECK ((scope_type = 'global' AND scope_ref IS NULL) OR (scope_type <> 'global' AND length(trim(scope_ref)) > 0)),
  CONSTRAINT booking_ops_auto_send_global_off_check
    CHECK (scope_type <> 'global' OR actual_send_enabled = false),
  CONSTRAINT booking_ops_auto_send_batch_size_check
    CHECK (max_batch_size BETWEEN 1 AND 20),
  CONSTRAINT booking_ops_auto_send_channels_json_check
    CHECK (jsonb_typeof(allowed_channels) = 'array'),
  CONSTRAINT booking_ops_auto_send_types_json_check
    CHECK (jsonb_typeof(allowed_message_types) = 'array'),
  UNIQUE (scope_type, scope_ref_key)
);

CREATE INDEX IF NOT EXISTS idx_booking_ops_auto_send_scope_enabled
  ON public.booking_ops_communication_auto_send_scopes (scope_type, scope_ref)
  WHERE actual_send_enabled = true;

ALTER TABLE public.booking_ops_communication_auto_send_scopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_ops_communication_auto_send_scopes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_ops_communication_auto_send_scopes TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_ops_communication_auto_send_scopes;
CREATE POLICY "service_role_full_access"
  ON public.booking_ops_communication_auto_send_scopes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.booking_ops_communication_auto_send_runs (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL,
  dry_run BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'running',
  processed_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  safe_summary TEXT,
  CONSTRAINT booking_ops_auto_send_run_source_check CHECK (source IN ('scheduled', 'operator')),
  CONSTRAINT booking_ops_auto_send_run_status_check CHECK (status IN ('running', 'completed', 'failed')),
  CONSTRAINT booking_ops_auto_send_run_counts_check CHECK (
    processed_count >= 0 AND sent_count >= 0 AND failed_count >= 0 AND blocked_count >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_booking_ops_auto_send_runs_started
  ON public.booking_ops_communication_auto_send_runs (started_at DESC);

ALTER TABLE public.booking_ops_communication_auto_send_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_ops_communication_auto_send_runs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_ops_communication_auto_send_runs TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_ops_communication_auto_send_runs;
CREATE POLICY "service_role_full_access"
  ON public.booking_ops_communication_auto_send_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.booking_ops_communication_auto_send_scopes (
  id, scope_type, scope_ref, actual_send_enabled, disabled_at, reason,
  max_batch_size, allowed_channels, allowed_message_types, dry_run_only, emergency_stop
) VALUES (
  'f3000000-0000-4000-8000-000000000001',
  'global', NULL, false, now(), 'Глобальная фактическая автоотправка запрещена.',
  10, '["telegram","email"]'::jsonb,
  '["request_missing_guest_data","request_arrival_time","neutral_booking_acknowledgement","neutral_status_update","cleaner_task_assignment","cleaner_task_reminder","linen_task_assignment","inspection_task_assignment","master_task_assignment","master_task_reminder","internal_status_notice","fallback_created_notice","task_overdue_notice"]'::jsonb,
  true, false
)
ON CONFLICT (scope_type, scope_ref_key) DO UPDATE
SET actual_send_enabled = false,
    updated_at = now();

UPDATE public.booking_ops_communication_policies
SET actual_send_enabled = false,
    updated_at = now()
WHERE scope = 'global';

NOTIFY pgrst, 'reload schema';
