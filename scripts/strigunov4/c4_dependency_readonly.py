"""Fixed incident-only dependency census. Never authorizes cleanup or replay."""
import base64
import json
import os
from pathlib import Path
import re
import tempfile

import c4_incident_readonly as prior

MANIFEST = json.loads(Path(__file__).with_name("c4_dependency_manifest.json").read_text())
TABLES = MANIFEST["tables"]
EDGES = MANIFEST["edges"]
ROOTS = {t: prior.OWNED[k] for t,k in (("users","user"), ("accounts","account"),
         ("properties","property"), ("booking_ops_records","booking"),
         ("booking_inbound_intake_events","intake"))}
REQUIRED = set(ROOTS) | {"booking_ops_events", "booking_cleaning_tasks",
    "booking_linen_tasks", "booking_supplies_tasks", "booking_physical_readiness"}
WORKFLOW = prior.REPO + "/.github/workflows/strigunov4-c4-dependency-readonly.yml@refs/heads/main"
Block = prior.Block
require = prior.require
OPTIONAL_TABLE = "booking_ops_communication_auto_send_scopes"
OPTIONAL_VERSION = "20260810290000"
HARDENING_VERSION = "20261006101500"
OPTIONAL_TRIGGER = ["trg_guest_lifecycle_synthetic_scope_allowlist", 23,
                    "public", "normalize_guest_lifecycle_synthetic_scope_allowlist"]


class OptionalModuleMismatch(Block):
    """Only validated aggregate facts for one fixed source module may escape."""
    def __init__(self, witness):
        self.witness = witness
        super().__init__("OPTIONAL_MODULE_HISTORY_OBJECT_DRIFT")


def optional_module_witness(data):
    """Validate exact history/object agreement without an input-controlled skip."""
    counts = {"versionRows", "hardeningRows", "functionCount", "functionMatches",
              "defaultConfigCount", "hardenedConfigCount", "triggerShapeMatches"}
    require(type(data) is dict and set(data) == counts | {"historyContract"},
            "OPTIONAL_MODULE_WITNESS_SHAPE")
    require(type(data["historyContract"]) is bool and all(
        type(data[k]) is int and 0 <= data[k] <= 1000 for k in counts),
        "OPTIONAL_MODULE_WITNESS_SHAPE")
    safe = dict(data, version=OPTIONAL_VERSION, hardeningVersion=HARDENING_VERSION,
                table=OPTIONAL_TABLE)
    absent = (data["versionRows"] == 0 and data["hardeningRows"] == 0
              and all(data[k] == 0 for k in counts - {"versionRows", "hardeningRows"}))
    deployed = (data["versionRows"] == 1 and data["hardeningRows"] in (0, 1)
                and data["functionCount"] == data["functionMatches"] == 1
                and data["triggerShapeMatches"] == 1
                and data["hardenedConfigCount"] == data["hardeningRows"]
                and data["defaultConfigCount"] == 1 - data["hardeningRows"])
    if not data["historyContract"] or not (absent or deployed):
        raise OptionalModuleMismatch(safe)
    safe["state"] = "NOT_DEPLOYED" if absent else "DEPLOYED"
    return safe


def optional_module_sql():
    """Read fixed history rows and catalog aggregates; never execute the function."""
    return """(SELECT jsonb_build_object(
 'historyContract',EXISTS(SELECT 1 FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'
   AND c.relkind='r'
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid)
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_rewrite r WHERE r.ev_class=c.oid)
   AND EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a
     JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid AND k.contype='p'
     WHERE a.attrelid=c.oid AND a.attname='version' AND a.attnotnull
     AND a.atttypid='pg_catalog.text'::regtype AND k.conkey=ARRAY[a.attnum])),
 'versionRows',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20260810290000'),
 'hardeningRows',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261006101500'),
 'functionCount',count(*),
 'functionMatches',count(*) FILTER (WHERE p.pronargs=0 AND p.prokind='f'
   AND p.prorettype='pg_catalog.trigger'::regtype AND NOT p.proretset
   AND NOT p.prosecdef AND l.lanname='plpgsql'),
 'defaultConfigCount',count(*) FILTER (WHERE p.proconfig IS NULL),
 'hardenedConfigCount',count(*) FILTER (WHERE p.proconfig=ARRAY['search_path=""']::text[]),
 'triggerShapeMatches',(SELECT count(*) FROM pg_catalog.pg_trigger t
   JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_proc f ON f.oid=t.tgfoid
   JOIN pg_catalog.pg_namespace fn ON fn.oid=f.pronamespace
   WHERE n.nspname='public' AND c.relname='booking_ops_communication_auto_send_scopes'
   AND t.tgname='trg_guest_lifecycle_synthetic_scope_allowlist'
   AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=23
   AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgconstraint=0
   AND fn.nspname='public' AND f.proname='normalize_guest_lifecycle_synthetic_scope_allowlist'
   AND f.pronargs=0
   AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
        FROM unnest(t.tgattr::smallint[]) k(num)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.num)
       =ARRAY['actual_send_enabled','allowed_message_types','dry_run_only','enabled_by']::text[])
 ) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public' AND p.proname='normalize_guest_lifecycle_synthetic_scope_allowlist')"""


