-- Task13 SOURCE ONLY. Never applied. Install after Task12 fixture + original Task08 + original Task11.
-- DO NOT install Task12 overlay during phase1: it issues sessions.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $guard$ BEGIN
 IF current_database()<>'strigunov_task11_isolated_lab' OR current_user<>'strigunov_task11_owner'
 OR session_user<>'task12_provisioner' OR inet_server_port()<>55442 THEN RAISE EXCEPTION 'task13_target'; END IF;
 IF EXISTS(SELECT 1 FROM asi_task11_private.installation WHERE native_acceptance_sha256 IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.sessions) OR EXISTS(SELECT 1 FROM asi_task08_private.requests)
 OR EXISTS(SELECT 1 FROM asi_task11_private.principals) THEN RAISE EXCEPTION 'task13_not_fresh_bootstrap'; END IF;
 IF (SELECT count(*) FROM task12_fixture.slots)<>64 THEN RAISE EXCEPTION 'task13_fixture_slots'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('task12_login_a','task12_login_b','task12_denied','task12_provisioner')
 AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR NOT rolcanlogin))
 OR (SELECT count(*) FROM pg_roles WHERE rolname IN ('task12_login_a','task12_login_b','task12_denied','task12_provisioner'))<>4
 THEN RAISE EXCEPTION 'task13_roles'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
 WHERE r.rolname IN ('task12_login_a','task12_login_b','task12_denied')) THEN RAISE EXCEPTION 'task13_memberships'; END IF;
END $guard$;
CREATE SCHEMA task13_fixture;
REVOKE ALL ON SCHEMA task13_fixture FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA task13_fixture REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
INSERT INTO asi_task11_private.principals(login_role,account_id,actor_id,purpose)
 SELECT n::name,s.account_id,s.actor_id,'writer' FROM task12_fixture.slots s
 CROSS JOIN (VALUES('task12_provisioner'),('task12_login_a'),('task12_login_b')) AS roles(n);
-- Technical synthetic rows: no session, approval, guest delivery, or native marker.
INSERT INTO asi_task11_private.policy_release
 SELECT s.account_id,s.property_id,repeat('c',64),repeat('d',64),'UTC',
 encode(sha256(convert_to(to_jsonb(k)::text,'UTF8')),'hex'),'task12',repeat('a',64),'task12',repeat('b',64)
 FROM task12_fixture.slots s JOIN public.tg_property_knowledge k ON k.property_id=s.property_id::text;
INSERT INTO asi_task11_private.guest_consent
 SELECT booking_id,'SYNTHETIC_NOT_REAL_CONSENT',repeat('e',64),clock_timestamp()+interval '15 minutes',false FROM task12_fixture.slots;
CREATE FUNCTION task13_fixture.account_allowed(a uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM asi_task11_private.principals p JOIN task12_fixture.slots s ON s.account_id=p.account_id
 WHERE p.login_role=session_user AND p.account_id=a AND p.purpose IN ('writer','operator')) $$;
