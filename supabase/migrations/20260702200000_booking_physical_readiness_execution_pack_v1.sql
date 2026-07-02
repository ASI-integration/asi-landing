-- Cleaning / Linen / Maintenance Execution Pack v1.
-- All coordination is draft-only; no external sends are performed by this schema.

CREATE TABLE IF NOT EXISTS public.booking_cleaning_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','assigned','in_progress','completed','verified','blocked','cancelled')),
  due_at TIMESTAMPTZ,
  assigned_to_name TEXT,
  assigned_to_phone TEXT,
  assigned_to_telegram TEXT,
  notes TEXT,
  report_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(report_payload) = 'object'),
  blocker_reason TEXT,
  completed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_linen_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','pickup_needed','picked_up','in_laundry','delivered','verified','shortage','blocked','cancelled')),
  due_at TIMESTAMPTZ,
  assigned_to_name TEXT,
  assigned_to_phone TEXT,
  assigned_to_telegram TEXT,
  notes TEXT,
  report_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(report_payload) = 'object'),
  blocker_reason TEXT,
  delivered_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_supplies_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','verified','missing','waived','blocked')),
  due_at TIMESTAMPTZ,
  critical_items JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(critical_items) = 'array'),
  notes TEXT,
  report_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(report_payload) = 'object'),
  blocker_reason TEXT,
  waiver_reason TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_maintenance_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  is_blocking BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','resolved','verified','deferred','cancelled')),
  assigned_to_name TEXT,
  assigned_to_phone TEXT,
  assigned_to_telegram TEXT,
  due_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  report_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(report_payload) = 'object'),
  blocker_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_maintenance_tickets_booking
  ON public.booking_maintenance_tickets (booking_id, is_blocking, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_physical_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'not_ready' CHECK (status IN ('not_ready','ready_for_review','approved','blocked')),
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blockers) = 'array'),
  final_ready BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_physical_coordination_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN ('cleaning','linen','maintenance','operator')),
  task_id UUID,
  telegram_target TEXT,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','cancelled')),
  created_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_physical_coordination_drafts_booking
  ON public.booking_physical_coordination_drafts (booking_id, created_at DESC);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'booking_cleaning_tasks', 'booking_linen_tasks', 'booking_supplies_tasks',
    'booking_maintenance_tickets', 'booking_physical_readiness',
    'booking_physical_coordination_drafts'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "service_role_full_access" ON public.%I', table_name);
    EXECUTE format('CREATE POLICY "service_role_full_access" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
