-- Candidate only. Acceptance applies solely inside a disposable PostgreSQL17 database.
BEGIN;
ALTER TABLE public.booking_ops_alerts ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE public.booking_ops_records ADD COLUMN automation_paused boolean NOT NULL DEFAULT false;
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
  SELECT * INTO a FROM public.booking_ops_alerts WHERE id=p_alert AND account_id=p_account FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'alert_not_found'; END IF;
  SELECT * INTO b FROM public.booking_ops_records WHERE id=a.booking_id AND account_id=p_account AND property_id=a.property_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_scope_mismatch'; END IF;
  PERFORM 1 FROM public.properties WHERE id=a.property_id AND account_id=p_account FOR SHARE;
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
