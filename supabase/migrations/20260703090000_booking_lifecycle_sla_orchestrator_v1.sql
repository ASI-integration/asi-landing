-- Booking Lifecycle Automation & SLA Orchestrator Pack v1.
-- Local database state and drafts only. No function or trigger performs an external send.

CREATE TABLE IF NOT EXISTS public.booking_ops_lifecycle_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL CHECK (run_type IN ('single_booking','batch_due','manual_dashboard','probe','test')),
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed','failed','noop')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_tasks_count INTEGER NOT NULL DEFAULT 0 CHECK (created_tasks_count >= 0),
  created_drafts_count INTEGER NOT NULL DEFAULT 0 CHECK (created_drafts_count >= 0),
  created_escalations_count INTEGER NOT NULL DEFAULT 0 CHECK (created_escalations_count >= 0),
  blocker_reasons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocker_reasons) = 'array'),
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result_summary) = 'object'),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_ops_lifecycle_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  current_stage TEXT NOT NULL DEFAULT 'booking_received',
  status TEXT NOT NULL DEFAULT 'not_started',
  blocker_reasons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocker_reasons) = 'array'),
  next_action TEXT,
  next_action_due_at TIMESTAMPTZ,
  sla_status TEXT NOT NULL DEFAULT 'on_track' CHECK (sla_status IN ('on_track','warning','overdue','satisfied','cancelled')),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','urgent','critical')),
  last_orchestrated_at TIMESTAMPTZ,
  final_checkin_draft_allowed BOOLEAN NOT NULL DEFAULT false,
  final_checkin_draft_id UUID REFERENCES public.booking_ops_checkin_release_drafts(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{"draftOnly":true,"noExternalSend":true}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_ops_lifecycle_states_stage_check CHECK (current_stage IN (
    'booking_received','guest_intake','legal_preparation','physical_preparation',
    'final_readiness_review','checkin_release_ready','checkin_release_draft_prepared',
    'in_stay','checkout_pending','completed','cancelled','blocked'
  )),
  CONSTRAINT booking_ops_lifecycle_states_status_check CHECK (status IN (
    'not_started','active','waiting_guest','waiting_operator','waiting_worker',
    'ready_for_review','blocked','overdue','completed','cancelled'
  ))
);

CREATE TABLE IF NOT EXISTS public.booking_ops_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(event_payload) = 'object'),
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('system','operator','test','scheduler')),
  actor_id TEXT,
  run_id UUID REFERENCES public.booking_ops_lifecycle_runs(id) ON DELETE SET NULL,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_ops_lifecycle_events_dedupe
  ON public.booking_ops_lifecycle_events(booking_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_ops_lifecycle_events_booking_created
  ON public.booking_ops_lifecycle_events(booking_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_ops_sla_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  stage TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('guest_intake','legal_readiness','cleaning','linen','maintenance','final_readiness')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','satisfied','overdue','escalated','cancelled','waived')),
  due_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  overdue_since TIMESTAMPTZ,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','urgent','critical')),
  blocker_reason TEXT,
  recommended_action TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, stage, item_type)
);
CREATE INDEX IF NOT EXISTS idx_booking_ops_sla_due
  ON public.booking_ops_sla_items(status, due_at) WHERE status IN ('pending','overdue','escalated');

CREATE TABLE IF NOT EXISTS public.booking_ops_lifecycle_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  draft_type TEXT NOT NULL,
  target_actor TEXT NOT NULL CHECK (target_actor IN ('guest','operator','cleaner','linen','master')),
  stage TEXT NOT NULL,
  due_window TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','cancelled')),
  metadata JSONB NOT NULL DEFAULT '{"draftOnly":true,"noExternalSend":true}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_booking_ops_lifecycle_runs_booking_created
  ON public.booking_ops_lifecycle_runs(booking_id, created_at DESC);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'booking_ops_lifecycle_runs','booking_ops_lifecycle_states','booking_ops_lifecycle_events',
    'booking_ops_sla_items','booking_ops_lifecycle_drafts'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated, PUBLIC', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "service_role_full_access" ON public.%I', table_name);
    EXECUTE format('CREATE POLICY "service_role_full_access" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
