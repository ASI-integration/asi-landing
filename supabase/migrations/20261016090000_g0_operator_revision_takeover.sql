-- Candidate only. Acceptance applies solely inside a disposable PostgreSQL17 database.
BEGIN;
-- PostgreSQL row locks require UPDATE privilege on at least one column.
-- Trusted server role only; no owner/authenticated role gains mutation rights.
GRANT UPDATE (user_id) ON public.account_members TO service_role;
GRANT UPDATE (id) ON public.properties TO service_role;
ALTER TABLE public.booking_ops_alerts ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE public.booking_ops_records ADD COLUMN automation_paused boolean NOT NULL DEFAULT false;
CREATE TABLE public.booking_ops_automation_executions (
  token uuid PRIMARY KEY, booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON public.booking_ops_automation_executions(booking_id);
ALTER TABLE public.booking_ops_automation_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_ops_automation_executions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.booking_ops_automation_executions TO service_role;
CREATE FUNCTION public.g0_begin_automation(p_booking uuid, p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE paused boolean;
BEGIN
  SELECT automation_paused INTO paused FROM public.booking_ops_records WHERE id=p_booking FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF paused THEN RAISE EXCEPTION 'booking_automation_manually_paused'; END IF;
  INSERT INTO public.booking_ops_automation_executions(token,booking_id) VALUES(p_token,p_booking);
  RETURN true;
END $$;
CREATE FUNCTION public.g0_end_automation(p_booking uuid, p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  DELETE FROM public.booking_ops_automation_executions WHERE booking_id=p_booking AND token=p_token;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.g0_begin_automation(uuid,uuid), public.g0_end_automation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.g0_begin_automation(uuid,uuid), public.g0_end_automation(uuid,uuid) TO service_role;
CREATE FUNCTION public.g0_alert_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  -- A changed incident requires a fresh operator acknowledgement.
  IF OLD.status = 'acknowledged' AND NEW.status = 'acknowledged' AND
    (to_jsonb(NEW) - ARRAY['revision','updated_at','acknowledged_at','acknowledged_by']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['revision','updated_at','acknowledged_at','acknowledged_by']) THEN
    NEW.status := 'open'; NEW.acknowledged_at := NULL; NEW.acknowledged_by := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER g0_alert_revision BEFORE UPDATE ON public.booking_ops_alerts
FOR EACH ROW EXECUTE FUNCTION public.g0_alert_revision();
CREATE FUNCTION public.g0_acknowledge_operator_alert(p_account uuid, p_alert uuid, p_actor uuid, p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE a public.booking_ops_alerts; b public.booking_ops_records;
BEGIN
  -- Serialize membership deletion against the actual acknowledgement transaction.
  PERFORM 1 FROM public.account_members WHERE account_id=p_account AND user_id=p_actor FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'operator_membership_revoked'; END IF;
  SELECT * INTO a FROM public.booking_ops_alerts WHERE id=p_alert AND account_id::text=p_account::text FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'alert_not_found'; END IF;
  SELECT * INTO b FROM public.booking_ops_records WHERE id=a.booking_id AND account_id::text=p_account::text AND property_id=a.property_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_scope_mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM public.booking_ops_automation_executions WHERE booking_id=b.id) THEN RAISE EXCEPTION 'booking_automation_inflight_hold'; END IF;
  PERFORM 1 FROM public.properties WHERE id::text=a.property_id AND account_id=p_account FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_scope_mismatch'; END IF;
  IF p_revision IS NULL OR p_revision <> a.revision OR a.status <> 'open' THEN RAISE EXCEPTION 'alert_revision_conflict'; END IF;
  UPDATE public.booking_ops_records SET automation_paused=true WHERE id=b.id;
  UPDATE public.booking_ops_alerts SET status='acknowledged', acknowledged_at=clock_timestamp(),
    acknowledged_by=p_actor::text, updated_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
  RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.g0_alert_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.g0_acknowledge_operator_alert(uuid,uuid,uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.g0_acknowledge_operator_alert(uuid,uuid,uuid,bigint) TO service_role;
COMMIT;