class TriggerMismatch(Block):
    """Allowlisted table names and source-known expected trigger names only."""
    def __init__(self, details, module_witness=None):
        require(type(details) is list and 1 <= len(details) <= len(TABLES),
                "TRIGGER_DRIFT_SHAPE")
        for item in details:
            name=item.get("table")
            require(type(name) is str and name in TABLES
                    and type(item.get("missingExpectedTriggers")) is list
                    and all(type(n) is str and n in
                            {s[0] for s in TABLES[name]["triggers"]}
                            for n in item["missingExpectedTriggers"])
                    and type(item.get("unexpectedOrChangedCount")) is int
                    and 0 <= item["unexpectedOrChangedCount"] <= 1000
                    and type(item.get("unexpectedOrChangedCountTruncated")) is bool,
                    "TRIGGER_DRIFT_SHAPE")
        self.details=sorted(details,key=lambda x:x["table"])
        self.module_witness=module_witness
        super().__init__("TRIGGER_DRIFT")


class IncidentIdentityMismatch(Block):
    """Fixed synthetic roots only, never live row values in diagnostics."""
    CATEGORIES=("user","account","property","booking","intake")
    def __init__(self,exact,present):
        require(type(exact) is list and type(present) is list
                and len(exact)==len(present)==5
                and all(type(v) is int and v in (0,1) for v in exact+present)
                and all(x<=y for x,y in zip(exact,present)),
                "IDENTITY_RECEIPT_SHAPE")
        self.details=[{"category":n,"exact":x,"presentById":y}
                      for n,x,y in zip(self.CATEGORIES,exact,present)]
        super().__init__("INCIDENT_IDENTITY")


def ident(value):
    """Only reviewed source identifiers can be used in SQL."""
    require(type(value) is str and re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", value),
            "MANIFEST_IDENTIFIER")
    return '"' + value + '"'


def literal(value):
    """Quote a value, including the second-pass catalog comparison, as data."""
    return "'" + value.replace("'", "''") + "'"


def table(name):
    """Qualify a manifest-only relation; catalog names never choose queries."""
    require(name in TABLES, "RELATION_NOT_ALLOWED")
    return "public." + ident(name)


def key(name, alias):
    """Keep complete primary keys internal, including composite identities."""
    return "ARRAY[" + ",".join(alias+"."+ident(c)+"::text" for c in TABLES[name]["pk"]) + "]"


def catalog_sql():
    """Read metadata for the fixed inventory and every incoming FK, across schemas."""
    names = ",".join(literal(n) for n in sorted(TABLES))
    return f"""
WITH fixed AS (SELECT unnest(ARRAY[{names}]) AS name),
rels AS (
 SELECT f.name,c.oid,c.relkind,
 EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) AS inherited
 FROM fixed f LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
 LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=f.name
)
SELECT jsonb_build_object(
 'optionalModule', {optional_module_sql()},
 'tables',(SELECT jsonb_object_agg(r.name,
   CASE WHEN r.oid IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
    'kind',r.relkind,'inherited',r.inherited,
    'columns',(SELECT jsonb_object_agg(a.attname,t.typname) FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
       WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
    'pk',(SELECT jsonb_agg(a.attname ORDER BY k.ord) FROM pg_catalog.pg_constraint c
       CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
       JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
       WHERE c.conrelid=r.oid AND c.contype='p'),
    'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_array(t.tgname,t.tgtype,ns.nspname,p.proname)
       ORDER BY t.tgname),'[]'::jsonb) FROM pg_catalog.pg_trigger t
       JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
       JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace
       WHERE t.tgrelid=r.oid AND NOT t.tgisinternal),
    'rules',(SELECT count(*) FROM pg_catalog.pg_rewrite w WHERE w.ev_class=r.oid)
   ) END) FROM rels r),
 'edges',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'childSchema',cn.nspname,'child',ch.relname,'parent',r.name,
    'columns',(SELECT jsonb_agg(a.attname ORDER BY k.ord) FROM unnest(c.conkey)
      WITH ORDINALITY k(num,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num),
    'references',(SELECT jsonb_agg(a.attname ORDER BY k.ord) FROM unnest(c.confkey)
      WITH ORDINALITY k(num,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num),
    'delete',c.confdeltype,'update',c.confupdtype,'match',c.confmatchtype,
    'validated',c.convalidated,'deferrable',c.condeferrable)
    ORDER BY c.oid),'[]'::jsonb)
   FROM rels r JOIN pg_catalog.pg_constraint c ON c.confrelid=r.oid AND c.contype='f'
   JOIN pg_catalog.pg_class ch ON ch.oid=c.conrelid
   JOIN pg_catalog.pg_namespace cn ON cn.oid=ch.relnamespace)
)::text"""


