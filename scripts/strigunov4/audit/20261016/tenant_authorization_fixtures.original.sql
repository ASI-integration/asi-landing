-- Include ONLY inside the reviewed six-migration transaction before unconditional ROLLBACK.
-- Authorization checks via SET LOCAL ROLE, not new LOGIN or HTTP authentication proof.
-- All IDs explicit; no fixture uses nextval or changes restored grants/RLS.
CREATE FUNCTION pg_temp.asi_expect_denial(q text, expected_state text, expected_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE state text; msg text;
BEGIN
  BEGIN
    EXECUTE q;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
    IF state = expected_state AND (expected_message IS NULL OR msg = expected_message) THEN RETURN; END IF;
    RAISE EXCEPTION 'fixture unexpected error class %, expected %', state, expected_state;
  END;
  RAISE EXCEPTION 'fixture expected denial but operation succeeded';
END $$;
INSERT INTO public.users(id,email,password_hash) VALUES
('2a7f58e4-0000-4000-8000-000000000001','restore-fixture-a@example.invalid','!disabled-synthetic-fixture'),
('2a7f58e4-0000-4000-8000-000000000002','restore-fixture-b@example.invalid','!disabled-synthetic-fixture');
INSERT INTO public.accounts(id,name) VALUES
('2a7f58e4-0000-4000-8000-000000000011','Restore fixture A'),
('2a7f58e4-0000-4000-8000-000000000012','Restore fixture B');
INSERT INTO public.account_members(id,account_id,user_id,role) VALUES
('2a7f58e4-0000-4000-8000-000000000021','2a7f58e4-0000-4000-8000-000000000011','2a7f58e4-0000-4000-8000-000000000001','owner'),
('2a7f58e4-0000-4000-8000-000000000022','2a7f58e4-0000-4000-8000-000000000012','2a7f58e4-0000-4000-8000-000000000002','owner');
INSERT INTO public.properties(id,account_id,name) VALUES
('2a7f58e4-0000-4000-8000-000000000031','2a7f58e4-0000-4000-8000-000000000011','Restore property A'),
('2a7f58e4-0000-4000-8000-000000000032','2a7f58e4-0000-4000-8000-000000000012','Restore property B');
INSERT INTO public.booking_ops_records(id,account_id,property_id) VALUES
('2a7f58e4-0000-4000-8000-000000000041','2a7f58e4-0000-4000-8000-000000000011','2a7f58e4-0000-4000-8000-000000000031'),
('2a7f58e4-0000-4000-8000-000000000042','2a7f58e4-0000-4000-8000-000000000012','2a7f58e4-0000-4000-8000-000000000032');
INSERT INTO public.booking_ops_alerts(id,account_id,booking_id,property_id,alert_code,source_gate,severity,status,title,description,dedupe_key,incident_family,source_domain,recommended_action) VALUES
('2a7f58e4-0000-4000-8000-000000000051','2a7f58e4-0000-4000-8000-000000000011','2a7f58e4-0000-4000-8000-000000000041','2a7f58e4-0000-4000-8000-000000000031','g0_uncertain','provider_uncertain','critical','open','Synthetic fixture','Synthetic fixture','restore-fixture-a','g0_uncertain','g0','Manual reconciliation'),
('2a7f58e4-0000-4000-8000-000000000052','2a7f58e4-0000-4000-8000-000000000012','2a7f58e4-0000-4000-8000-000000000042','2a7f58e4-0000-4000-8000-000000000032','g0_uncertain','provider_uncertain','critical','open','Synthetic fixture','Synthetic fixture','restore-fixture-b','g0_uncertain','g0','Manual reconciliation');
SET LOCAL ROLE anon;
SELECT pg_temp.asi_expect_denial($q$SELECT 1 FROM public.account_members LIMIT 1$q$,'42501');
SELECT pg_temp.asi_expect_denial($q$SELECT 1 FROM public.properties LIMIT 1$q$,'42501');
SELECT pg_temp.asi_expect_denial($q$SELECT 1 FROM public.booking_ops_records LIMIT 1$q$,'42501');
SELECT pg_temp.asi_expect_denial($q$SELECT 1 FROM public.booking_ops_alerts LIMIT 1$q$,'42501');
SELECT pg_temp.asi_expect_denial($q$SELECT public.g0_acknowledge_operator_alert('2a7f58e4-0000-4000-8000-000000000011','2a7f58e4-0000-4000-8000-000000000051','2a7f58e4-0000-4000-8000-000000000001',1)$q$,'42501');
SELECT pg_temp.asi_expect_denial($q$SELECT public.g0_begin_automation('2a7f58e4-0000-4000-8000-000000000041','2a7f58e4-0000-4000-8000-000000000061')$q$,'42501');
SELECT pg_temp.asi_expect_denial($q$SELECT public.g0_end_automation('2a7f58e4-0000-4000-8000-000000000041','2a7f58e4-0000-4000-8000-000000000061')$q$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.asi_expect_denial($q$SELECT 1 FROM public.account_members LIMIT 1$q$,'42501');
SELECT pg_temp.asi_expect_denial($q$SELECT 1 FROM public.properties LIMIT 1$q$,'42501');
SELECT pg_temp.asi_expect_denial($q$SELECT 1 FROM public.booking_ops_records LIMIT 1$q$,'42501');
SELECT pg_temp.asi_expect_denial($q$SELECT 1 FROM public.booking_ops_alerts LIMIT 1$q$,'42501');
SELECT pg_temp.asi_expect_denial($q$SELECT public.g0_acknowledge_operator_alert('2a7f58e4-0000-4000-8000-000000000011','2a7f58e4-0000-4000-8000-000000000051','2a7f58e4-0000-4000-8000-000000000001',1)$q$,'42501');
SELECT pg_temp.asi_expect_denial($q$SELECT public.g0_begin_automation('2a7f58e4-0000-4000-8000-000000000041','2a7f58e4-0000-4000-8000-000000000061')$q$,'42501');
SELECT pg_temp.asi_expect_denial($q$SELECT public.g0_end_automation('2a7f58e4-0000-4000-8000-000000000041','2a7f58e4-0000-4000-8000-000000000061')$q$,'42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.asi_expect_denial($q$SELECT public.g0_acknowledge_operator_alert('2a7f58e4-0000-4000-8000-000000000011','2a7f58e4-0000-4000-8000-000000000052','2a7f58e4-0000-4000-8000-000000000001',1)$q$,'P0001', 'alert_not_found');
SELECT pg_temp.asi_expect_denial($q$SELECT public.g0_acknowledge_operator_alert('2a7f58e4-0000-4000-8000-000000000012','2a7f58e4-0000-4000-8000-000000000052','2a7f58e4-0000-4000-8000-000000000001',1)$q$,'P0001', 'operator_membership_revoked');
SELECT pg_temp.asi_expect_denial($q$SELECT public.g0_acknowledge_operator_alert('2a7f58e4-0000-4000-8000-000000000011','2a7f58e4-0000-4000-8000-000000000051','2a7f58e4-0000-4000-8000-000000000001',0)$q$,'P0001', 'alert_revision_conflict');
SELECT pg_temp.asi_expect_denial($q$INSERT INTO public.booking_ops_records(id,account_id,property_id) VALUES('2a7f58e4-0000-4000-8000-000000000043','2a7f58e4-0000-4000-8000-000000000011','2a7f58e4-0000-4000-8000-000000000032')$q$,'23514', 'booking_ops_record_scope_mismatch');
RESET ROLE;
DELETE FROM public.account_members WHERE id='2a7f58e4-0000-4000-8000-000000000021';
SET LOCAL ROLE service_role;
SELECT pg_temp.asi_expect_denial($q$SELECT public.g0_acknowledge_operator_alert('2a7f58e4-0000-4000-8000-000000000011','2a7f58e4-0000-4000-8000-000000000051','2a7f58e4-0000-4000-8000-000000000001',1)$q$,'P0001', 'operator_membership_revoked');
RESET ROLE;
INSERT INTO public.account_members(id,account_id,user_id,role) VALUES('2a7f58e4-0000-4000-8000-000000000021','2a7f58e4-0000-4000-8000-000000000011','2a7f58e4-0000-4000-8000-000000000001','owner');
UPDATE public.properties SET account_id='2a7f58e4-0000-4000-8000-000000000012' WHERE id='2a7f58e4-0000-4000-8000-000000000031';
SET LOCAL ROLE service_role;
SELECT pg_temp.asi_expect_denial($q$SELECT public.g0_acknowledge_operator_alert('2a7f58e4-0000-4000-8000-000000000011','2a7f58e4-0000-4000-8000-000000000051','2a7f58e4-0000-4000-8000-000000000001',1)$q$,'P0001', 'booking_scope_mismatch');
RESET ROLE;
UPDATE public.properties SET account_id='2a7f58e4-0000-4000-8000-000000000011' WHERE id='2a7f58e4-0000-4000-8000-000000000031';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.booking_ops_alerts WHERE id IN ('2a7f58e4-0000-4000-8000-000000000051','2a7f58e4-0000-4000-8000-000000000052') AND (revision<>1 OR status<>'open')) OR EXISTS(SELECT 1 FROM public.booking_ops_records WHERE id IN ('2a7f58e4-0000-4000-8000-000000000041','2a7f58e4-0000-4000-8000-000000000042') AND automation_paused) THEN RAISE EXCEPTION 'negative fixture mutated state'; END IF; END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN PERFORM public.g0_acknowledge_operator_alert('2a7f58e4-0000-4000-8000-000000000011','2a7f58e4-0000-4000-8000-000000000051','2a7f58e4-0000-4000-8000-000000000001',1); END $$;
RESET ROLE;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.booking_ops_alerts WHERE id='2a7f58e4-0000-4000-8000-000000000051' AND status='acknowledged' AND revision=2 AND acknowledged_by='2a7f58e4-0000-4000-8000-000000000001'::text) OR NOT EXISTS(SELECT 1 FROM public.booking_ops_records WHERE id='2a7f58e4-0000-4000-8000-000000000041' AND automation_paused) OR NOT EXISTS(SELECT 1 FROM public.booking_ops_alerts WHERE id='2a7f58e4-0000-4000-8000-000000000052' AND status='open' AND revision=1) OR EXISTS(SELECT 1 FROM public.booking_ops_records WHERE id='2a7f58e4-0000-4000-8000-000000000042' AND automation_paused) THEN RAISE EXCEPTION 'positive fixture or tenant isolation failed'; END IF; END $$;
SELECT 'TENANT_AUTHORIZATION_FIXTURES_PASS' AS sanitized_status;
