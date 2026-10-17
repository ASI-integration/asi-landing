"""One incident-only, protected, read-only reconciliation of C4 staging fixture.

No cleanup, delete, retry, SSH, mutation, migration or external send.
This is not permission to repeat the physical test. The staging environment
reviewer gate and pinned PG17 verify-full URL are the only admission path.
"""
import json
import os
from pathlib import Path
import re
import tempfile

import protected_staging_g0_activation as g0
import protected_staging_sql_apply as pg
import tls_guard

REPO = "ASI-integration/asi-landing"
WORKFLOW = REPO + "/.github/workflows/strigunov4-c4-incident-readonly.yml@refs/heads/main"
HEAD = re.compile(r"[a-f0-9]{40}\Z")
PROJECT = "meeravcldnmocjtlqoeu"
INCIDENT_RUN = "39047710115"
OWNED = {
    "user": "902da8af-c0e3-4ffe-b255-864ea97777fc",
    "account": "ae88a5ff-83b7-4ecf-9650-711898f25a82",
    "property": "b338d1e2-1b4a-43fe-b259-45f455dab3b5",
    "booking": "c771e4f0-95d0-4c36-a3fc-ea8bbf7a49c1",
    "intake": "216425fa-7552-4449-b21e-8d011ad687a9",
}

class Block(ValueError):
    pass

def require(condition, code):
    if not condition:
        raise Block(code)

def validate(env):
    required = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_WORKFLOW_REF": WORKFLOW,
        "GITHUB_ACTOR": "ASI-integration",
        "GITHUB_ACTOR_ID": "207600140",
        "GITHUB_TRIGGERING_ACTOR": "ASI-integration",
        "GITHUB_RUN_ATTEMPT": "1",
        "STAGING_SUPABASE_PROJECT_REF": PROJECT,
        "C4_INCIDENT_RUN": INCIDENT_RUN,
    }
    for key,expected in required.items():
        require(env.get(key)==expected,"CONTEXT_"+key)
    sha=env.get("GITHUB_SHA","")
    require(type(sha) is str and HEAD.fullmatch(sha)
            and env.get("GITHUB_WORKFLOW_SHA")==sha
            and env.get("C4_REVIEWED_MAIN_SHA")==sha,"MAIN_SHA")
    require(env.get("C4_CONFIRM")=="READONLY_C4_INCIDENT_"+sha,"CONFIRM")
    url=env.get("STAGING_DATABASE_URL","")
    require(type(url) is str and pg.preflight.target_valid(url),"DB_SCOPE")
    for value in OWNED.values():
        require(re.fullmatch(r"[a-f0-9-]{36}",value),"UUID_PIN")
    return url

def sql_query():
    # Only exact IDs from the immutable failed run are permitted.
    user,account,property_id,booking,intake=(OWNED[k] for k in
                            ("user","account","property","booking","intake"))
    return f"""
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object(
 'incidentRun','{INCIDENT_RUN}',
 'users',(SELECT count(*) FROM public.users WHERE id::text='{user}'),
 'accounts',(SELECT count(*) FROM public.accounts WHERE id::text='{account}'),
 'properties',(SELECT count(*) FROM public.properties WHERE id::text='{property_id}' AND account_id::text='{account}'),
 'accountMembers',(SELECT count(*) FROM public.account_members WHERE user_id::text='{user}' AND account_id::text='{account}'),
 'bookingExact',(SELECT count(*) FROM public.booking_ops_records WHERE id::text='{booking}' AND account_id::text='{account}' AND property_id::text='{property_id}'),
 'bookingOwnedScope',(SELECT count(*) FROM public.booking_ops_records WHERE account_id::text='{account}' AND property_id::text='{property_id}'),
 'intakeExact',(SELECT count(*) FROM public.booking_inbound_intake_events WHERE id::text='{intake}' AND account_id::text='{account}'),
 'intakeOwnedScope',(SELECT count(*) FROM public.booking_inbound_intake_events WHERE account_id::text='{account}'),
 'holds',(SELECT count(*) FROM public.booking_availability_holds WHERE booking_id::text='{booking}' OR (account_id::text='{account}' AND property_id::text='{property_id}')),
 'conflictChecks',(SELECT count(*) FROM public.booking_overbooking_conflict_checks WHERE booking_id::text='{booking}' OR (account_id::text='{account}' AND property_id::text='{property_id}')),
 'communicationIntents',(SELECT count(*) FROM public.booking_ops_communication_intents WHERE booking_ops_record_id::text='{booking}'),
 'bookingTasks',(SELECT count(*) FROM public.booking_ops_tasks WHERE booking_ops_record_id::text='{booking}'),
 'telegramDrafts',(SELECT count(*) FROM public.booking_ops_telegram_drafts WHERE booking_ops_record_id::text='{booking}')
)::text;
COMMIT;"""

def reconcile(env):
    url=validate(env)
    checkout=g0.checked(["git","-C",str(g0.ROOT),"rev-parse","HEAD"]).stdout.decode("ascii").strip()
    require(checkout==env["GITHUB_SHA"],"CHECKOUT")
    # Existing strict Supabase PG17, TLS verify-full, nine-migration check.
    g0.exact_sql_history(url)
    with tempfile.TemporaryDirectory(prefix="c4-incident-readonly-") as dirname:
        folder=Path(dirname)
        folder.chmod(0o700)
        cert=folder/"roots.pem"
        cert.write_bytes(Path("/etc/ssl/certs/ca-certificates.crt").read_bytes()
                         + b"\n" + g0.tls_guard.ca_bytes())
        cert.chmod(0o600)
        db_env=pg.db_environment(url,cert,True)
        # PGOPTIONS forces default_transaction_read_only=on. No writes permitted.
        require("default_transaction_read_only=on" in db_env["PGOPTIONS"],
                "NOT_READ_ONLY")
        cmd=pg.postgres_client_command(folder,"postcheck")
        require(cmd[-2]=="-c","EXPECTED_SELECT_ONLY_COMMAND")
        cmd[-1]=sql_query()
        output=g0.checked(cmd,env=db_env,timeout=90).stdout.decode("utf-8","strict")
    lines=[l.strip() for l in output.splitlines() if l.strip().startswith("{")]
    require(len(lines)==1,"READ_RECEIPT_SHAPE")
    data=json.loads(lines[0])
    required={"users","accounts","properties","accountMembers",
        "bookingExact","bookingOwnedScope","intakeExact","intakeOwnedScope",
        "holds","conflictChecks","communicationIntents","bookingTasks",
        "telegramDrafts"}
    require(type(data) is dict and data.get("incidentRun")==INCIDENT_RUN
            and required.issubset(data),"RECEIPT_KEYS")
    require(all(type(data[key]) is int and 0<=data[key]<=1000
                for key in required),"COUNT_VALUES")
    return {"status":"C4_INCIDENT_READONLY_AUDIT",
            "incidentRun":INCIDENT_RUN,
            "recordCounts":{k:data[k] for k in sorted(required)},
            "stagingWrites":False,
            "cleanupAuthorization":False,
            "physicalReplayAuthorized":False}

def main():
    try:
        print(json.dumps(reconcile(os.environ),sort_keys=True))
        return 0
    except Exception:
        print('{"status":"BLOCK","stagingWrites":false,"physicalReplayAuthorized":false}')
        return 2

if __name__=="__main__":
    raise SystemExit(main())