def edge_signature(e):
    """Compare ordered FK columns and actions, never just table names."""
    return (e["child"], tuple(e["columns"]), e["parent"],
            tuple(e["references"]), e["delete"])


def schema_check(data):
    """Fail closed before row access on unknown or changed schema."""
    require(type(data) is dict and set(data) == {"tables", "edges", "optionalModule"}, "CATALOG_SHAPE")
    module = optional_module_witness(data["optionalModule"])
    got = data["tables"]
    require(type(got) is dict and set(got) == set(TABLES), "CATALOG_RELATIONS")
    missing = {t for t in TABLES if got[t] is None}
    require(not (missing & REQUIRED), "MISSING_REQUIRED_RELATION")
    require(module["state"] == "NOT_DEPLOYED" or OPTIONAL_TABLE not in missing,
            "OPTIONAL_MODULE_RELATION_MISSING")
    aliases = {"bigint": "int8", "integer": "int4", "int": "int4", "boolean": "bool"}
    mismatched_triggers = []
    for t in sorted(set(TABLES)-missing):
        spec, actual = TABLES[t], got[t]
        require(actual["kind"] == "r" and not actual["inherited"] and actual["rules"] == 0,
                "RELATION_KIND_OR_RULE")
        require(actual["pk"] == spec["pk"], "PRIMARY_KEY_DRIFT")
        require(all(actual["columns"].get(c) == aliases.get(typ, typ)
                    for c, typ in spec["columns"].items()), "COLUMN_TYPE_DRIFT")
        expected_triggers = spec["triggers"]
        if t == OPTIONAL_TABLE and module["state"] == "NOT_DEPLOYED":
            require(OPTIONAL_TRIGGER in expected_triggers, "OPTIONAL_MODULE_SOURCE_CONTRACT")
            expected_triggers = [sig for sig in expected_triggers if sig != OPTIONAL_TRIGGER]
        if sorted(actual["triggers"]) != sorted(expected_triggers):
            missing_expected=sorted(
                sig[0] for sig in expected_triggers if sig not in actual["triggers"])
            unexpected=sum(
                1 for sig in actual["triggers"] if sig not in expected_triggers)
            mismatched_triggers.append({
                "table":t,
                "missingExpectedTriggers":missing_expected,
                "unexpectedOrChangedCount":min(unexpected,1000),
                "unexpectedOrChangedCountTruncated":unexpected>1000
            })
    if mismatched_triggers:
        raise TriggerMismatch(mismatched_triggers, module)
    actual_edges = data["edges"]
    require(type(actual_edges) is list and len(actual_edges) <= 1000, "FK_SHAPE")
    require(all(e["childSchema"] == "public" and e["child"] in TABLES
                and e["validated"] and not e["deferrable"]
                and e["update"] == "a" and e["match"] == "s" for e in actual_edges),
            "UNKNOWN_OR_UNSAFE_FK")
    expected = {edge_signature(e) for e in EDGES
                if e["child"] not in missing and e["parent"] not in missing}
    actual = [edge_signature(e) for e in actual_edges]
    require(len(actual) == len(set(actual)) and set(actual) == expected, "FK_SCHEMA_DRIFT")
    return missing


def scope_values():
    """Fixed root values; the external booking key stays inside the database."""
    return {
        "account_id": literal(prior.OWNED["account"]),
        "property_id": literal(prior.OWNED["property"]),
        "user_id": literal(prior.OWNED["user"]),
        "booking_ops_record_id": literal(prior.OWNED["booking"]),
        "booking_id": literal(prior.OWNED["booking"]),
    }


