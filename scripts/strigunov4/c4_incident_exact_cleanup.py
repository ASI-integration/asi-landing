"""Protected exact-ID PostgreSQL cleanup for C4 failed run 39047710115.

An independent source review, protected main owner dispatch and GitHub staging
environment reviewer approval are required. No run on laptops or PR CI.
This script does not install G0, migrate, send messages or touch production.
"""
import json
import os
from pathlib import Path
import re
import tempfile

import c4_incident_readonly as audit
import c4_staging_readonly_probe as stage
import protected_staging_g0_activation as g0
import protected_staging_sql_apply as pg

REPO="ASI-integration/asi-landing"
WORKFLOW=REPO+"/.github/workflows/strigunov4-c4-incident-cleanup.yml@refs/heads/main"
SHA40=re.compile(r"[0-9a-f]{40}\Z")
INCIDENT="39047710115"
EXPECTED={
    "users":1,"accounts":1,"properties":1,"accountMembers":1,
    "bookingExact":1,"bookingOwnedScope":1,"bookingTasks":6,
    "communicationIntents":6,"conflictChecks":2,"holds":0,
    "intakeExact":0,"intakeOwnedScope":0,"telegramDrafts":1,
}
COUNTS=set(EXPECTED)
OUTPUT={"incidentRun":INCIDENT,"stagingWrites":False,
        "physicalReplayAuthorized":False,"externalEffectsIndependentlyProven":False}

class Block(ValueError):
    pass

def require(ok,code):
    if not ok:
        raise Block(code)

def validate(env):
    guards={
      "GITHUB_ACTIONS":"true",
      "GITHUB_REPOSITORY":REPO,
      "GITHUB_EVENT_NAME":"workflow_dispatch",
      "GITHUB_REF":"refs/heads/main",
      "GITHUB_WORKFLOW_REF":WORKFLOW,
      "GITHUB_ACTOR":"ASI-integration",
      "GITHUB_ACTOR_ID":"207600140",
      "GITHUB_TRIGGERING_ACTOR":"ASI-integration",
      "GITHUB_RUN_ATTEMPT":"1",
      "STAGING_SUPABASE_PROJECT_REF":pg.PROJECT,
      "STAGING_SSH_USER":"project_ayfaar",
      "C4_INCIDENT_RUN":INCIDENT,
    }
    for k,v in guards.items():
        require(env.get(k)==v,"CONTEXT_"+k)
    sha=env.get("GITHUB_SHA","")
    require(type(sha) is str and SHA40.fullmatch(sha)
            and env.get("GITHUB_WORKFLOW_SHA")==sha
            and env.get("C4_REVIEWED_MAIN_SHA")==sha,"MAIN_SHA")
    require(env.get("C4_CONFIRM")=="CLEAN_C4_INCIDENT_"+sha,"CONFIRM")
    url=env.get("STAGING_DATABASE_URL","")
    require(type(url) is str and pg.preflight.target_valid(url),"DB_SCOPE")
    host=env.get("STAGING_SSH_HOST","")
    require(type(host) is str and
            re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}",host),"SSH_HOST")
    try: port=int(env.get("STAGING_SSH_PORT") or "22")
    except (TypeError,ValueError): raise Block("SSH_PORT") from None
    require(1<=port<=65535,"SSH_PORT")
    key=env.get("STAGING_SSH_PRIVATE_KEY","")
    require(type(key) is str and len(key)>100,"SSH_SECRET")
    return url,host,port

