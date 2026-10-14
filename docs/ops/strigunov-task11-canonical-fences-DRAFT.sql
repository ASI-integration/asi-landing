-- TASK11 SOURCE DRAFT ONLY. NOT A MIGRATION. NOT APPLIED.
-- PostgreSQL17 isolated-fixture candidate; no production installation permitted.
-- Requires Task08 draft requests table, canonical source DDL, dedicated owner.
-- Exact artifact/hash, role provisioning and DB creation need separate approval.
BEGIN;
DO $install$
BEGIN
 IF current_database() <> 'strigunov_task11_isolated_lab'
    OR current_user <> 'strigunov_task11_owner' THEN
  RAISE EXCEPTION 'task11_isolated_install_prerequisite';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user
            AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
  RAISE EXCEPTION 'task11_owner_must_be_nonlogin_nonbypass';
 END IF;
 IF to_regclass('asi_task08_private.requests') IS NULL THEN
  RAISE EXCEPTION 'task08_request_contract_missing';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='asi_task11_private') THEN
  RAISE EXCEPTION 'task11_existing_schema_requires_exact_review';
 END IF;
END $install$;
CREATE SCHEMA IF NOT EXISTS asi_task11_private;
REVOKE ALL ON SCHEMA asi_task11_private FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA asi_task11_private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA asi_task11_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE IF NOT EXISTS asi_task11_private.installation (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 contract_version text NOT NULL CHECK(contract_version='task11.v1'),
 serial bigint NOT NULL CHECK(serial BETWEEN 1 AND 9223372036854775806),
 native_acceptance_sha256 text CHECK(native_acceptance_sha256 ~ '^[0-9a-f]{64}$')
);
INSERT INTO asi_task11_private.installation VALUES(true,'task11.v1',1,NULL)
 ON CONFLICT(singleton) DO NOTHING;