def scopes(name, alias):
    """Map known soft ownership columns as well as declared foreign keys."""
    result = {}
    for col, value in scope_values().items():
        if col not in TABLES[name]["columns"]:
            continue
        if col == "booking_id" and TABLES[name]["columns"][col] == "text":
            value = ("(SELECT booking_id FROM public.booking_ops_records WHERE id::text="
                     + literal(prior.OWNED["booking"]) + ")")
        result[col] = (alias+"."+ident(col)+"::text", value)
    return result


def traversal(active, node="n"):
    """Compile only source-fixed joins; recursive keys never become SQL identifiers."""
    branches = []
    for e in EDGES:
        child, parent = e["child"], e["parent"]
        if child not in active or parent not in active:
            continue
        join = " AND ".join("c."+ident(c)+"=p."+ident(r)
                            for c, r in zip(e["columns"], e["references"]))
        branches.append(f"SELECT {literal(child)}::text AS t,{key(child,'c')} AS k "
                        f"FROM {table(parent)} p JOIN {table(child)} c ON {join} "
                        f"WHERE {node}.t={literal(parent)} AND {node}.k={key(parent,'p')}")
    require(bool(branches), "EMPTY_GRAPH")
    return "\nUNION ALL\n".join(branches)


def census_sql(missing):
    """Count a deduplicated finite graph, including cycles and every FK delete action."""
    require(type(missing) is set and missing <= set(TABLES), "MISSING_SCOPE")
    active = set(TABLES)-missing
    seeds = []
    for t in sorted(active):
        conditions = [f"{left}={right}" for left, right in scopes(t, "r").values()]
        if t in ROOTS:
            conditions.append(f"r.id::text={literal(ROOTS[t])}")
        if conditions:
            seeds.append(f"SELECT {literal(t)}::text t,{key(t,'r')} k FROM {table(t)} r WHERE "
                         + " OR ".join(conditions))
    counts = []
    for t in sorted(active):
        conflicts = [f"({left} IS NOT NULL AND {left} IS DISTINCT FROM {right})"
                     for left, right in scopes(t, "r").values()]
        if "account_id" in TABLES[t]["columns"]:
            conflicts.append("r.account_id IS NULL")
        if t in ROOTS:
            conflicts.append(f"r.id::text<>{literal(ROOTS[t])}")
        # Cross-links to a different parent are conflicts even when another path matched.
        for e in EDGES:
            if e["child"] != t or e["parent"] not in active:
                continue
            match = " AND ".join("r."+ident(c)+"=p."+ident(r)
                                for c, r in zip(e["columns"], e["references"]))
            nonnull = " AND ".join("r."+ident(c)+" IS NOT NULL" for c in e["columns"])
            conflicts.append(f"(({nonnull}) AND NOT EXISTS (SELECT 1 FROM "
                f"{table(e['parent'])} p JOIN nodes q ON q.t={literal(e['parent'])} "
                f"AND q.k={key(e['parent'],'p')} WHERE {match}))")
        predicate = " OR ".join(conflicts) or "FALSE"
        counts.append(f"SELECT {literal(t)} t,count(*)::bigint linked,"
                      f"count(*) FILTER(WHERE {predicate})::bigint conflicts "
                      f"FROM {table(t)} r JOIN nodes n ON n.t={literal(t)} AND n.k={key(t,'r')}")
    return """
WITH RECURSIVE graph(t,k) AS (
 (""" + "\nUNION\n".join(seeds) + """)
 UNION
 SELECT child.t,child.k FROM graph n CROSS JOIN LATERAL (
""" + traversal(active) + """
 ) child
), nodes AS MATERIALIZED (SELECT * FROM graph LIMIT 10001),
counts AS (""" + "\nUNION ALL\n".join(counts) + """)
SELECT jsonb_build_object(
 'nodeLimitExceeded',(SELECT count(*)>10000 FROM nodes),
 'counts',(SELECT jsonb_object_agg(t,jsonb_build_object(
   'incidentLinked',linked,'scopeConflicts',conflicts)) FROM counts),
 'identities',jsonb_build_array(
 (SELECT count(*) FROM public.users WHERE id::text=""" + literal(prior.OWNED["user"]) + """ AND email='staging-acceptance@asi.local'),
 (SELECT count(*) FROM public.accounts WHERE id::text=""" + literal(prior.OWNED["account"]) + """ AND name='C4 staging isolated account 39047710115'),
 (SELECT count(*) FROM public.properties WHERE id::text=""" + literal(prior.OWNED["property"]) + """ AND account_id::text=""" + literal(prior.OWNED["account"]) + """ AND name='C4 isolated property 39047710115'),
 (SELECT count(*) FROM public.booking_ops_records WHERE id::text=""" + literal(prior.OWNED["booking"]) + """ AND account_id::text=""" + literal(prior.OWNED["account"]) + """ AND property_id::text=""" + literal(prior.OWNED["property"]) + """ AND guest_name='C4 synthetic guest 39047710115'),
 (SELECT count(*) FROM public.booking_inbound_intake_events WHERE id::text=""" + literal(prior.OWNED["intake"]) + """ AND account_id::text=""" + literal(prior.OWNED["account"]) + """)),
 'identityRoots',jsonb_build_array(
 (SELECT count(*) FROM public.users WHERE id::text=""" + literal(prior.OWNED["user"]) + """),
 (SELECT count(*) FROM public.accounts WHERE id::text=""" + literal(prior.OWNED["account"]) + """),
 (SELECT count(*) FROM public.properties WHERE id::text=""" + literal(prior.OWNED["property"]) + """),
 (SELECT count(*) FROM public.booking_ops_records WHERE id::text=""" + literal(prior.OWNED["booking"]) + """),
 (SELECT count(*) FROM public.booking_inbound_intake_events WHERE id::text=""" + literal(prior.OWNED["intake"]) + """))
)::text"""


