-- OPS v16: durable booking lifecycle events, state decisions, worker tasks and secure links.
-- Additive only. Apply separately after review; this migration is not executed by Codex.
CREATE TABLE IF NOT EXISTS public.booking_ops_domain_events (
  id UUID PRIMARY KEY, booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  object_id TEXT, event_type TEXT NOT NULL, actor_type TEXT NOT NULL CHECK (actor_type IN ('guest','operator','cleaner','linen_worker','consumables','inspector','maintenance_technician','system')),
  actor_id TEXT, payload JSONB NOT NULL DEFAULT '{}'::jsonb, source TEXT NOT NULL,
  correlation_id UUID NOT NULL, causation_id UUID REFERENCES public.booking_ops_domain_events(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ, processing_error TEXT
);
CREATE INDEX IF NOT EXISTS booking_ops_domain_events_booking_created_idx ON public.booking_ops_domain_events(booking_id, created_at);

CREATE TABLE IF NOT EXISTS public.booking_ops_lifecycle_decisions (
  id UUID PRIMARY KEY, booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  event_id UUID NOT NULL UNIQUE REFERENCES public.booking_ops_domain_events(id) ON DELETE CASCADE,
  previous_stage TEXT NOT NULL, next_stage TEXT NOT NULL, decision TEXT NOT NULL, blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_ops_autopilot_states (
  booking_id UUID PRIMARY KEY REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'booking_received', state JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_event_id UUID REFERENCES public.booking_ops_domain_events(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_ops_worker_tasks (
  id UUID PRIMARY KEY, booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  object_id TEXT, task_key TEXT NOT NULL, assigned_role TEXT NOT NULL CHECK (assigned_role IN ('cleaner','linen_worker','consumables','inspector','maintenance_technician')),
  assigned_person_id TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','assigned','in_progress','blocked','completed','cancelled')),
  deadline TIMESTAMPTZ, checklist JSONB NOT NULL DEFAULT '[]'::jsonb, notes TEXT, photo_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  issue_report JSONB, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, completion_event_id UUID REFERENCES public.booking_ops_domain_events(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(booking_id, task_key)
);
CREATE INDEX IF NOT EXISTS booking_ops_worker_tasks_assignee_idx ON public.booking_ops_worker_tasks(assigned_person_id, status, deadline);

CREATE TABLE IF NOT EXISTS public.booking_ops_secure_task_links (
  id UUID PRIMARY KEY, task_id UUID NOT NULL REFERENCES public.booking_ops_worker_tasks(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, actor_type TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.booking_ops_worker_link_audit (
  id UUID PRIMARY KEY, link_id UUID REFERENCES public.booking_ops_secure_task_links(id) ON DELETE SET NULL,
  task_id UUID NOT NULL REFERENCES public.booking_ops_worker_tasks(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('issued','revoked','opened','started','updated','issue_reported','completed')),
  actor_type TEXT NOT NULL, actor_id TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.booking_ops_domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_ops_lifecycle_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_ops_autopilot_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_ops_worker_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_ops_secure_task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_ops_worker_link_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_ops_domain_events, public.booking_ops_lifecycle_decisions, public.booking_ops_autopilot_states, public.booking_ops_worker_tasks, public.booking_ops_secure_task_links FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_ops_domain_events, public.booking_ops_lifecycle_decisions, public.booking_ops_autopilot_states, public.booking_ops_worker_tasks, public.booking_ops_secure_task_links TO service_role;
REVOKE ALL ON public.booking_ops_worker_link_audit FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_ops_worker_link_audit TO service_role;
NOTIFY pgrst, 'reload schema';
