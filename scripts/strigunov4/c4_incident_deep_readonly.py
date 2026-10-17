"""Read-only deep C4 incident witness: omitted cascade dependents and physical tasks.

Never cleans, deploys, sends, creates booking or runs migration.
Only protected, owner-reviewed GitHub staging workflow has DB credentials.
"""
import json
import os
from pathlib import Path
import re
import tempfile

import c4_incident_readonly as prior
import protected_staging_g0_activation as g0
import protected_staging_sql_apply as pg

REPO = "ASI-integration/asi-landing"
WORKFLOW = REPO + "/.github/workflows/strigunov4-c4-incident-deep-readonly.yml@refs/heads/main"
INCIDENT = prior.INCIDENT_RUN
OWNER = "ASI-integration"
SHA = re.compile(r"[a-f0-9]{40}\Z")

COUNT_KEYS = (
    "bookingOpsEvents", "cleaningTasks", "linenTasks", "suppliesTasks",
    "maintenanceTickets", "physicalReadiness", "physicalCoordinationDrafts",
    "guestLifecycleEvents", "communicationDeliveries", "autoSendAttempts",
    "pristineTelegramDrafts", "nonPristineTelegramDrafts",
    "partnerAccountBindings", "partnerPropertyBindings", "partnerBookingBindings",
    "partnerCommunicationInbox", "partnerCommunicationSessions",
    "partnerCommunicationTurns", "partnerCommunicationHandoffs",
    "partnerCommunicationActions", "partnerCommunicationDecisions",
    "syntheticUserIdentity", "syntheticAccountIdentity",
    "syntheticPropertyIdentity", "syntheticBookingIdentity"
)

class Block(ValueError):
    pass

def require(condition, reason):
    if not condition:
        raise Block(reason)

def validate(env):
    pinned={
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_WORKFLOW_REF": WORKFLOW,
        "GITHUB_ACTOR": OWNER,
        "GITHUB_ACTOR_ID": "207600140",
        "GITHUB_TRIGGERING_ACTOR": OWNER,
        "GITHUB_RUN_ATTEMPT": "1",
        "STAGING_SUPABASE_PROJECT_REF": pg.PROJECT,
        "C4_INCIDENT_RUN": INCIDENT,
    }
    for key,want in pinned.items():
        require(env.get(key)==want,"CONTEXT_"+key)
    sha=env.get("GITHUB_SHA","")
    require(type(sha) is str and SHA.fullmatch(sha)
            and sha==env.get("GITHUB_WORKFLOW_SHA")
            and sha==env.get("C4_REVIEWED_MAIN_SHA"),"MAIN_SHA")
    require(env.get("C4_CONFIRM")=="DIAGNOSE_C4_INCIDENT_"+sha,"OWNER_CONFIRM")
    url=env.get("STAGING_DATABASE_URL","")
    require(type(url) is str and pg.preflight.target_valid(url),"STAGING_DB")
    return url