CREATE FUNCTION task13_fixture.property_allowed(p text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.properties x WHERE x.id::text=p AND task13_fixture.account_allowed(x.account_id)) $$;
CREATE FUNCTION task13_fixture.booking_allowed(b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.booking_ops_records x WHERE x.id=b AND task13_fixture.account_allowed(x.account_id::uuid)) $$;
CREATE FUNCTION task13_fixture.observe(i integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s task12_fixture.slots%ROWTYPE; g asi_task11_private.generations%ROWTYPE; q asi_task08_private.requests%ROWTYPE;
BEGIN
 SELECT * INTO STRICT s FROM task12_fixture.slots WHERE slot=i;
 PERFORM asi_task11_private.principal(s.account_id);
 IF session_user NOT IN ('task12_login_a','task12_login_b','task12_provisioner','task13_custodian')
 THEN RAISE EXCEPTION 'task13_observer'; END IF;
 SELECT * INTO STRICT g FROM asi_task11_private.generations WHERE account_id=s.account_id AND property_id=s.property_id;
 SELECT * INTO q FROM asi_task08_private.requests WHERE request_id=s.request_id;
 RETURN jsonb_build_object('slot',i,'account',s.account_id,'property',s.property_id,'actor',s.actor_id,
 'booking',s.booking_id,'predecessor',s.predecessor_id,'request',s.request_id,'decision',s.decision_id,
 'session',s.session_id,'source',s.source_id,
 'vector',jsonb_build_array(g.booking::text,g.physical::text,g.cleaning::text,g.policy::text,g.legal::text,g.checkout::text),
 'memberEpoch',(SELECT epoch::text FROM asi_task11_private.member_epochs WHERE account_id=s.account_id AND actor_id=s.actor_id),
 'serial',(SELECT serial::text FROM asi_task11_private.installation WHERE singleton),
 'nativeMarker',(SELECT native_acceptance_sha256 IS NOT NULL FROM asi_task11_private.installation WHERE singleton),
 'requestVersion',q.version::text,'requestStatus',q.row_data->>'status',
 'cleaningHash',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]')::text,'UTF8')),'hex') FROM public.booking_cleaning_tasks x WHERE booking_id=s.booking_id),
 'memberHash',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]')::text,'UTF8')),'hex') FROM public.account_members x WHERE account_id=s.account_id AND user_id=s.actor_id),
 'principalHash',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.login_role),'[]')::text,'UTF8')),'hex') FROM asi_task11_private.principals x WHERE account_id=s.account_id),
 'policyHash',(SELECT manifest_sha256 FROM asi_task11_private.policy_release WHERE account_id=s.account_id AND property_id=s.property_id),
 'guestRevoked',(SELECT revoked FROM asi_task11_private.guest_consent WHERE booking_id=s.booking_id),
 'foreignCount',(SELECT count(*) FROM public.properties WHERE id=task12_fixture.fid(99,2)),
 'foreignHash',(SELECT encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex') FROM public.properties x WHERE id=task12_fixture.fid(99,2)),
 'predecessorCount',(SELECT count(*) FROM public.booking_ops_records WHERE property_id=s.property_id::text AND booking_id=s.source_pred),
 'parentCount',(SELECT count(*) FROM public.booking_ops_records WHERE id=s.booking_id),
 'children',jsonb_build_object('booking_cleaning_tasks',(SELECT count(*) FROM public.booking_cleaning_tasks WHERE booking_id=s.booking_id),'booking_linen_tasks',(SELECT count(*) FROM public.booking_linen_tasks WHERE booking_id=s.booking_id),'booking_supplies_tasks',(SELECT count(*) FROM public.booking_supplies_tasks WHERE booking_id=s.booking_id),'booking_maintenance_tickets',(SELECT count(*) FROM public.booking_maintenance_tickets WHERE booking_id=s.booking_id),'booking_physical_readiness',(SELECT count(*) FROM public.booking_physical_readiness WHERE booking_id=s.booking_id),'booking_guest_documents',(SELECT count(*) FROM public.booking_guest_documents WHERE booking_id=s.booking_id),'booking_contracts',(SELECT count(*) FROM public.booking_contracts WHERE booking_id=s.booking_id),'booking_deposits',(SELECT count(*) FROM public.booking_deposits WHERE booking_id=s.booking_id),'booking_mvd_reports',(SELECT count(*) FROM public.booking_mvd_reports WHERE booking_id=s.booking_id),'booking_guest_legal_readiness',(SELECT count(*) FROM public.booking_guest_legal_readiness WHERE booking_id=s.booking_id),'booking_instay_checkout',(SELECT count(*) FROM public.booking_instay_checkout WHERE booking_id=s.booking_id),'booking_guest_stay_issues',(SELECT count(*) FROM public.booking_guest_stay_issues WHERE booking_id=s.booking_id)),
 'childCount',(SELECT count(*) FROM public.booking_cleaning_tasks WHERE booking_id=s.booking_id),
 'tombstone',(SELECT deleted FROM asi_task11_private.booking_scope WHERE booking_id=s.booking_id),
 'totals',jsonb_build_object('requests',(SELECT count(*) FROM asi_task08_private.requests),'bindings',(SELECT count(*) FROM asi_task11_private.request_binding),
 'decisions',(SELECT count(*) FROM asi_task11_private.decisions),'sessions',(SELECT count(*) FROM public.sessions)),
 'canApprove',false,'canSend',false);