def cleanup_sql():
    u= audit.OWNED["user"]
    a= audit.OWNED["account"]
    p= audit.OWNED["property"]
    b= audit.OWNED["booking"]
    i= audit.OWNED["intake"]
    expected_name="C4 synthetic guest "+INCIDENT
    # One transaction; every row count verified before, during, after.
    # Any error aborts and rolls back the complete cleanup. No blind retry.
    return f"""
\\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE;
SET LOCAL statement_timeout='65000ms';
SET LOCAL lock_timeout='5000ms';
SELECT pg_advisory_xact_lock(hashtextextended('ASI-C4-INCIDENT-{INCIDENT}',7411));
DO $c4pre$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.users
    WHERE id::text='{u}' AND email='staging-acceptance@asi.local';
  IF n<>1 THEN RAISE EXCEPTION 'C4_PRE_USERS'; END IF;
  SELECT count(*) INTO n FROM public.users WHERE id::text='{u}';
  IF n<>1 THEN RAISE EXCEPTION 'C4_PRE_USERS_ID'; END IF;
  SELECT count(*) INTO n FROM public.accounts
    WHERE id::text='{a}' AND name='C4 staging isolated account {INCIDENT}';
  IF n<>1 THEN RAISE EXCEPTION 'C4_PRE_ACCOUNT'; END IF;
  SELECT count(*) INTO n FROM public.properties
    WHERE id::text='{p}' AND account_id::text='{a}'
      AND name='C4 isolated property {INCIDENT}';
  IF n<>1 THEN RAISE EXCEPTION 'C4_PRE_PROPERTY'; END IF;
  SELECT count(*) INTO n FROM public.account_members
    WHERE user_id::text='{u}' AND account_id::text='{a}';
  IF n<>1 THEN RAISE EXCEPTION 'C4_PRE_MEMBERSHIP'; END IF;
  SELECT count(*) INTO n FROM public.account_members
    WHERE account_id::text='{a}';
  IF n<>1 THEN RAISE EXCEPTION 'C4_OTHER_MEMBERS'; END IF;
  SELECT count(*) INTO n FROM public.booking_ops_records
    WHERE id::text='{b}' AND account_id::text='{a}'
      AND property_id::text='{p}' AND guest_name='{expected_name}';
  IF n<>1 THEN RAISE EXCEPTION 'C4_PRE_BOOKING'; END IF;
  SELECT count(*) INTO n FROM public.booking_ops_records
    WHERE account_id::text='{a}' OR property_id::text='{p}';
  IF n<>1 THEN RAISE EXCEPTION 'C4_BOOKING_SCOPE_DRIFT'; END IF;
  SELECT count(*) INTO n FROM public.booking_inbound_intake_events
    WHERE id::text='{i}' OR account_id::text='{a}';
  IF n<>0 THEN RAISE EXCEPTION 'C4_PRE_INTAKE_CHANGED'; END IF;
  SELECT count(*) INTO n FROM public.booking_ops_tasks
    WHERE booking_ops_record_id::text='{b}';
  IF n<>6 THEN RAISE EXCEPTION 'C4_PRE_TASKS_CHANGED'; END IF;
  SELECT count(*) INTO n FROM public.booking_ops_communication_intents
    WHERE booking_ops_record_id::text='{b}';
  IF n<>6 THEN RAISE EXCEPTION 'C4_PRE_INTENTS_CHANGED'; END IF;
  SELECT count(*) INTO n FROM public.booking_ops_communication_intents
    WHERE booking_ops_record_id::text='{b}' AND status IN ('sent','sending');
  IF n<>0 THEN RAISE EXCEPTION 'C4_SENT_INTENT_WITNESS'; END IF;
  SELECT count(*) INTO n FROM public.booking_ops_telegram_drafts
    WHERE booking_ops_record_id::text='{b}';
  IF n<>1 THEN RAISE EXCEPTION 'C4_PRE_DRAFT_CHANGED'; END IF;
  SELECT count(*) INTO n FROM public.booking_availability_holds
    WHERE booking_id::text='{b}'
      OR (account_id::text='{a}' AND property_id::text='{p}');
  IF n<>0 THEN RAISE EXCEPTION 'C4_HOLDS_CHANGED'; END IF;
  SELECT count(*) INTO n FROM public.booking_overbooking_conflict_checks
    WHERE booking_id::text='{b}'
      OR (account_id::text='{a}' AND property_id::text='{p}');
  IF n<>2 THEN RAISE EXCEPTION 'C4_PRE_CONFLICTS_CHANGED'; END IF;
  SELECT count(*) INTO n FROM public.booking_overbooking_conflict_checks
    WHERE (booking_id::text='{b}'
       OR (account_id::text='{a}' AND property_id::text='{p}'))
      AND (account_id::text IS DISTINCT FROM '{a}'
       OR property_id::text IS DISTINCT FROM '{p}');
  IF n<>0 THEN RAISE EXCEPTION 'C4_CONFLICT_FOREIGN_SCOPE'; END IF;
END $c4pre$;

DO $c4cleanup$
DECLARE n bigint;
BEGIN
  DELETE FROM public.booking_overbooking_conflict_checks
    WHERE booking_id::text='{b}' AND account_id::text='{a}'
      AND property_id::text='{p}';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>2 THEN RAISE EXCEPTION 'C4_CONFLICT_DELETE_COUNT'; END IF;

  DELETE FROM public.booking_ops_communication_intents
    WHERE booking_ops_record_id::text='{b}';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>6 THEN RAISE EXCEPTION 'C4_INTENT_DELETE_COUNT'; END IF;
  DELETE FROM public.booking_ops_tasks
    WHERE booking_ops_record_id::text='{b}';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>6 THEN RAISE EXCEPTION 'C4_TASK_DELETE_COUNT'; END IF;
  DELETE FROM public.booking_ops_telegram_drafts
    WHERE booking_ops_record_id::text='{b}';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'C4_DRAFT_DELETE_COUNT'; END IF;

  DELETE FROM public.booking_ops_records
    WHERE id::text='{b}' AND account_id::text='{a}' AND property_id::text='{p}';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'C4_BOOKING_DELETE_COUNT'; END IF;

  DELETE FROM public.properties
    WHERE id::text='{p}' AND account_id::text='{a}';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'C4_PROPERTY_DELETE_COUNT'; END IF;
  DELETE FROM public.account_members
    WHERE user_id::text='{u}' AND account_id::text='{a}';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'C4_MEMBER_DELETE_COUNT'; END IF;
  DELETE FROM public.accounts WHERE id::text='{a}';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'C4_ACCOUNT_DELETE_COUNT'; END IF;
  DELETE FROM public.users WHERE id::text='{u}'
    AND email='staging-acceptance@asi.local';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'C4_USER_DELETE_COUNT'; END IF;
END $c4cleanup$;
DO $c4verify$
DECLARE n bigint;
BEGIN
  SELECT (
    (SELECT count(*) FROM public.users WHERE id::text='{u}')
    +(SELECT count(*) FROM public.accounts WHERE id::text='{a}')
    +(SELECT count(*) FROM public.properties WHERE id::text='{p}')
    +(SELECT count(*) FROM public.account_members
         WHERE account_id::text='{a}' OR user_id::text='{u}')
    +(SELECT count(*) FROM public.booking_ops_records
         WHERE id::text='{b}' OR account_id::text='{a}'
            OR property_id::text='{p}')
    +(SELECT count(*) FROM public.booking_inbound_intake_events
         WHERE id::text='{i}' OR account_id::text='{a}')
    +(SELECT count(*) FROM public.booking_availability_holds
         WHERE booking_id::text='{b}'
            OR (account_id::text='{a}' AND property_id::text='{p}'))
    +(SELECT count(*) FROM public.booking_overbooking_conflict_checks
         WHERE booking_id::text='{b}'
            OR (account_id::text='{a}' AND property_id::text='{p}'))
    +(SELECT count(*) FROM public.booking_ops_tasks
         WHERE booking_ops_record_id::text='{b}')
    +(SELECT count(*) FROM public.booking_ops_communication_intents
         WHERE booking_ops_record_id::text='{b}')
    +(SELECT count(*) FROM public.booking_ops_telegram_drafts
         WHERE booking_ops_record_id::text='{b}')
  ) INTO n;
  IF n<>0 THEN RAISE EXCEPTION 'C4_RESIDUE_ROLLBACK'; END IF;
END $c4verify$;
COMMIT;
"""