def read_query():
    ids=prior.OWNED
    b,a,p,u=(ids[n] for n in ("booking","account","property","user"))
    return f"""
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- Schema-only inventory. Traverse cascading foreign-key paths and report
-- non-cascading restrictions encountered at each reachable parent.
WITH RECURSIVE fk_edges AS (
    SELECT con.confrelid AS parent_oid, con.conrelid AS child_oid,
           child.relname AS relname, con.confdeltype AS action
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class child ON child.oid=con.conrelid
    JOIN pg_catalog.pg_class parent ON parent.oid=con.confrelid
    JOIN pg_catalog.pg_namespace child_ns ON child_ns.oid=child.relnamespace
    JOIN pg_catalog.pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
    WHERE con.contype='f' AND child_ns.nspname='public'
      AND parent_ns.nspname='public'
), fk_closure AS (
    SELECT e.parent_oid, e.child_oid, e.relname, e.action, 1 AS depth,
           ARRAY[e.parent_oid,e.child_oid] AS visited
    FROM fk_edges e
    JOIN pg_catalog.pg_class root ON root.oid=e.parent_oid
    JOIN pg_catalog.pg_namespace root_ns ON root_ns.oid=root.relnamespace
    WHERE root_ns.nspname='public'
      AND root.relname IN ('users','accounts','properties','booking_ops_records',
          'booking_ops_communication_intents','booking_ops_tasks')
    UNION ALL
    SELECT edge.parent_oid, edge.child_oid, edge.relname, edge.action,
           f.depth+1, f.visited || edge.child_oid
    FROM fk_closure f
    JOIN fk_edges edge ON edge.parent_oid=f.child_oid
    WHERE f.action='c' AND f.depth<10
      AND NOT (edge.child_oid=ANY(f.visited))
)
SELECT jsonb_build_object(
  'incidentRun','{INCIDENT}',
  'bookingOpsEvents',(SELECT count(*) FROM public.booking_ops_events WHERE booking_ops_record_id::text='{b}'),
  'cleaningTasks',(SELECT count(*) FROM public.booking_cleaning_tasks WHERE booking_id::text='{b}'),
  'linenTasks',(SELECT count(*) FROM public.booking_linen_tasks WHERE booking_id::text='{b}'),
  'suppliesTasks',(SELECT count(*) FROM public.booking_supplies_tasks WHERE booking_id::text='{b}'),
  'maintenanceTickets',(SELECT count(*) FROM public.booking_maintenance_tickets WHERE booking_id::text='{b}'),
  'physicalReadiness',(SELECT count(*) FROM public.booking_physical_readiness WHERE booking_id::text='{b}'),
  'physicalCoordinationDrafts',(SELECT count(*) FROM public.booking_physical_coordination_drafts WHERE booking_id::text='{b}'),
  'guestLifecycleEvents',(SELECT count(*) FROM public.guest_lifecycle_events WHERE booking_ops_record_id::text='{b}'),
  'communicationDeliveries',(SELECT count(*) FROM public.booking_ops_communication_deliveries d JOIN public.booking_ops_communication_intents i ON i.id=d.communication_intent_id WHERE i.booking_ops_record_id::text='{b}'),
  'autoSendAttempts',(SELECT count(*) FROM public.booking_ops_communication_auto_send_attempts s JOIN public.booking_ops_communication_intents i ON i.id=s.communication_intent_id WHERE i.booking_ops_record_id::text='{b}'),
  'pristineTelegramDrafts',(SELECT count(*) FROM public.booking_ops_telegram_drafts WHERE booking_ops_record_id::text='{b}' AND status='draft' AND telegram_chat_id IS NULL AND nullif(btrim(telegram_target),'') IS NULL),
  'nonPristineTelegramDrafts',(SELECT count(*) FROM public.booking_ops_telegram_drafts WHERE booking_ops_record_id::text='{b}' AND NOT (status='draft' AND telegram_chat_id IS NULL AND nullif(btrim(telegram_target),'') IS NULL)),
  'partnerAccountBindings',(SELECT count(*) FROM public.partner_account_bindings WHERE account_id::text='{a}'),
  'partnerPropertyBindings',(SELECT count(*) FROM public.partner_property_bindings WHERE account_id::text='{a}' OR property_id::text='{p}'),
  'partnerBookingBindings',(SELECT count(*) FROM public.partner_booking_bindings WHERE account_id::text='{a}' OR booking_ops_record_id::text='{b}'),
  'partnerCommunicationInbox',(SELECT count(*) FROM public.partner_communication_inbox WHERE account_id::text='{a}'),
  'partnerCommunicationSessions',(SELECT count(*) FROM public.partner_communication_sessions WHERE account_id::text='{a}'),
  'partnerCommunicationTurns',(SELECT count(*) FROM public.partner_communication_turns WHERE account_id::text='{a}'),
  'partnerCommunicationHandoffs',(SELECT count(*) FROM public.partner_communication_handoffs WHERE account_id::text='{a}'),
  'partnerCommunicationActions',(SELECT count(*) FROM public.partner_communication_actions WHERE account_id::text='{a}'),
  'partnerCommunicationDecisions',(SELECT count(*) FROM public.partner_communication_decisions WHERE account_id::text='{a}'),
  'syntheticUserIdentity',(SELECT count(*) FROM public.users WHERE id::text='{u}' AND email='staging-acceptance@asi.local'),
  'syntheticAccountIdentity',(SELECT count(*) FROM public.accounts WHERE id::text='{a}' AND name='C4 staging isolated account {INCIDENT}'),
  'syntheticPropertyIdentity',(SELECT count(*) FROM public.properties WHERE id::text='{p}' AND account_id::text='{a}' AND name='C4 isolated property {INCIDENT}'),
  'syntheticBookingIdentity',(SELECT count(*) FROM public.booking_ops_records WHERE id::text='{b}' AND account_id::text='{a}' AND property_id::text='{p}' AND guest_name='C4 synthetic guest {INCIDENT}'),
  'cascadeChildTables',(
      SELECT coalesce(jsonb_agg(DISTINCT relname) FILTER (WHERE action='c'),
                      '[]'::jsonb) FROM fk_closure
  ),
  'blockingFkChildTables',(
      SELECT coalesce(jsonb_agg(DISTINCT relname)
                      FILTER (WHERE action IN ('a','r')),
                      '[]'::jsonb) FROM fk_closure
  ),
  'setNullOrDefaultChildTables',(
      SELECT coalesce(jsonb_agg(DISTINCT relname)
                      FILTER (WHERE action IN ('n','d')),
                      '[]'::jsonb) FROM fk_closure
  )
)::text;
COMMIT;"""