def guarded_sql(catalog, missing):
    """Lock only reviewed tables, recheck metadata in the row snapshot, then roll back."""
    locks = ",".join(table(t) for t in sorted(set(TABLES)-missing))
    encoded = base64.b64encode(json.dumps(catalog, sort_keys=True).encode()).decode("ascii")
    expected = "convert_from(decode("+literal(encoded)+",'base64'),'UTF8')"
    return ("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
            "SET LOCAL row_security=off;\nSET LOCAL statement_timeout='45s';\n"
            "SET LOCAL lock_timeout='5s';\nSET LOCAL search_path=pg_catalog,public;\n"
            f"LOCK TABLE supabase_migrations.schema_migrations,{locks} IN ACCESS SHARE MODE;\n"
            "DO $guard$ BEGIN IF (" + catalog_sql() + ")::jsonb IS DISTINCT FROM "
            + expected + "::jsonb THEN RAISE EXCEPTION 'C4_SCHEMA_RACE'; END IF; END $guard$;\n"
            + census_sql(missing) + ";\nROLLBACK;")


def receipt(data, missing):
    """Return only validated aggregate counts and static catalog identifiers."""
    require(type(data) is dict and set(data) == {"counts", "identities", "identityRoots",
                                                  "nodeLimitExceeded"},
            "RECEIPT_SHAPE")
    exact,present=data["identities"],data["identityRoots"]
    require(type(exact) is list and type(present) is list
            and len(exact)==len(present)==5
            and all(type(v) is int and v in (0,1) for v in exact+present)
            and all(x<=y for x,y in zip(exact,present)),
            "IDENTITY_RECEIPT_SHAPE")
    if exact != [1]*5:
        raise IncidentIdentityMismatch(exact,present)
    require(data["nodeLimitExceeded"] is False, "GRAPH_LIMIT")
    counts = data["counts"]
    require(type(counts) is dict and set(counts) == set(TABLES)-missing, "COUNT_RELATIONS")
    for value in counts.values():
        require(type(value) is dict and set(value) == {"incidentLinked", "scopeConflicts"}
                and all(type(n) is int and 0 <= n <= 10000 for n in value.values())
                and value["scopeConflicts"] <= value["incidentLinked"], "COUNT_SHAPE")
    conflict = any(v["scopeConflicts"] for v in counts.values())
    return {"status": "BLOCK" if conflict else "C4_DEPENDENCY_READONLY_SCOPED_PASS",
            "blockCode": "CROSS_SCOPE_ROWS" if conflict else None,
            "incidentRun": prior.INCIDENT_RUN,
            "tables": {t: counts.get(t) for t in sorted(TABLES)},
            "notDeployed": sorted(missing),
            "foreignKeys": [{"child": e["child"], "parent": e["parent"],
                            "columns": e["columns"], "references": e["references"],
                            "deleteAction": e["delete"]}
                           for e in EDGES if e["child"] not in missing and e["parent"] not in missing],
            "stagingWrites": False, "cleanupAuthorized": False,
            "physicalReplayAuthorized": False,
            "preservationPolicy": "C4_DEPENDENCY_POLICY_REQUIRED"}