def query_counts(db_url,cert,folder):
    db_env=pg.db_environment(db_url,cert,True)
    require("default_transaction_read_only=on" in db_env.get("PGOPTIONS",""),
            "READONLY_REQUIRED")
    cmd=pg.postgres_client_command(folder,"postcheck")
    require(cmd[-2]=="-c","PSQL_COMMAND_SHAPE")
    cmd[-1]=audit.sql_query()
    result=g0.checked(cmd,env=db_env,timeout=90).stdout.decode("utf-8","strict")
    lines=[l.strip() for l in result.splitlines() if l.strip().startswith("{")]
    require(len(lines)==1,"COUNT_RECEIPT_SHAPE")
    data=json.loads(lines[0])
    require(type(data) is dict and data.get("incidentRun")==INCIDENT,"COUNT_SOURCE")
    require(set(EXPECTED).issubset(data),"COUNT_FIELDS")
    require(all(type(data[k]) is int and 0<=data[k]<=1000 for k in EXPECTED),
            "COUNT_TYPES")
    return {k:data[k] for k in EXPECTED}

def run(env):
    url,host,port=validate(env)
    current=g0.checked(["git","-C",str(g0.ROOT),"rev-parse","HEAD"]).stdout.decode("ascii").strip()
    require(current==env["GITHUB_SHA"],"CHECKOUT")
    # Both checks are independently pinned and have passed in prior reviewed runs.
    g0.exact_sql_history(url)
    report=stage.probe(env,host,port)
    require(type(report) is dict
            and report.get("status")=="C4_READONLY_PREFLIGHT_PASS"
            and report.get("fullE2E")=="NOT_RUN","STAGE_PREFLIGHT")
    with tempfile.TemporaryDirectory(prefix="c4-incident-cleanup-") as name:
        folder=Path(name);folder.chmod(0o700)
        cert=folder/"roots.pem"
        cert.write_bytes(Path("/etc/ssl/certs/ca-certificates.crt").read_bytes()
                        + b"\n"+g0.tls_guard.ca_bytes())
        cert.chmod(0o600)
        env_clean={k:os.environ[k] for k in ("PATH","HOME","LANG","LC_ALL") if k in os.environ}
        g0.checked(["docker","pull",pg.PG_IMAGE],env=env_clean,timeout=180)
        before=query_counts(url,cert,folder)
        require(before==EXPECTED,"FIXTURE_CENSUS_DRIFT")
        sql=cleanup_sql()
        require(sql.count("BEGIN TRANSACTION")==1 and sql.count("COMMIT;")==1,
                "TRANSACTION_SOURCE")
        file=folder/"incident.sql";file.write_text(sql,"utf8");file.chmod(0o600)
        db_env=pg.db_environment(url,cert,False)
        require("default_transaction_read_only=off" in db_env.get("PGOPTIONS",""),
                "WRITER_CONFIGURATION")
        cmd=pg.postgres_client_command(folder,"postcheck")
        require(cmd[-2]=="-c","CLIENT_COMMAND")
        cmd[-2:]=["--file","/work/incident.sql"]
        # On failure, fail closed; DO block raises and transaction rolls back.
        try:
            g0.checked(cmd,env=db_env,timeout=90)
        except Exception:
            raise Block("WRITE_UNCERTAIN_RECONCILE_BEFORE_RETRY") from None
        # New connection, after COMMIT; absence of rows must be proven.
        try:
            after=query_counts(url,cert,folder)
        except Exception:
            raise Block("POSTCOMMIT_COUNTS_UNKNOWN") from None
        require(all(v==0 for v in after.values()),"POSTCOMMIT_RESIDUE")
    try:
        post=stage.probe(env,host,port)
        require(type(post) is dict
                and post.get("status")=="C4_READONLY_PREFLIGHT_PASS"
                and post.get("fullE2E")=="NOT_RUN","STAGE_POSTFLIGHT")
    except Exception:
        raise Block("STAGE_POSTFLIGHT_UNKNOWN") from None
    return {**OUTPUT,"status":"C4_INCIDENT_EXACT_CLEANUP_PASS",
            "stagingWrites":True,"knownFixtureCountsZero":True,
            "postflightG0":"PASS","incidentRun":INCIDENT}

def main():
    try:
        print(json.dumps(run(os.environ),sort_keys=True))
        return 0
    except Exception:
        print(json.dumps({**OUTPUT,"status":"BLOCK",
            "reason":"NO_AUTORETRY_INSPECT_PROTECTED_LOGS",
            "knownFixtureCountsZero":"NOT_PROVEN"},sort_keys=True))
        return 2

if __name__=="__main__":
    raise SystemExit(main())