def gated(stage,fn):
    require(stage in ("CHECKOUT","HISTORY","DEEP_CENSUS"),"STAGE")
    try:
        return fn()
    except (g0.Gate,pg.Gate) as e:
        candidate=e.args[0] if e.args else None
        safe=candidate if type(candidate) is str and re.fullmatch(
            r"[A-Z][A-Z0-9_]{0,60}",candidate) else "FAILED"
        raise Block(stage+"_"+safe) from None

def run(env):
    url=validate(env)
    got=gated("CHECKOUT",lambda:g0.checked([
        "git","-C",str(g0.ROOT),"rev-parse","HEAD"
    ])).stdout.decode("ascii","strict").strip()
    require(got==env["GITHUB_SHA"],"SOURCE_DRIFT")
    gated("HISTORY",lambda:g0.exact_sql_history(url))
    with tempfile.TemporaryDirectory(prefix="c4-deep-readonly-") as dirname:
        temp=Path(dirname);temp.chmod(0o700)
        ca=temp/"roots.pem"
        ca.write_bytes(Path("/etc/ssl/certs/ca-certificates.crt").read_bytes()+
                       b"\n"+g0.tls_guard.ca_bytes())
        ca.chmod(0o600)
        db_env=pg.db_environment(url,ca,True)
        require("default_transaction_read_only=on" in db_env["PGOPTIONS"],
                "READ_ONLY_REQUIRED")
        cmd=pg.postgres_client_command(temp,"postcheck")
        require(cmd[-2]=="-c","PSQL_COMMAND_SHAPE")
        cmd[-1]=read_query()
        raw=gated("DEEP_CENSUS",lambda:g0.checked(
            cmd,env=db_env,timeout=90)).stdout.decode("utf8","strict")
    rows=[line.strip() for line in raw.splitlines() if line.lstrip().startswith("{")]
    require(len(rows)==1,"RECEIPT_FORMAT")
    obj=json.loads(rows[0])
    require(type(obj) is dict and obj.get("incidentRun")==INCIDENT,
            "RECEIPT_IDENTITY")
    require(all(type(obj.get(key)) is int and 0<=obj[key]<=10000
                for key in COUNT_KEYS),"RECEIPT_COUNTS")
    for key in ("cascadeChildTables","blockingFkChildTables",
                "setNullOrDefaultChildTables"):
        items=obj.get(key)
        require(type(items) is list and len(items)<=150 and
                all(type(t) is str and re.fullmatch(r"[a-z0-9_]{1,75}",t)
                    for t in items),"FK_SCHEMA_SHAPE_"+key.upper())
    return {
        "status":"C4_DEEP_READONLY_DIAG_PASS",
        "incidentRun":INCIDENT,
        "counts":{key:obj[key] for key in COUNT_KEYS},
        "cascadeChildTables":sorted(set(obj["cascadeChildTables"])),
        "blockingFkChildTables":sorted(set(obj["blockingFkChildTables"])),
        "setNullOrDefaultChildTables":sorted(set(obj["setNullOrDefaultChildTables"])),
        "stagingWrites":False,
        "cleanupAttempted":False,
        "externalEffectsIndependentlyProven":False,
        "physicalReplayAuthorized":False
    }

def main():
    try:
        print(json.dumps(run(os.environ),sort_keys=True))
        return 0
    except Exception as error:
        c=str(error) if type(error) is Block else "UNEXPECTED_ERROR"
        c=c if re.fullmatch(r"[A-Z][A-Z0-9_]{0,95}",c) else "UNKNOWN_ERROR"
        print(json.dumps({"status":"BLOCK","blockCode":c,
                         "stagingWrites":False,"cleanupAttempted":False,
                         "physicalReplayAuthorized":False},sort_keys=True))
        return 2

if __name__=="__main__":
    raise SystemExit(main())