END $$;
CREATE FUNCTION task13_fixture.coverage(i integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a uuid; BEGIN SELECT account_id INTO STRICT a FROM task12_fixture.slots WHERE slot=i;
 PERFORM asi_task11_private.principal(a); PERFORM asi_task11_private.assert_coverage(); END $$;
CREATE FUNCTION task13_fixture.gate(i integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a uuid; BEGIN SELECT account_id INTO STRICT a FROM task12_fixture.slots WHERE slot=i;
 PERFORM asi_task11_private.principal(a); PERFORM asi_task11_private.take_gate(); END $$;
CREATE FUNCTION task13_fixture.negative(i integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s task12_fixture.slots%ROWTYPE; BEGIN SELECT * INTO STRICT s FROM task12_fixture.slots WHERE slot=i;
 PERFORM asi_task11_private.principal(s.account_id);
 RETURN asi_task11_private.facts(jsonb_build_object('accountId',s.account_id,'propertyId',s.property_id,
 'bookingOpsRecordId',s.booking_id,'actorUserId',s.actor_id),NULL); END $$;
-- Two independent lock rows for a true bounded deadlock, outside global Task11 gate.
CREATE TABLE task13_fixture.lock_rows(id integer PRIMARY KEY CHECK(id IN (1,2)),v integer NOT NULL DEFAULT 0);
INSERT INTO task13_fixture.lock_rows VALUES(1,0),(2,0);
ALTER TABLE task13_fixture.lock_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE task13_fixture.lock_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY task13_lock_owner ON task13_fixture.lock_rows TO strigunov_task11_owner USING(true) WITH CHECK(true);
CREATE POLICY task13_lock_apps ON task13_fixture.lock_rows TO task12_login_a,task12_login_b USING(true) WITH CHECK(true);
GRANT SELECT,UPDATE ON task13_fixture.lock_rows TO task12_login_a,task12_login_b;
DO $policies$
DECLARE n text; predicate text;
BEGIN
 FOREACH n IN ARRAY ARRAY['booking_ops_records','properties','account_members','ru_legal_acceptances','tg_guest_reservations','tg_property_knowledge',
 'booking_cleaning_tasks','booking_linen_tasks','booking_supplies_tasks','booking_maintenance_tickets','booking_physical_readiness',
 'booking_guest_documents','booking_contracts','booking_deposits','booking_mvd_reports','booking_guest_legal_readiness','booking_instay_checkout','booking_guest_stay_issues'] LOOP
 predicate:=CASE WHEN n IN ('booking_ops_records','properties','account_members','ru_legal_acceptances') THEN 'task13_fixture.account_allowed(account_id::uuid)'
 WHEN n IN ('tg_guest_reservations','tg_property_knowledge') THEN 'task13_fixture.property_allowed(property_id)' ELSE 'task13_fixture.booking_allowed(booking_id)' END;
 EXECUTE format('CREATE POLICY task13_writer ON public.%I TO task12_login_b USING(%s) WITH CHECK(%s)',n,predicate,predicate);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO task12_login_b',n);
 END LOOP;
END $policies$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA task13_fixture FROM PUBLIC,anon,authenticated,service_role,task12_denied;
GRANT USAGE ON SCHEMA task13_fixture TO task12_login_a,task12_login_b;
GRANT EXECUTE ON FUNCTION task13_fixture.account_allowed(uuid),task13_fixture.property_allowed(text),task13_fixture.booking_allowed(uuid),
 task13_fixture.observe(integer),task13_fixture.coverage(integer),task13_fixture.gate(integer),task13_fixture.negative(integer) TO task12_login_a,task12_login_b;
-- A/B receive no private tables, DDL, issue_session, admit_request, decide or marker grants.
COMMIT;