-- No initial role mapping, policy release, guest consent or native acceptance.
CREATE TABLE IF NOT EXISTS asi_task11_private.principals (
 login_role name NOT NULL, account_id uuid NOT NULL, actor_id uuid,
 purpose text NOT NULL CHECK(purpose IN ('writer','operator','issuer')),
 PRIMARY KEY(login_role,account_id)
);
CREATE TABLE IF NOT EXISTS asi_task11_private.generations (
 account_id uuid NOT NULL, property_id uuid NOT NULL,
 booking bigint NOT NULL DEFAULT 1 CHECK(booking BETWEEN 1 AND 9223372036854775806),
 physical bigint NOT NULL DEFAULT 1 CHECK(physical BETWEEN 1 AND 9223372036854775806),
 cleaning bigint NOT NULL DEFAULT 1 CHECK(cleaning BETWEEN 1 AND 9223372036854775806),
 policy bigint NOT NULL DEFAULT 1 CHECK(policy BETWEEN 1 AND 9223372036854775806),
 legal bigint NOT NULL DEFAULT 1 CHECK(legal BETWEEN 1 AND 9223372036854775806),
 checkout bigint NOT NULL DEFAULT 1 CHECK(checkout BETWEEN 1 AND 9223372036854775806),
 PRIMARY KEY(account_id,property_id)
);
-- Tombstone lookup retained after parent deletion for FK cascade child triggers.
CREATE TABLE IF NOT EXISTS asi_task11_private.booking_scope (
 booking_id uuid PRIMARY KEY, account_id uuid NOT NULL, property_id uuid NOT NULL,
 source_booking_id text, deleted boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS asi_task11_private.member_epochs (
 account_id uuid NOT NULL, actor_id uuid NOT NULL,
 epoch bigint NOT NULL CHECK(epoch BETWEEN 1 AND 9223372036854775806),
 PRIMARY KEY(account_id,actor_id)
);
CREATE TABLE IF NOT EXISTS asi_task11_private.consent_epochs (
 account_id uuid PRIMARY KEY, epoch bigint NOT NULL CHECK(epoch BETWEEN 1 AND 9223372036854775806)
);
CREATE TABLE IF NOT EXISTS asi_task11_private.session_epochs (
 session_id uuid PRIMARY KEY, actor_id uuid NOT NULL,
 epoch bigint NOT NULL CHECK(epoch BETWEEN 1 AND 9223372036854775806),
 revoked boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS asi_task11_private.policy_release (
 account_id uuid NOT NULL, property_id uuid NOT NULL,
 artifact_sha256 text NOT NULL CHECK(artifact_sha256 ~ '^[0-9a-f]{64}$'),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
 time_zone text NOT NULL,
 policy_row_sha256 text NOT NULL CHECK(policy_row_sha256 ~ '^[0-9a-f]{64}$'),
 offer_version text NOT NULL, offer_sha256 text NOT NULL CHECK(offer_sha256 ~ '^[0-9a-f]{64}$'),
 consent_version text NOT NULL, consent_sha256 text NOT NULL CHECK(consent_sha256 ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(account_id,property_id)
);
-- Candidate for verified guest-specific consent provenance; NOT account consent.
-- No seeding/API/grant: actual trusted capture integration remains a rollout gate.
CREATE TABLE IF NOT EXISTS asi_task11_private.guest_consent (
 booking_id uuid PRIMARY KEY, source_ref text NOT NULL CHECK(length(source_ref) BETWEEN 1 AND 160),
 document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[0-9a-f]{64}$'),
 valid_until timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS asi_task11_private.request_binding (
 request_id uuid PRIMARY KEY REFERENCES asi_task08_private.requests(request_id),
 session_id uuid NOT NULL, actor_id uuid NOT NULL, account_id uuid NOT NULL, property_id uuid NOT NULL,
 booking_id uuid NOT NULL, source_booking_id text NOT NULL, predecessor_id uuid NOT NULL,
 recipient_ref text NOT NULL CHECK(recipient_ref ~ '^rcpt_[0-9a-f]{32,64}$'),
 session_epoch bigint NOT NULL, member_epoch bigint NOT NULL, consent_epoch bigint NOT NULL,
 vector bigint[] NOT NULL CHECK(cardinality(vector)=6 AND array_ndims(vector)=1 AND array_lower(vector,1)=1
  AND array_position(vector,NULL) IS NULL AND 0<ALL(vector) AND 9223372036854775806>=ALL(vector)),
 policy_hash text NOT NULL, row_snapshot jsonb NOT NULL, valid_until timestamptz NOT NULL,
 CHECK(booking_id<>predecessor_id)
);
CREATE TABLE IF NOT EXISTS asi_task11_private.decisions (
 decision_id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE,
 actor_id uuid NOT NULL, session_id uuid NOT NULL, expected_version bigint NOT NULL,
 result_version bigint NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION asi_task11_private.take_gate() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 UPDATE asi_task11_private.installation SET serial=serial+1 WHERE singleton;
 IF NOT FOUND THEN RAISE EXCEPTION 'task11_installation_missing'; END IF;
END $fn$;
CREATE OR REPLACE FUNCTION asi_task11_private.statement_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'task11_truncate_forbidden'; END IF;
 PERFORM asi_task11_private.take_gate();
 RETURN NULL;
END $fn$;
CREATE OR REPLACE FUNCTION asi_task11_private.principal(a uuid, required_purpose text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE p asi_task11_private.principals%ROWTYPE;
BEGIN
 IF session_user IN ('anon','authenticated','service_role','authenticator') OR
    EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'task11_untrusted_principal';
 END IF;
 SELECT * INTO p FROM asi_task11_private.principals WHERE login_role=session_user AND account_id=a;
 IF NOT FOUND OR (required_purpose IS NOT NULL AND p.purpose<>required_purpose) THEN
  RAISE EXCEPTION 'task11_tenant_denied';
 END IF;
 RETURN p.actor_id;
END $fn$;
CREATE OR REPLACE FUNCTION asi_task11_private.invalidate(a uuid,p uuid,u uuid,sid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 UPDATE asi_task08_private.requests q SET version=q.version+1,
 row_data=q.row_data||jsonb_build_object('version',q.version+1,'status','REVOKED','approvalBinding',NULL)
 FROM asi_task11_private.request_binding b
 WHERE q.request_id=b.request_id AND q.row_data->>'status'='APPROVED'
 AND (a IS NULL OR b.account_id=a) AND (p IS NULL OR b.property_id=p)
 AND (u IS NULL OR b.actor_id=u) AND (sid IS NULL OR b.session_id=sid);
END $fn$;

CREATE OR REPLACE FUNCTION asi_task11_private.bump(a uuid,p uuid,domains text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE d text;
BEGIN
 IF a IS NULL OR p IS NULL OR cardinality(domains)=0 THEN RAISE EXCEPTION 'task11_scope_missing'; END IF;
 INSERT INTO asi_task11_private.generations(account_id,property_id) VALUES(a,p) ON CONFLICT DO NOTHING;
 FOREACH d IN ARRAY domains LOOP
  IF d<>ALL(ARRAY['booking','physical','cleaning','policy','legal','checkout']) THEN
   RAISE EXCEPTION 'task11_domain_unknown';
  END IF;
  EXECUTE format('UPDATE asi_task11_private.generations SET %I=%I+1 WHERE account_id=$1 AND property_id=$2',d,d) USING a,p;
 END LOOP;
 PERFORM asi_task11_private.invalidate(a,p,NULL,NULL);
END $fn$;
CREATE OR REPLACE FUNCTION asi_task11_private.capture_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE j jsonb; items jsonb[]:=ARRAY[]::jsonb[]; a uuid; p uuid; b uuid;
 mode text:=TG_ARGV[0]; ds text[]:=string_to_array(TG_ARGV[1],','); cached asi_task11_private.booking_scope%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN items:=array_append(items,to_jsonb(OLD)); END IF;
 IF TG_OP<>'DELETE' THEN items:=array_append(items,to_jsonb(NEW)); END IF;
 FOREACH j IN ARRAY items LOOP
  a:=NULL; p:=NULL; b:=NULL;
  IF mode='property' THEN
   p:=(j->>'id')::uuid; a:=(j->>'account_id')::uuid;
  ELSIF mode='booking' THEN
   b:=(j->>'id')::uuid; p:=(j->>'property_id')::uuid; a:=(j->>'account_id')::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.properties x WHERE x.id=p AND x.account_id=a) THEN
    RAISE EXCEPTION 'task11_booking_scope_mismatch';
   END IF;
  ELSIF mode='property_ref' THEN
   SELECT x.id,x.account_id INTO p,a FROM public.properties x WHERE x.id::text=j->>'property_id';
   IF j ? 'account_id' AND j->>'account_id' IS DISTINCT FROM a::text THEN RAISE EXCEPTION 'task11_foreign_scope'; END IF;
  ELSIF mode='booking_ref' THEN
   b:=(j->>'booking_id')::uuid;
   SELECT * INTO cached FROM asi_task11_private.booking_scope x WHERE x.booking_id=b;
   IF NOT FOUND THEN RAISE EXCEPTION 'task11_unknown_booking_scope'; END IF;
   a:=cached.account_id; p:=cached.property_id;
   IF j ? 'property_id' AND j->>'property_id' IS NOT NULL AND j->>'property_id'<>p::text THEN
    RAISE EXCEPTION 'task11_child_scope_mismatch';
   END IF;
  ELSE RAISE EXCEPTION 'task11_unknown_writer_mode';
  END IF;
  PERFORM asi_task11_private.principal(a);
  PERFORM asi_task11_private.bump(a,p,ds);
 END LOOP;
 IF mode='booking' THEN
  IF TG_OP='DELETE' THEN
   UPDATE asi_task11_private.booking_scope SET deleted=true WHERE booking_id=OLD.id;
  ELSE
   INSERT INTO asi_task11_private.booking_scope VALUES(NEW.id,NEW.account_id::uuid,NEW.property_id::uuid,NEW.booking_id,false)
   ON CONFLICT(booking_id) DO UPDATE SET account_id=EXCLUDED.account_id,property_id=EXCLUDED.property_id,
     source_booking_id=EXCLUDED.source_booking_id,deleted=false;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $fn$;

CREATE OR REPLACE FUNCTION asi_task11_private.capture_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE j jsonb; items jsonb[]:=ARRAY[]::jsonb[]; a uuid; u uuid; sid uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN items:=array_append(items,to_jsonb(OLD)); END IF;
 IF TG_OP<>'DELETE' THEN items:=array_append(items,to_jsonb(NEW)); END IF;
 FOREACH j IN ARRAY items LOOP
  IF TG_TABLE_NAME='account_members' THEN
   a:=(j->>'account_id')::uuid; u:=(j->>'user_id')::uuid;
   PERFORM asi_task11_private.principal(a);
   INSERT INTO asi_task11_private.member_epochs VALUES(a,u,1)
    ON CONFLICT(account_id,actor_id) DO UPDATE SET epoch=asi_task11_private.member_epochs.epoch+1;
   PERFORM asi_task11_private.invalidate(a,NULL,u,NULL);
  ELSIF TG_TABLE_NAME='ru_legal_acceptances' THEN
   a:=(j->>'account_id')::uuid; PERFORM asi_task11_private.principal(a);
   INSERT INTO asi_task11_private.consent_epochs VALUES(a,1)
    ON CONFLICT(account_id) DO UPDATE SET epoch=asi_task11_private.consent_epochs.epoch+1;
   UPDATE asi_task11_private.generations SET legal=legal+1 WHERE account_id=a;
   PERFORM asi_task11_private.invalidate(a,NULL,NULL,NULL);
  ELSIF TG_TABLE_NAME='sessions' THEN
   sid:=(j->>'id')::uuid; u:=(j->>'user_id')::uuid;
   IF session_user IN ('anon','authenticated','service_role','authenticator') OR
    EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) OR
    NOT EXISTS(SELECT 1 FROM asi_task11_private.principals p
    WHERE p.login_role=session_user AND p.actor_id=u AND p.purpose IN ('issuer','operator')) THEN
    RAISE EXCEPTION 'task11_session_actor_denied';
   END IF;
   INSERT INTO asi_task11_private.session_epochs VALUES(sid,u,1,true)
    ON CONFLICT(session_id) DO UPDATE SET epoch=asi_task11_private.session_epochs.epoch+1,revoked=true;
   PERFORM asi_task11_private.invalidate(NULL,NULL,u,sid);
  ELSE RAISE EXCEPTION 'task11_unknown_authority_writer';
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $fn$;
CREATE OR REPLACE FUNCTION asi_task11_private.issue_session(a uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE u uuid; sid uuid:=gen_random_uuid();
BEGIN
 PERFORM asi_task11_private.take_gate();
 u:=asi_task11_private.principal(a,'issuer');
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM public.account_members m
    WHERE m.account_id=a AND m.user_id=u AND m.role IN ('owner','manager')) THEN
  RAISE EXCEPTION 'task11_issuer_actor_invalid';
 END IF;
 -- Trusted login endpoint must validate credentials BEFORE this call; no grant exists.
 INSERT INTO public.sessions(id,user_id,token,expires_at)
  VALUES(sid,u,gen_random_uuid()::text,clock_timestamp()+interval '30 minutes');
 UPDATE asi_task11_private.session_epochs SET revoked=false WHERE session_id=sid AND actor_id=u;
 RETURN sid;
END $fn$;
CREATE OR REPLACE FUNCTION asi_task11_private.revoke_session(sid uuid,a uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE u uuid;
BEGIN
 PERFORM asi_task11_private.take_gate();
 u:=asi_task11_private.principal(a);
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM asi_task11_private.session_epochs s WHERE s.session_id=sid AND s.actor_id=u) THEN
  RAISE EXCEPTION 'task11_session_actor_denied';
 END IF;
 UPDATE public.sessions SET expires_at=clock_timestamp() WHERE id=sid AND user_id=u;
 UPDATE asi_task11_private.session_epochs SET revoked=true,epoch=epoch+1 WHERE session_id=sid;
 PERFORM asi_task11_private.invalidate(NULL,NULL,u,sid);
END $fn$;

CREATE OR REPLACE FUNCTION asi_task11_private.facts(payload jsonb,sid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE a uuid:=(payload->>'accountId')::uuid; p uuid:=(payload->>'propertyId')::uuid;
 bid uuid:=(payload->>'bookingOpsRecordId')::uuid; u uuid;
 b public.booking_ops_records%ROWTYPE; r public.tg_guest_reservations%ROWTYPE;
 pol asi_task11_private.policy_release%ROWTYPE; g asi_task11_private.generations%ROWTYPE;
 ses public.sessions%ROWTYPE; se asi_task11_private.session_epochs%ROWTYPE;
 me bigint; ce bigint; op_role text; pred uuid; candidates uuid[]; arrival timestamptz; deadline timestamptz;
 vec jsonb; d text; idx integer:=0;
BEGIN
 PERFORM asi_task11_private.assert_coverage();
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'task11_serializable_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM asi_task11_private.installation WHERE singleton AND native_acceptance_sha256 IS NOT NULL) THEN
  RAISE EXCEPTION 'task11_native_acceptance_missing';
 END IF;
 u:=asi_task11_private.principal(a,'operator');
 IF u IS NULL OR payload->>'actorUserId' IS DISTINCT FROM u::text THEN RAISE EXCEPTION 'task11_actor_mismatch'; END IF;
 SELECT * INTO ses FROM public.sessions WHERE id=sid AND user_id=u AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'task11_session_missing'; END IF;
 SELECT * INTO se FROM asi_task11_private.session_epochs WHERE session_id=sid AND actor_id=u AND NOT revoked;
 IF NOT FOUND THEN RAISE EXCEPTION 'task11_session_revoked'; END IF;
 IF (SELECT count(*) FROM public.account_members WHERE user_id=u)<>1 THEN RAISE EXCEPTION 'task11_membership_ambiguous'; END IF;
 SELECT role INTO op_role FROM public.account_members WHERE account_id=a AND user_id=u AND role IN ('owner','manager');
 IF NOT FOUND THEN RAISE EXCEPTION 'task11_role_denied'; END IF;
 SELECT epoch INTO me FROM asi_task11_private.member_epochs WHERE account_id=a AND actor_id=u;
 SELECT epoch INTO ce FROM asi_task11_private.consent_epochs WHERE account_id=a;
 IF me IS NULL OR ce IS NULL THEN RAISE EXCEPTION 'task11_epoch_missing'; END IF;
 SELECT * INTO b FROM public.booking_ops_records WHERE id=bid AND account_id=a::text AND property_id=p::text;
 IF NOT FOUND OR b.is_blocked OR b.ops_status NOT IN ('ready_for_checkin','checkin_instructions_ready')
    OR b.booking_id IS DISTINCT FROM payload->>'sourceBookingRef' THEN RAISE EXCEPTION 'task11_booking_invalid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p AND account_id=a AND status='active') THEN
  RAISE EXCEPTION 'task11_property_invalid';
 END IF;
 -- Upstream identity is reservation.id, NOT its optional booking_id alias.
 SELECT * INTO r FROM public.tg_guest_reservations WHERE id=b.booking_id AND property_id=p::text;
 IF NOT FOUND OR r.status IS DISTINCT FROM 'confirmed' OR r.check_in IS NULL OR r.check_out IS NULL
    OR r.check_out<=r.check_in OR r.check_in IS DISTINCT FROM b.check_in_at OR r.check_out IS DISTINCT FROM b.check_out_at THEN
  RAISE EXCEPTION 'task11_upstream_changed';
 END IF;
 SELECT * INTO pol FROM asi_task11_private.policy_release WHERE account_id=a AND property_id=p;
 IF NOT FOUND OR payload->>'policyRevision' IS DISTINCT FROM pol.manifest_sha256
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=pol.time_zone)
    OR NOT EXISTS(SELECT 1 FROM public.tg_property_knowledge k WHERE k.property_id=p::text AND k.active
      AND encode(sha256(convert_to(to_jsonb(k)::text,'UTF8')),'hex')=pol.policy_row_sha256 AND length(trim(coalesce(k.early_checkin_policy,'')))>0) THEN
  RAISE EXCEPTION 'task11_policy_missing';
 END IF;
 arrival:=(date_trunc('day',r.check_in AT TIME ZONE pol.time_zone)+interval '12 hours') AT TIME ZONE pol.time_zone;
 IF arrival>=r.check_in OR arrival<=clock_timestamp() THEN RAISE EXCEPTION 'task11_early_arrival_invalid'; END IF;
 IF EXISTS(SELECT 1 FROM public.tg_guest_reservations z WHERE z.property_id=p::text AND z.id<>r.id
   AND z.status IS DISTINCT FROM 'cancelled'
   AND (z.check_in IS NULL OR z.check_out IS NULL OR z.check_out<=z.check_in
     OR (z.check_in<r.check_out AND z.check_out>arrival))) THEN
  RAISE EXCEPTION 'task11_overlap_or_unknown_reservation';
 END IF;
 SELECT array_agg(x.id ORDER BY x.id) INTO candidates
 FROM public.booking_ops_records x JOIN public.tg_guest_reservations z ON z.id=x.booking_id
 WHERE x.property_id=p::text AND x.account_id=a::text AND x.id<>bid
  AND z.property_id=p::text AND z.status='confirmed' AND NOT x.is_blocked
  AND z.check_out=(SELECT max(v.check_out) FROM public.tg_guest_reservations v
    WHERE v.property_id=p::text AND v.id<>r.id AND v.status='confirmed' AND v.check_out<=arrival)
  AND x.check_in_at=z.check_in AND x.check_out_at=z.check_out;
 IF cardinality(candidates) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'task11_predecessor_ambiguous'; END IF;
 pred:=candidates[1];
 IF NOT EXISTS(SELECT 1 FROM public.booking_instay_checkout c WHERE c.booking_id=pred
   AND c.actual_checkout_at IS NOT NULL AND c.actual_checkout_at<=arrival AND c.actual_checkout_at<=clock_timestamp()
   AND c.planned_checkout_at IS NOT NULL AND c.planned_checkout_at<=arrival
   AND c.inspection_status='done' AND c.checkout_confirmation_status='confirmed'
   AND c.status IN ('inspection_done','deposit_return_ready','ready_to_close','closed'))
   OR EXISTS(SELECT 1 FROM public.booking_guest_stay_issues i WHERE i.booking_id=pred AND i.status NOT IN ('resolved','cancelled')) THEN
  RAISE EXCEPTION 'task11_previous_checkout_incomplete';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.booking_physical_readiness x WHERE x.booking_id=bid AND x.property_id=p::text
   AND x.updated_at BETWEEN clock_timestamp()-interval '5 minutes' AND clock_timestamp()
   AND x.status='approved' AND x.final_ready AND x.blockers='[]'::jsonb)
   OR NOT EXISTS(SELECT 1 FROM public.booking_cleaning_tasks x WHERE x.booking_id=bid AND x.property_id=p::text AND x.status='verified' AND x.verified_at IS NOT NULL AND x.verified_at<=clock_timestamp())
   OR NOT EXISTS(SELECT 1 FROM public.booking_linen_tasks x WHERE x.booking_id=bid AND x.property_id=p::text AND x.status='verified' AND x.verified_at IS NOT NULL AND x.verified_at<=clock_timestamp())
   OR NOT EXISTS(SELECT 1 FROM public.booking_supplies_tasks x WHERE x.booking_id=bid AND x.property_id=p::text AND x.status='verified' AND x.verified_at IS NOT NULL AND x.verified_at<=clock_timestamp())
   OR EXISTS(SELECT 1 FROM public.booking_maintenance_tickets x WHERE x.booking_id=bid AND x.status NOT IN ('verified','cancelled')) THEN
  RAISE EXCEPTION 'task11_physical_not_ready';
 END IF;
 -- Re-read children; a stale ready summary cannot authorize a newly captured vector.
 IF NOT EXISTS(SELECT 1 FROM public.booking_guest_documents x WHERE x.booking_id=bid)
   OR EXISTS(SELECT 1 FROM public.booking_guest_documents x WHERE x.booking_id=bid AND (x.status IS DISTINCT FROM 'verified' OR x.verified_at IS NULL OR x.verified_at>clock_timestamp()
      OR (x.expires_at IS NOT NULL AND x.expires_at<=clock_timestamp())))
   OR (SELECT count(*) FROM public.booking_contracts x WHERE x.booking_id=bid)<>1
   OR NOT EXISTS(SELECT 1 FROM public.booking_contracts x WHERE x.booking_id=bid AND x.status='signed_manual' AND x.provider='manual' AND x.signed_at IS NOT NULL AND x.signed_at<=clock_timestamp())
   OR (SELECT count(*) FROM public.booking_deposits x WHERE x.booking_id=bid)<>1
   OR NOT EXISTS(SELECT 1 FROM public.booking_deposits x WHERE x.booking_id=bid AND x.provider='manual' AND (x.status='waived_manual'
      OR (x.status='paid_manual' AND x.received_at IS NOT NULL AND x.received_at<=clock_timestamp())))
   OR (SELECT count(*) FROM public.booking_mvd_reports x WHERE x.booking_id=bid)<>1
   OR NOT EXISTS(SELECT 1 FROM public.booking_mvd_reports x WHERE x.booking_id=bid AND x.provider='manual' AND (x.status='not_required'
      OR (x.status='accepted_manual' AND x.accepted_at IS NOT NULL AND x.accepted_at<=clock_timestamp()))) THEN
  RAISE EXCEPTION 'task11_legal_children_incomplete';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.booking_guest_legal_readiness x WHERE x.booking_id=bid
   AND x.property_id=p::text AND x.status='ready_for_checkin' AND x.blockers='[]'::jsonb) THEN
  RAISE EXCEPTION 'task11_guest_legal_not_ready';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ru_legal_acceptances x WHERE x.account_id=a AND x.document_type='offer'
   AND x.document_version=pol.offer_version AND x.document_sha256=pol.offer_sha256)
   OR NOT EXISTS(SELECT 1 FROM public.ru_legal_acceptances x WHERE x.account_id=a AND x.document_type='personal_data_consent'
   AND x.document_version=pol.consent_version AND x.document_sha256=pol.consent_sha256) THEN
  RAISE EXCEPTION 'task11_account_consent_invalid';
 END IF;
 SELECT least(valid_until,ses.expires_at,(payload->>'validUntil')::timestamptz,
  (SELECT min(expires_at) FROM public.booking_guest_documents WHERE booking_id=bid)) INTO deadline
 FROM asi_task11_private.guest_consent WHERE booking_id=bid AND NOT revoked AND valid_until>clock_timestamp();
 IF deadline IS NULL OR deadline<=clock_timestamp()
    OR (payload->>'observedAt')::timestamptz>clock_timestamp()
    OR (payload->>'validUntil')::timestamptz>(payload->>'observedAt')::timestamptz+interval '5 minutes' THEN
  RAISE EXCEPTION 'task11_guest_consent_or_expiry_invalid';
 END IF;
 SELECT * INTO g FROM asi_task11_private.generations WHERE account_id=a AND property_id=p FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'task11_generations_missing'; END IF;
 vec:=jsonb_build_array(g.booking::text,g.physical::text,g.cleaning::text,g.policy::text,g.legal::text,g.checkout::text);
 FOREACH d IN ARRAY ARRAY['booking','physical','cleaning','policy','legal','checkout'] LOOP
  IF payload->'evidenceRevisions'->>d IS DISTINCT FROM vec->>idx THEN RAISE EXCEPTION 'task11_generation_changed'; END IF;
  idx:=idx+1;
 END LOOP;
 RETURN jsonb_build_object('account',a,'property',p,'booking',bid,'source',b.booking_id,
  'actor',u,'session',sid,'predecessor',pred,'recipient',payload->>'opaqueRecipientRef',
  'sessionEpoch',se.epoch,'memberEpoch',me,'consentEpoch',ce,'vector',vec,
  'policyHash',pol.manifest_sha256,'role',op_role,'deadline',deadline);
END $fn$;

CREATE OR REPLACE FUNCTION asi_task11_private.admit_request(rid uuid,sid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE q asi_task08_private.requests%ROWTYPE; f jsonb; v bigint[];
BEGIN
 PERFORM asi_task11_private.take_gate();
 SELECT * INTO q FROM asi_task08_private.requests WHERE request_id=rid FOR UPDATE;
 IF NOT FOUND OR q.version<>1 OR q.row_data->>'status'<>'REVIEW_REQUIRED' THEN RAISE EXCEPTION 'task11_intake_invalid'; END IF;
 f:=asi_task11_private.facts(q.row_data,sid);
 SELECT array_agg(value::bigint ORDER BY ord) INTO v FROM jsonb_array_elements_text(f->'vector') WITH ORDINALITY AS a(value,ord);
 INSERT INTO asi_task11_private.request_binding VALUES(rid,sid,(f->>'actor')::uuid,(f->>'account')::uuid,(f->>'property')::uuid,
  (f->>'booking')::uuid,f->>'source',(f->>'predecessor')::uuid,f->>'recipient',
  (f->>'sessionEpoch')::bigint,(f->>'memberEpoch')::bigint,(f->>'consentEpoch')::bigint,
  v,f->>'policyHash',q.row_data,(f->>'deadline')::timestamptz);
 -- No ON CONFLICT overwrite: duplicate binding must reconcile, never replace.
END $fn$;

CREATE OR REPLACE FUNCTION asi_task11_private.decide(rid uuid,sid uuid,expected_version bigint,did uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE q asi_task08_private.requests%ROWTYPE; bind asi_task11_private.request_binding%ROWTYPE;
 prior asi_task11_private.decisions%ROWTYPE; f jsonb; v bigint[]; changed integer;
BEGIN
 PERFORM asi_task11_private.take_gate();
 SELECT * INTO q FROM asi_task08_private.requests WHERE request_id=rid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'task11_request_missing'; END IF;
 SELECT * INTO bind FROM asi_task11_private.request_binding WHERE request_id=rid FOR UPDATE;
 IF NOT FOUND OR bind.session_id<>sid OR bind.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'task11_binding_missing'; END IF;
 f:=asi_task11_private.facts(q.row_data,sid);
 SELECT array_agg(value::bigint ORDER BY ord) INTO v FROM jsonb_array_elements_text(f->'vector') WITH ORDINALITY AS a(value,ord);
 IF (f->>'actor')::uuid<>bind.actor_id OR (f->>'account')::uuid<>bind.account_id
  OR (f->>'property')::uuid<>bind.property_id OR (f->>'booking')::uuid<>bind.booking_id
  OR f->>'source' IS DISTINCT FROM bind.source_booking_id OR (f->>'predecessor')::uuid<>bind.predecessor_id
  OR f->>'recipient' IS DISTINCT FROM bind.recipient_ref OR v IS DISTINCT FROM bind.vector
  OR (f->>'sessionEpoch')::bigint<>bind.session_epoch OR (f->>'memberEpoch')::bigint<>bind.member_epoch
  OR (f->>'consentEpoch')::bigint<>bind.consent_epoch OR f->>'policyHash' IS DISTINCT FROM bind.policy_hash
  OR (q.row_data-ARRAY['version','status','decisionId','decisionActorId','approvalBinding'])
     IS DISTINCT FROM (bind.row_snapshot-ARRAY['version','status','decisionId','decisionActorId','approvalBinding']) THEN
  RAISE EXCEPTION 'task11_binding_stale';
 END IF;
 SELECT * INTO prior FROM asi_task11_private.decisions WHERE decision_id=did;
 IF FOUND THEN
  IF prior.request_id<>rid OR prior.session_id<>sid OR prior.actor_id<>bind.actor_id
     OR prior.expected_version<>expected_version OR prior.result_version<>q.version
     OR q.row_data->>'status'<>'APPROVED' THEN RAISE EXCEPTION 'task11_replay_conflict'; END IF;
  RETURN jsonb_build_object('status','SOURCE_REVIEWED','requestId',rid,'version',q.version::text,'canSend',false);
 END IF;
 IF expected_version IS NULL OR did IS NULL OR q.version<>expected_version OR q.row_data->>'status'<>'REVIEW_REQUIRED' THEN
  RAISE EXCEPTION 'task11_cas_rejected';
 END IF;
 UPDATE asi_task08_private.requests SET version=version+1,row_data=row_data||jsonb_build_object(
  'version',version+1,'status','APPROVED','decisionId',did,'decisionActorId',bind.actor_id,
  'approvalBinding',jsonb_build_object('membershipRevision',bind.member_epoch::text,
    'ownerScopeRevision',bind.session_epoch::text,'operatorRole',f->>'role'))
 WHERE request_id=rid AND version=expected_version;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'task11_cas_rejected'; END IF;
 INSERT INTO asi_task11_private.decisions(decision_id,request_id,actor_id,session_id,expected_version,result_version)
  VALUES(did,rid,bind.actor_id,sid,expected_version,expected_version+1);
 IF clock_timestamp()>=least(bind.valid_until,(f->>'deadline')::timestamptz) THEN RAISE EXCEPTION 'task11_expired_at_finalize'; END IF;
 RETURN jsonb_build_object('status','SOURCE_REVIEWED','requestId',rid,'version',(expected_version+1)::text,'canSend',false);
 -- ACK COMMIT required outside this function; UNKNOWN/40001/40P01 => HOLD, no automatic retry.
END $fn$;
-- Missing canonical tables abort installation; no silent conditional trigger skip.
LOCK TABLE public.booking_ops_records, public.tg_guest_reservations, public.booking_physical_readiness, public.booking_cleaning_tasks, public.booking_linen_tasks, public.booking_supplies_tasks, public.booking_maintenance_tickets, public.tg_property_knowledge, public.booking_guest_documents, public.booking_contracts, public.booking_deposits, public.booking_mvd_reports, public.booking_guest_legal_readiness, public.booking_instay_checkout, public.booking_guest_stay_issues, public.properties, public.account_members, public.ru_legal_acceptances, public.sessions IN ACCESS EXCLUSIVE MODE;
-- Bootstraps only identities/counters, never authority or consent. Tombstones retained.
INSERT INTO asi_task11_private.booking_scope
 SELECT id,account_id::uuid,property_id::uuid,booking_id,false FROM public.booking_ops_records
 ON CONFLICT(booking_id) DO NOTHING;
INSERT INTO asi_task11_private.generations(account_id,property_id)
 SELECT account_id,id FROM public.properties ON CONFLICT DO NOTHING;
INSERT INTO asi_task11_private.member_epochs(account_id,actor_id,epoch)
 SELECT account_id,user_id,1 FROM public.account_members ON CONFLICT DO NOTHING;
INSERT INTO asi_task11_private.consent_epochs(account_id,epoch)
 SELECT DISTINCT account_id,1 FROM public.ru_legal_acceptances ON CONFLICT DO NOTHING;
INSERT INTO asi_task11_private.session_epochs(session_id,actor_id,epoch,revoked)
 SELECT id,user_id,1,true FROM public.sessions ON CONFLICT DO NOTHING;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.booking_ops_records
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.booking_ops_records ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_ops_records
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking','booking,checkout');
ALTER TABLE public.booking_ops_records ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.tg_guest_reservations
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.tg_guest_reservations ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.tg_guest_reservations
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('property_ref','booking,checkout');
ALTER TABLE public.tg_guest_reservations ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.booking_physical_readiness
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.booking_physical_readiness ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_physical_readiness
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','physical');
ALTER TABLE public.booking_physical_readiness ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.booking_cleaning_tasks
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.booking_cleaning_tasks ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_cleaning_tasks
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','cleaning,physical');
ALTER TABLE public.booking_cleaning_tasks ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.booking_linen_tasks
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.booking_linen_tasks ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_linen_tasks
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','physical');
ALTER TABLE public.booking_linen_tasks ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.booking_supplies_tasks
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.booking_supplies_tasks ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_supplies_tasks
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','physical');
ALTER TABLE public.booking_supplies_tasks ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.booking_maintenance_tickets
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.booking_maintenance_tickets ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_maintenance_tickets
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','physical');
ALTER TABLE public.booking_maintenance_tickets ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.tg_property_knowledge
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.tg_property_knowledge ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.tg_property_knowledge
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('property_ref','policy');
ALTER TABLE public.tg_property_knowledge ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.booking_guest_documents
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.booking_guest_documents ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_guest_documents
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','legal');
ALTER TABLE public.booking_guest_documents ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.booking_contracts
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.booking_contracts ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_contracts
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','legal');
ALTER TABLE public.booking_contracts ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.booking_deposits
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.booking_deposits ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_deposits
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','legal');
ALTER TABLE public.booking_deposits ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.booking_mvd_reports
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.booking_mvd_reports ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_mvd_reports
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','legal');
ALTER TABLE public.booking_mvd_reports ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.booking_guest_legal_readiness
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.booking_guest_legal_readiness ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_guest_legal_readiness
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','legal');
ALTER TABLE public.booking_guest_legal_readiness ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.booking_instay_checkout
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.booking_instay_checkout ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_instay_checkout
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','checkout');
ALTER TABLE public.booking_instay_checkout ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.booking_guest_stay_issues
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.booking_guest_stay_issues ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_guest_stay_issues
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','checkout');
ALTER TABLE public.booking_guest_stay_issues ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.properties
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.properties ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.properties
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('property','booking,physical,cleaning,policy,legal,checkout');
ALTER TABLE public.properties ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON asi_task11_private.policy_release
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE asi_task11_private.policy_release ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON asi_task11_private.policy_release
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('property_ref','policy');
ALTER TABLE asi_task11_private.policy_release ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON asi_task11_private.guest_consent
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE asi_task11_private.guest_consent ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON asi_task11_private.guest_consent
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','legal');
ALTER TABLE asi_task11_private.guest_consent ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.account_members
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.account_members ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.account_members
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_authority();
ALTER TABLE public.account_members ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.ru_legal_acceptances
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.ru_legal_acceptances ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.ru_legal_acceptances
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_authority();
ALTER TABLE public.ru_legal_acceptances ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.sessions
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE public.sessions ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.sessions
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_authority();
ALTER TABLE public.sessions ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE FUNCTION asi_task11_private.capture_principal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP<>'INSERT' THEN
  UPDATE asi_task11_private.member_epochs SET epoch=epoch+1 WHERE account_id=OLD.account_id;
  PERFORM asi_task11_private.invalidate(OLD.account_id,NULL,NULL,NULL);
 END IF;
 IF TG_OP<>'DELETE' THEN
  UPDATE asi_task11_private.member_epochs SET epoch=epoch+1 WHERE account_id=NEW.account_id;
  PERFORM asi_task11_private.invalidate(NEW.account_id,NULL,NULL,NULL);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $fn$;
CREATE OR REPLACE TRIGGER task11_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON asi_task11_private.principals
 FOR EACH STATEMENT EXECUTE FUNCTION asi_task11_private.statement_gate();
ALTER TABLE asi_task11_private.principals ENABLE ALWAYS TRIGGER task11_gate;
CREATE OR REPLACE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON asi_task11_private.principals
 FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_principal();
ALTER TABLE asi_task11_private.principals ENABLE ALWAYS TRIGGER task11_capture;

CREATE OR REPLACE FUNCTION asi_task11_private.assert_coverage() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE x record; rel regclass;
BEGIN
 FOR x IN SELECT * FROM (VALUES ('public.booking_ops_records','capture_change',convert_to('booking','UTF8')||decode('00','hex')||convert_to('booking,checkout','UTF8')||decode('00','hex')),
('public.tg_guest_reservations','capture_change',convert_to('property_ref','UTF8')||decode('00','hex')||convert_to('booking,checkout','UTF8')||decode('00','hex')),
('public.booking_physical_readiness','capture_change',convert_to('booking_ref','UTF8')||decode('00','hex')||convert_to('physical','UTF8')||decode('00','hex')),
('public.booking_cleaning_tasks','capture_change',convert_to('booking_ref','UTF8')||decode('00','hex')||convert_to('cleaning,physical','UTF8')||decode('00','hex')),
('public.booking_linen_tasks','capture_change',convert_to('booking_ref','UTF8')||decode('00','hex')||convert_to('physical','UTF8')||decode('00','hex')),
('public.booking_supplies_tasks','capture_change',convert_to('booking_ref','UTF8')||decode('00','hex')||convert_to('physical','UTF8')||decode('00','hex')),
('public.booking_maintenance_tickets','capture_change',convert_to('booking_ref','UTF8')||decode('00','hex')||convert_to('physical','UTF8')||decode('00','hex')),
('public.tg_property_knowledge','capture_change',convert_to('property_ref','UTF8')||decode('00','hex')||convert_to('policy','UTF8')||decode('00','hex')),
('public.booking_guest_documents','capture_change',convert_to('booking_ref','UTF8')||decode('00','hex')||convert_to('legal','UTF8')||decode('00','hex')),
('public.booking_contracts','capture_change',convert_to('booking_ref','UTF8')||decode('00','hex')||convert_to('legal','UTF8')||decode('00','hex')),
('public.booking_deposits','capture_change',convert_to('booking_ref','UTF8')||decode('00','hex')||convert_to('legal','UTF8')||decode('00','hex')),
('public.booking_mvd_reports','capture_change',convert_to('booking_ref','UTF8')||decode('00','hex')||convert_to('legal','UTF8')||decode('00','hex')),
('public.booking_guest_legal_readiness','capture_change',convert_to('booking_ref','UTF8')||decode('00','hex')||convert_to('legal','UTF8')||decode('00','hex')),
('public.booking_instay_checkout','capture_change',convert_to('booking_ref','UTF8')||decode('00','hex')||convert_to('checkout','UTF8')||decode('00','hex')),
('public.booking_guest_stay_issues','capture_change',convert_to('booking_ref','UTF8')||decode('00','hex')||convert_to('checkout','UTF8')||decode('00','hex')),
('public.properties','capture_change',convert_to('property','UTF8')||decode('00','hex')||convert_to('booking,physical,cleaning,policy,legal,checkout','UTF8')||decode('00','hex')),
('asi_task11_private.policy_release','capture_change',convert_to('property_ref','UTF8')||decode('00','hex')||convert_to('policy','UTF8')||decode('00','hex')),
('asi_task11_private.guest_consent','capture_change',convert_to('booking_ref','UTF8')||decode('00','hex')||convert_to('legal','UTF8')||decode('00','hex')),
('public.account_members','capture_authority',''::bytea),
('public.ru_legal_acceptances','capture_authority',''::bytea),
('public.sessions','capture_authority',''::bytea),
('asi_task11_private.principals','capture_principal',''::bytea)) AS v(tbl,handler,args) LOOP
  rel:=to_regclass(x.tbl);
  IF rel IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid=rel AND relkind='r') THEN
   RAISE EXCEPTION 'task11_canonical_table_missing_or_partitioned';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=rel AND t.tgname='task11_gate'
    AND NOT t.tgisinternal AND t.tgenabled='A' AND t.tgtype=62 AND t.tgqual IS NULL
    AND t.tgargs=''::bytea AND t.tgnargs=0
    AND t.tgfoid='asi_task11_private.statement_gate()'::regprocedure)
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=rel AND t.tgname='task11_capture'
    AND NOT t.tgisinternal AND t.tgenabled='A' AND t.tgtype=31 AND t.tgqual IS NULL
    AND t.tgargs=x.args AND t.tgnargs=CASE WHEN x.handler='capture_change' THEN 2 ELSE 0 END
    AND t.tgfoid=to_regprocedure('asi_task11_private.'||x.handler||'()')) THEN
   RAISE EXCEPTION 'task11_fence_disabled_or_replaced';
  END IF;
 END LOOP;
END $fn$;
-- Only the NONLOGIN, NONBYPASS definer receives table policies.
-- No runtime LOGIN or shared service role receives an EXECUTE or table grant.
DO $policies$
DECLARE x record;
BEGIN
 FOR x IN SELECT c.oid,c.relname FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='asi_task11_private' AND c.relkind='r' LOOP
  EXECUTE format('ALTER TABLE asi_task11_private.%I ENABLE ROW LEVEL SECURITY',x.relname);
  EXECUTE format('ALTER TABLE asi_task11_private.%I FORCE ROW LEVEL SECURITY',x.relname);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=x.oid AND polname='task11_definer') THEN
   EXECUTE format('CREATE POLICY task11_definer ON asi_task11_private.%I TO strigunov_task11_owner USING (true) WITH CHECK (true)',x.relname);
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='asi_task08_private.requests'::regclass AND polname='task11_definer') THEN
  CREATE POLICY task11_definer ON asi_task08_private.requests TO strigunov_task11_owner USING(true) WITH CHECK(true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='public.ru_legal_acceptances'::regclass AND polname='task11_definer_read') THEN
  CREATE POLICY task11_definer_read ON public.ru_legal_acceptances FOR SELECT TO strigunov_task11_owner USING(true);
 END IF;
END $policies$;
REVOKE ALL ON ALL TABLES IN SCHEMA asi_task11_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA asi_task11_private FROM PUBLIC, anon, authenticated, service_role;
SELECT asi_task11_private.assert_coverage();
COMMIT;
-- Native gate remains NULL; mappings/guest consent/policy provenance remain empty.
-- Existing installation is rejected before changes: counters/epochs/tombstones cannot be reset.
-- Future role/policy overlay and all login/logout integrations need separate reviewed source.
-- Application writers using shared service_role intentionally fail; do not grant around this.
-- Rollback of an authorized install: close decision entrypoint first, retain ledgers;
-- restore reviewed prior source under a separately approved forward migration, never delete history.