def validate(env):
    """Reuse strict existing identity/TLS gates with this workflow's exact name."""
    require(env.get("GITHUB_WORKFLOW_REF") == WORKFLOW, "WORKFLOW")
    sha = env.get("GITHUB_SHA", "")
    require(env.get("C4_CONFIRM") == "PROVE_C4_DEPENDENCIES_"+sha, "CONFIRM")
    adapted = dict(env, GITHUB_WORKFLOW_REF=prior.WORKFLOW,
                   C4_CONFIRM="READONLY_C4_INCIDENT_"+sha)
    return prior.validate(adapted)


def execute(cmd, env):
    """Suppress all database error text and parse one bounded JSON response."""
    result = prior.stage_gate("CENSUS", lambda: prior.g0.checked(
        cmd, env=env, timeout=90, allow_nonzero=True))
    require(result.returncode == 0, "DEPENDENCY_QUERY_FAILED")
    require(len(result.stdout) <= 2_000_000, "RECEIPT_SIZE")
    try:
        return json.loads(result.stdout.decode("utf-8", "strict"))
    except (ValueError, UnicodeError):
        raise Block("RECEIPT_JSON") from None


def run(env):
    """Two read-only connections; second snapshot repeats the complete schema check."""
    url = validate(env)
    head = prior.stage_gate("CHECKOUT", lambda: prior.g0.checked(
        ["git", "-C", str(prior.g0.ROOT), "rev-parse", "HEAD"])).stdout.decode("ascii").strip()
    require(head == env["GITHUB_SHA"], "CHECKOUT_DRIFT")
    prior.stage_gate("HISTORY", lambda: prior.g0.exact_sql_history(url))
    with tempfile.TemporaryDirectory(prefix="c4-dependency-") as dirname:
        folder = Path(dirname)
        folder.chmod(0o700)
        cert = folder/"roots.pem"
        cert.write_bytes(Path("/etc/ssl/certs/ca-certificates.crt").read_bytes()
                         + b"\n" + prior.tls_guard.ca_bytes())
        cert.chmod(0o600)
        db_env = prior.pg.db_environment(url, cert, True)
        require("default_transaction_read_only=on" in db_env["PGOPTIONS"], "READ_ONLY_REQUIRED")
        cmd = prior.pg.postgres_client_command(folder, "postcheck")
        require(cmd[-2] == "-c", "PSQL_SHAPE")
        cmd[-2:-2] = ["-q", "--set", "VERBOSITY=sqlstate"]
        cmd[-1] = "BEGIN READ ONLY; SET LOCAL row_security=off;" + catalog_sql() + ";ROLLBACK;"
        query = folder/"dependency.sql"
        query.write_text(cmd[-1], encoding="utf-8")
        query.chmod(0o600)
        cmd[-2:] = ["--file", "/work/dependency.sql"]
        catalog = execute(cmd, db_env)
        missing = schema_check(catalog)
        query.write_text(guarded_sql(catalog, missing), encoding="utf-8")
        result = receipt(execute(cmd, db_env), missing)
        result["optionalModule"] = optional_module_witness(catalog["optionalModule"])
        return result


def main():
    """No exception, row, SQL text or untrusted catalog name escapes the output filter."""
    try:
        result = run(os.environ)
        print(json.dumps(result, sort_keys=True))
        return 2 if result["status"] == "BLOCK" else 0
    except Exception as error:
        code = str(error) if type(error) in (Block, TriggerMismatch, OptionalModuleMismatch, IncidentIdentityMismatch) else "UNEXPECTED_FAILURE"
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{0,90}", code):
            code = "UNEXPECTED_FAILURE"
        report={"status":"BLOCK","blockCode":code,
                "stagingWrites":False,"cleanupAuthorized":False,
                "physicalReplayAuthorized":False}
        if type(error) is TriggerMismatch:
            report["triggerDriftCount"]=len(error.details)
            report["triggerDriftDetails"]=error.details
            if error.module_witness is not None:
                report["optionalModule"] = error.module_witness
        if type(error) is OptionalModuleMismatch:
            report["optionalModule"] = error.witness
        if type(error) is IncidentIdentityMismatch:
            report["identityChecks"] = error.details
        print(json.dumps(report,sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
