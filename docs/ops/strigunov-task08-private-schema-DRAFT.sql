-- TASK08 EXECUTABLE-SYNTAX REVIEW CANDIDATE ONLY. NOT INSTALLED. NEVER AUTO-APPLY.
-- Outside supabase/migrations. No SQL parser/server execution performed.
-- Prerequisites for a later isolated acceptance: fixture public tables matching
-- current source; inert anon/authenticated/service_role roles, separately approved.
-- No role creation, login, credential, policy, grant or production issuer here.
BEGIN;
CREATE SCHEMA asi_task08_private;
REVOKE ALL ON SCHEMA asi_task08_private FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA asi_task08_private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA asi_task08_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE asi_task08_private.requests (
 request_id uuid PRIMARY KEY,
 version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
 row_data jsonb NOT NULL CHECK (jsonb_typeof(row_data) = 'object'),
 CHECK (row_data ?& ARRAY['accountId','propertyId','bookingOpsRecordId','sourceBookingRef','requestId','channel',
  'opaqueRecipientRef','actorUserId','policyRevision','evidenceRevisions','requestRevision','observedAt','validUntil',
  'version','status','decisionId','decisionActorId','approvalBinding']),
 CHECK ((row_data - ARRAY['accountId','propertyId','bookingOpsRecordId','sourceBookingRef','requestId','channel',
  'opaqueRecipientRef','actorUserId','policyRevision','evidenceRevisions','requestRevision','observedAt','validUntil',
  'version','status','decisionId','decisionActorId','approvalBinding']) = '{}'::jsonb),
 CHECK (row_data->>'requestId' IS NOT NULL AND (row_data->>'requestId')::uuid = request_id),
 CHECK (row_data->>'version' IS NOT NULL AND (row_data->>'version')::bigint = version),
 CHECK (row_data->>'requestRevision' IS NOT NULL AND (row_data->>'requestRevision')::bigint BETWEEN 1 AND 9007199254740991),
 CHECK (row_data->>'accountId' IS NOT NULL AND (row_data->>'accountId')::uuid IS NOT NULL),
 CHECK (row_data->>'propertyId' IS NOT NULL AND (row_data->>'propertyId')::uuid IS NOT NULL),
 CHECK (row_data->>'bookingOpsRecordId' IS NOT NULL AND (row_data->>'bookingOpsRecordId')::uuid IS NOT NULL),
 CHECK (row_data->>'actorUserId' IS NOT NULL AND (row_data->>'actorUserId')::uuid IS NOT NULL),
 CHECK (row_data->>'sourceBookingRef' IS NOT NULL AND row_data->>'sourceBookingRef' ~ '^[A-Za-z0-9_.:-]{1,128}$'),
 CHECK (row_data->>'policyRevision' IS NOT NULL AND row_data->>'policyRevision' ~ '^[A-Za-z0-9_.:-]{1,128}$'),
 CHECK (row_data->>'channel' IS NOT NULL AND row_data->>'channel' IN ('telegram','email')),
 CHECK (row_data->>'opaqueRecipientRef' IS NOT NULL AND row_data->>'opaqueRecipientRef' ~ '^rcpt_[0-9a-f]{32,64}$'),
 CHECK (row_data->>'status' IS NOT NULL AND row_data->>'status' IN ('HOLD','REVIEW_REQUIRED','APPROVED','REVOKED')),
 CHECK (jsonb_typeof(row_data->'evidenceRevisions') = 'object'
   AND row_data->'evidenceRevisions' ?& ARRAY['booking','physical','cleaning','policy','legal','checkout']
   AND ((row_data->'evidenceRevisions') - ARRAY['booking','physical','cleaning','policy','legal','checkout']) = '{}'::jsonb),
 CHECK (row_data->>'observedAt' IS NOT NULL AND row_data->>'validUntil' IS NOT NULL
  AND (row_data->>'validUntil')::timestamptz > (row_data->>'observedAt')::timestamptz
  AND (row_data->>'validUntil')::timestamptz <= (row_data->>'observedAt')::timestamptz + interval '5 minutes'),
 CHECK (row_data->>'decisionActorId' IS NULL OR row_data->>'decisionActorId' = row_data->>'actorUserId'),
 CHECK ((row_data->>'status' <> 'APPROVED' OR
   (row_data->>'decisionId' IS NOT NULL AND (row_data->>'decisionId')::uuid IS NOT NULL
    AND row_data->>'decisionActorId' = row_data->>'actorUserId'
    AND jsonb_typeof(row_data->'approvalBinding') = 'object'
    AND row_data->'approvalBinding'->>'membershipRevision' IS NOT NULL
    AND row_data->'approvalBinding'->>'ownerScopeRevision' IS NOT NULL
    AND row_data->'approvalBinding'->>'operatorRole' IN ('owner','manager'))) IS TRUE)
);
CREATE INDEX task08_request_scope ON asi_task08_private.requests
 ((row_data->>'accountId'), (row_data->>'propertyId'), (row_data->>'bookingOpsRecordId'));
