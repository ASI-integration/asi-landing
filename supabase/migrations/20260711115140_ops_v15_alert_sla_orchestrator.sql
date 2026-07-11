-- OPS v15: persistent, idempotent turnover alerts. Internal state only; no delivery.
CREATE TABLE IF NOT EXISTS public.booking_ops_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  previous_booking_id UUID REFERENCES public.booking_ops_records(id) ON DELETE SET NULL,
  property_id TEXT NOT NULL,
  alert_code TEXT NOT NULL,
  source_gate TEXT NOT NULL CHECK (source_gate IN ('cleaning','linen','inspection','maintenance','readiness')),
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at TIMESTAMPTZ,
  next_check_in_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_ops_alerts_active_dedupe
  ON public.booking_ops_alerts(dedupe_key) WHERE status IN ('open','acknowledged');
CREATE INDEX IF NOT EXISTS idx_booking_ops_alerts_queue
  ON public.booking_ops_alerts(status, severity, next_check_in_at, deadline_at);
CREATE INDEX IF NOT EXISTS idx_booking_ops_alerts_booking
  ON public.booking_ops_alerts(booking_id, updated_at DESC);

-- A renewable lease protects full scheduled/manual sweeps from overlapping.
-- Targeted booking/property runs intentionally do not take this global lease.
CREATE TABLE IF NOT EXISTS public.booking_ops_alert_run_locks (
  lock_scope TEXT PRIMARY KEY,
  owner_id UUID NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (length(lock_scope) BETWEEN 1 AND 120),
  CHECK (expires_at > acquired_at)
);

CREATE OR REPLACE FUNCTION public.acquire_booking_ops_alert_run_lock(
  p_lock_scope TEXT,
  p_owner_id UUID,
  p_ttl_seconds INTEGER DEFAULT 240
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_lock_scope IS NULL OR length(p_lock_scope) NOT BETWEEN 1 AND 120
     OR p_owner_id IS NULL OR p_ttl_seconds NOT BETWEEN 30 AND 900 THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.booking_ops_alert_run_locks(lock_scope, owner_id, acquired_at, expires_at)
  VALUES (p_lock_scope, p_owner_id, now(), now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (lock_scope) DO UPDATE
    SET owner_id = EXCLUDED.owner_id,
        acquired_at = EXCLUDED.acquired_at,
        expires_at = EXCLUDED.expires_at
    WHERE booking_ops_alert_run_locks.expires_at <= now()
       OR booking_ops_alert_run_locks.owner_id = EXCLUDED.owner_id;
  RETURN EXISTS (
    SELECT 1 FROM public.booking_ops_alert_run_locks
    WHERE lock_scope = p_lock_scope AND owner_id = p_owner_id AND expires_at > now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_booking_ops_alert_run_lock(p_lock_scope TEXT, p_owner_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.booking_ops_alert_run_locks
  WHERE lock_scope = p_lock_scope AND owner_id = p_owner_id
  RETURNING TRUE;
$$;

ALTER TABLE public.booking_ops_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_ops_alert_run_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_ops_alerts FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.booking_ops_alert_run_locks FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_booking_ops_alert_run_lock(TEXT, UUID, INTEGER) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.release_booking_ops_alert_run_lock(TEXT, UUID) FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_ops_alerts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_ops_alert_run_locks TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_booking_ops_alert_run_lock(TEXT, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_booking_ops_alert_run_lock(TEXT, UUID) TO service_role;
DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_ops_alerts;
CREATE POLICY "service_role_full_access" ON public.booking_ops_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role_alert_lock_access" ON public.booking_ops_alert_run_locks;
CREATE POLICY "service_role_alert_lock_access" ON public.booking_ops_alert_run_locks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
