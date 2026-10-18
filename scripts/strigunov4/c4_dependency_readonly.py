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
    require(type(data) is dict and set(data) == {"tables", "edges"}, "CATALOG_SHAPE")
    got = data["tables"]
    require(type(got) is dict and set(got) == set(TABLES), "CATALOG_RELATIONS")
    missing = {t for t in TABLES if got[t] is None}
    require(not (missing & REQUIRED), "MISSING_REQUIRED_RELATION")
    aliases = {"bigint": "int8", "integer": "int4", "int": "int4", "boolean": "bool"}
    for t in sorted(set(TABLES)-missing):
        spec, actual = TABLES[t], got[t]
        require(actual["kind"] == "r" and not actual["inherited"] and actual["rules"] == 0,
                "RELATION_KIND_OR_RULE")
        require(actual["pk"] == spec["pk"], "PRIMARY_KEY_DRIFT")
        require(all(actual["columns"].get(c) == aliases.get(typ, typ)
                    for c, typ in spec["columns"].items()), "COLUMN_TYPE_DRIFT")
        require(sorted(actual["triggers"]) == sorted(spec["triggers"]), "TRIGGER_DRIFT")
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
 (SELECT count(*) FROM public.booking_inbound_intake_events WHERE id::text=""" + literal(prior.OWNED["intake"]) + """ AND account_id::text=""" + literal(prior.OWNED["account"]) + """))
)::text"""


def guarded_sql(catalog, missing):
    """Lock only reviewed tables, recheck metadata in the row snapshot, then roll back."""
    locks = ",".join(table(t) for t in sorted(set(TABLES)-missing))
    encoded = base64.b64encode(json.dumps(catalog, sort_keys=True).encode()).decode("ascii")
    expected = "convert_from(decode("+literal(encoded)+",'base64'),'UTF8')"
    return ("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
            "SET LOCAL row_security=off;\nSET LOCAL statement_timeout='45s';\n"
            "SET LOCAL lock_timeout='5s';\nSET LOCAL search_path=pg_catalog,public;\n"
            f"LOCK TABLE {locks} IN ACCESS SHARE MODE;\n"
            "DO $guard$ BEGIN IF (" + catalog_sql() + ")::jsonb IS DISTINCT FROM "
            + expected + "::jsonb THEN RAISE EXCEPTION 'C4_SCHEMA_RACE'; END IF; END $guard$;\n"
            + census_sql(missing) + ";\nROLLBACK;")


def receipt(data, missing):
    """Return only validated aggregate counts and static catalog identifiers."""
    require(type(data) is dict and set(data) == {"counts", "identities", "nodeLimitExceeded"},
            "RECEIPT_SHAPE")
    require(data["identities"] == [1]*5 and all(type(x) is int for x in data["identities"]),
            "INCIDENT_IDENTITY")
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
        return receipt(execute(cmd, db_env), missing)


def main():
    """No exception, row, SQL text or untrusted catalog name escapes the output filter."""
    try:
        result = run(os.environ)
        print(json.dumps(result, sort_keys=True))
        return 2 if result["status"] == "BLOCK" else 0
    except Exception as error:
        code = str(error) if type(error) is Block else "UNEXPECTED_FAILURE"
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{0,90}", code):
            code = "UNEXPECTED_FAILURE"
        print(json.dumps({"status": "BLOCK", "blockCode": code,
                          "stagingWrites": False, "cleanupAuthorized": False,
                          "physicalReplayAuthorized": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