-- No DELETE / UPDATE grants. Trigger preserves exact binding even if a later
-- reviewed non-bypass role is granted state transition rights.
CREATE FUNCTION asi_task08_private.guard_request() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
 mutable text[] := ARRAY['version','status','decisionId','decisionActorId','approvalBinding'];
 k text;
 payload jsonb := NEW.row_data;
 uuid_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
 token_pattern text := '^[A-Za-z0-9_.:-]{1,128}$';
BEGIN
 -- IS DISTINCT FROM / IS NOT TRUE close SQL NULL CHECK loopholes.
 FOREACH k IN ARRAY ARRAY['accountId','propertyId','bookingOpsRecordId','requestId','actorUserId'] LOOP
  IF jsonb_typeof(payload->k) IS DISTINCT FROM 'string' OR (payload->>k ~ uuid_pattern) IS NOT TRUE THEN
   RAISE EXCEPTION 'request_unavailable';
  END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['sourceBookingRef','policyRevision'] LOOP
  IF jsonb_typeof(payload->k) IS DISTINCT FROM 'string' OR (payload->>k ~ token_pattern) IS NOT TRUE THEN
   RAISE EXCEPTION 'request_unavailable';
  END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['channel','opaqueRecipientRef','status','observedAt','validUntil'] LOOP
  IF jsonb_typeof(payload->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'request_unavailable'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['version','requestRevision'] LOOP
  IF jsonb_typeof(payload->k) IS DISTINCT FROM 'number' OR (payload->>k ~ '^[1-9][0-9]*$') IS NOT TRUE THEN
   RAISE EXCEPTION 'request_unavailable';
  END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['observedAt','validUntil'] LOOP
  IF (payload->>k ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$') IS NOT TRUE THEN
   RAISE EXCEPTION 'request_unavailable';
  END IF;
 END LOOP;
 IF jsonb_typeof(payload->'evidenceRevisions') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'request_unavailable'; END IF;
 FOREACH k IN ARRAY ARRAY['booking','physical','cleaning','policy','legal','checkout'] LOOP
  IF jsonb_typeof(payload->'evidenceRevisions'->k) IS DISTINCT FROM 'string'
   OR (payload->'evidenceRevisions'->>k ~ token_pattern) IS NOT TRUE THEN RAISE EXCEPTION 'request_unavailable'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['decisionId','decisionActorId'] LOOP
  IF payload->k IS DISTINCT FROM 'null'::jsonb AND
   (jsonb_typeof(payload->k) IS DISTINCT FROM 'string' OR (payload->>k ~ uuid_pattern) IS NOT TRUE) THEN
   RAISE EXCEPTION 'request_unavailable';
  END IF;
 END LOOP;
 IF payload->'approvalBinding' IS DISTINCT FROM 'null'::jsonb THEN
  IF jsonb_typeof(payload->'approvalBinding') IS DISTINCT FROM 'object'
   OR ((payload->'approvalBinding') - ARRAY['membershipRevision','ownerScopeRevision','operatorRole']) <> '{}'::jsonb
   OR (payload->'approvalBinding' ?& ARRAY['membershipRevision','ownerScopeRevision','operatorRole']) IS NOT TRUE
   OR (payload->'approvalBinding'->>'operatorRole' IN ('owner','manager')) IS NOT TRUE THEN
   RAISE EXCEPTION 'request_unavailable';
  END IF;
  FOREACH k IN ARRAY ARRAY['membershipRevision','ownerScopeRevision'] LOOP
   IF jsonb_typeof(payload->'approvalBinding'->k) IS DISTINCT FROM 'string'
    OR (payload->'approvalBinding'->>k ~ token_pattern) IS NOT TRUE THEN RAISE EXCEPTION 'request_unavailable'; END IF;
  END LOOP;
 END IF;
 IF payload->>'status' = 'REVOKED' AND payload->'approvalBinding' IS DISTINCT FROM 'null'::jsonb THEN
  RAISE EXCEPTION 'request_unavailable';
 END IF;
 IF TG_OP = 'INSERT' THEN
  IF NEW.version <> 1 OR NEW.row_data->>'status' <> 'REVIEW_REQUIRED'
    OR NEW.row_data->'decisionId' <> 'null'::jsonb
    OR NEW.row_data->'decisionActorId' <> 'null'::jsonb
    OR NEW.row_data->'approvalBinding' <> 'null'::jsonb THEN
   RAISE EXCEPTION 'request_unavailable';
  END IF;
 ELSE
  IF NEW.request_id <> OLD.request_id
    OR (NEW.row_data - mutable) IS DISTINCT FROM (OLD.row_data - mutable)
    OR NEW.version <> OLD.version + 1
    OR OLD.row_data->>'status' = 'REVOKED'
    OR NOT ((OLD.row_data->>'status' = 'REVIEW_REQUIRED' AND NEW.row_data->>'status' IN ('APPROVED','REVOKED'))
      OR (OLD.row_data->>'status' = 'APPROVED' AND NEW.row_data->>'status' = 'REVOKED')) THEN
   RAISE EXCEPTION 'request_unavailable';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION asi_task08_private.guard_request() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER task08_guard_request BEFORE INSERT OR UPDATE ON asi_task08_private.requests
 FOR EACH ROW EXECUTE FUNCTION asi_task08_private.guard_request();

-- CLOSED AUTHORITY MODEL ONLY. This row is not proof of a login or owner approval.
-- Missing protected issuer/all-writer coverage means no usable authorization.
-- Each real membership/session/owner/policy/evidence writer must participate in
-- a reviewed canonical fence transaction. updated_at is explicitly insufficient.
CREATE TABLE asi_task08_private.candidate_fences (
 request_id uuid PRIMARY KEY,
 actor_id uuid NOT NULL,
 authority jsonb NOT NULL CHECK (jsonb_typeof(authority) = 'object'),
 CHECK (authority->>'authenticatedActorId' IS NOT NULL AND (authority->>'authenticatedActorId')::uuid = actor_id),
 CHECK (authority->'binding'->>'requestId' IS NOT NULL AND (authority->'binding'->>'requestId')::uuid = request_id)
);
ALTER TABLE asi_task08_private.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE asi_task08_private.requests FORCE ROW LEVEL SECURITY;
ALTER TABLE asi_task08_private.candidate_fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE asi_task08_private.candidate_fences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA asi_task08_private FROM PUBLIC, anon, authenticated, service_role;
COMMIT;

-- Transaction/parameter contract (executable SELECT/INSERT/CAS texts are in TS):
-- 1 BEGIN SERIALIZABLE; 2 lock candidate_fences(request_id, actor_id) FOR UPDATE;
-- 3 lock canonical booking+property FOR SHARE; 4 lock request FOR UPDATE.
-- Missing request: UNIQUE request_id arbitrates contenders; 23505/40001 => HOLD.
-- Exact canonical match: p.id=$2::uuid AND p.account_id=$1::uuid;
-- b.account_id=$1::uuid::text AND b.property_id=$2::uuid::text,
-- b.id=$3::uuid AND b.booking_id=$4::text. Never cast untrusted booking TEXT to UUID.
-- Membership/owner/session checks cannot be supplied by this canonical match.
-- Immutable bindings live in row_data; no arbitrary payload/private data allowed.
-- CAS: request_id=$1, new version=$2, exact JSON=$3, old version=$4; require one row.
-- Never overwrite on conflict. REVOKED terminal. Read repeats all authority checks.
-- All operations, including explicit reconciliation, reauthenticate before use.
-- Final guard + clock after I/O; acknowledged COMMIT only; unknown => HOLD,
-- discard connection, explicit future READ, no automatic approval retry.
-- A SERIALIZABLE reread is the same snapshot, NOT evidence of latest revisions.
-- Native approval requires protected common fences held by ALL writers through
-- commit; acknowledgement is not a reusable send capability.
-- No source currently proves this; candidate_fences is deliberately inaccessible.
-- Before native tests create separately reviewed fixture-only role/policy overlay,
-- never use superuser/BYPASSRLS to claim application RLS PASS.
-- SQL_EXECUTION NOT_RUN. TWO_CONNECTION_REAL_POSTGRES BLOCK/NOT_RUN.
