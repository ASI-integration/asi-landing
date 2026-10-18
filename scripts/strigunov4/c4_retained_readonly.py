"""Fixed retained-run reconciliation; observation is never replay permission."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile

import c4_dependency_readonly as dep
import c4_staging_readonly_probe as host_probe

RUN = "39127850376"
SOURCE_SHA = "d46986fe7fa6b3a68a0490bf9be32f34206c7e06"
WORKFLOW = dep.prior.REPO + "/.github/workflows/strigunov4-c4-retained-readonly.yml@refs/heads/main"
ROOTS = {"users": "dc194ac7-e586-4f7a-bd27-52fe743a89b7",
         "accounts": "1ed26348-32e1-4e19-ae0d-07d3658f42ab",
         "properties": "ac431190-8cdb-4dfe-be89-3f3f83e258fc"}
EMAIL = "c4-pilot-dc194ac7e5864f7abd2752fe743a89b7@asi.local"
Block = dep.Block
require = dep.require


STATES = {
    "booking_cleaning_tasks": ("pending", "assigned", "in_progress", "completed", "verified", "blocked", "cancelled"),
    "booking_linen_tasks": ("pending", "pickup_needed", "picked_up", "in_laundry", "delivered", "verified", "shortage", "blocked", "cancelled"),
    "booking_supplies_tasks": ("pending", "ready", "verified", "missing", "waived", "blocked"),
    "booking_physical_readiness": ("not_ready", "ready_for_review", "approved", "blocked"),
    "booking_inbound_intake_events": ("new", "processed", "duplicate", "needs_review", "failed"),
}


def schema_check(catalog):
    """Require typed state columns in addition to the shared dependency manifest."""
    missing = dep.schema_check(catalog)
    for name in STATES:
        require(catalog["tables"][name]["columns"].get("status") == "text", "STATE_COLUMN_DRIFT")
    require(catalog["tables"]["booking_physical_readiness"]["columns"].get("final_ready") == "bool", "STATE_COLUMN_DRIFT")
    return missing


def states_sql():
    """Count only source-allowlisted states; unknown status text never leaves SQL."""
    branches = []
    for name, states in STATES.items():
        fields = [dep.literal(state) + ",count(*) FILTER(WHERE r.status=" + dep.literal(state) + ")" for state in states]
        allowed = ",".join(dep.literal(state) for state in states)
        fields.append("'unknown',count(*) FILTER(WHERE r.status IS NULL OR r.status NOT IN (" + allowed + "))")
        if name == "booking_physical_readiness":
            fields.extend(["'finalReady',count(*) FILTER(WHERE r.final_ready IS TRUE)",
                           "'approvedAndFinalReady',count(*) FILTER(WHERE r.status='approved' AND r.final_ready IS TRUE)"])
        branches.append(f"SELECT {dep.literal(name)} t,jsonb_build_object(" + ",".join(fields) +
                        f") states FROM {dep.table(name)} r JOIN nodes n ON n.t={dep.literal(name)} AND n.k={dep.key(name,'r')}")
    return "(SELECT jsonb_object_agg(t,states) FROM (" + " UNION ALL ".join(branches) + ") s)"


def validate(env):
    """Admit one reviewed main workflow; never accept caller-selected root IDs."""
    require(env.get("GITHUB_WORKFLOW_REF") == WORKFLOW, "WORKFLOW")
    require(env.get("C4_INCIDENT_RUN") == RUN, "INCIDENT")
    sha = env.get("GITHUB_SHA", "")
    require(env.get("C4_CONFIRM") == "READONLY_C4_RETAINED_" + sha, "CONFIRM")
    return dep.prior.validate(dict(env, GITHUB_WORKFLOW_REF=dep.prior.WORKFLOW,
        C4_INCIDENT_RUN=dep.prior.INCIDENT_RUN, C4_CONFIRM="READONLY_C4_INCIDENT_" + sha))


def scopes(name, alias):
    """Compile fixed scalar roots and booking sets; data never becomes SQL text."""
    values = {"account_id": dep.literal(ROOTS["accounts"]),
              "property_id": dep.literal(ROOTS["properties"]),
              "user_id": dep.literal(ROOTS["users"])}
    pairs = []
    for col in dep.TABLES[name]["columns"]:
        left = alias + "." + dep.ident(col) + "::text"
        if col in values:
            pairs.append((left, left + "=" + values[col]))
        elif col in ("booking_ops_record_id", "booking_id"):
            key = "booking_id" if col == "booking_id" and dep.TABLES[name]["columns"][col] == "text" else "id"
            pairs.append((left, left + " IN (SELECT " + key + "::text FROM scoped_bookings)"))
    return pairs


def census_sql(missing):
    """Observe incomplete roots and their finite dependency graph in one snapshot."""
    require(type(missing) is set and missing <= set(dep.TABLES), "MISSING_SCOPE")
    active = set(dep.TABLES) - missing
    seeds, counts = [], []
    for name in sorted(active):
        matches = [match for _, match in scopes(name, "r")]
        if name in ROOTS:
            matches.append("r.id::text=" + dep.literal(ROOTS[name]))
        if matches:
            seeds.append(f"SELECT {dep.literal(name)}::text t,{dep.key(name,'r')} k "
                         f"FROM {dep.table(name)} r WHERE " + " OR ".join(matches))
        conflicts = [f"({left} IS NOT NULL AND NOT coalesce(({match}),false))"
                     for left, match in scopes(name, "r")]
        if "account_id" in dep.TABLES[name]["columns"]:
            conflicts.append("r.account_id IS NULL")
        if name in ROOTS:
            conflicts.append("r.id::text<>" + dep.literal(ROOTS[name]))
        if name == "booking_ops_records":
            conflicts.append("r.guest_name IS DISTINCT FROM " + dep.literal("C4 synthetic guest " + RUN))
        for edge in dep.EDGES:
            if edge["child"] != name or edge["parent"] not in active:
                continue
            match = " AND ".join("r."+dep.ident(c)+"=p."+dep.ident(ref)
                                for c, ref in zip(edge["columns"], edge["references"]))
            nonnull = " AND ".join("r."+dep.ident(c)+" IS NOT NULL" for c in edge["columns"])
            conflicts.append(f"(({nonnull}) AND NOT EXISTS (SELECT 1 FROM "
                f"{dep.table(edge['parent'])} p JOIN nodes q ON q.t={dep.literal(edge['parent'])} "
                f"AND q.k={dep.key(edge['parent'],'p')} WHERE {match}))")
        predicate = " OR ".join(conflicts) or "FALSE"
        counts.append(f"SELECT {dep.literal(name)} t,count(*)::bigint linked,"
                      f"count(*) FILTER(WHERE {predicate})::bigint conflicts "
                      f"FROM {dep.table(name)} r JOIN nodes n ON n.t={dep.literal(name)} "
                      f"AND n.k={dep.key(name,'r')}")
    u, a, p = (dep.literal(ROOTS[t]) for t in ("users", "accounts", "properties"))
    exact = [
        f"(SELECT count(*) FROM public.users WHERE id::text={u} AND email={dep.literal(EMAIL)})",
        f"(SELECT count(*) FROM public.accounts WHERE id::text={a} AND name={dep.literal('C4 staging isolated account '+RUN)})",
        f"(SELECT count(*) FROM public.properties WHERE id::text={p} AND account_id::text={a} AND name={dep.literal('C4 isolated property '+RUN)})",
    ]
    present = [f"(SELECT count(*) FROM {dep.table(t)} WHERE id::text={dep.literal(v)})"
               for t, v in ROOTS.items()]
    # Only UUID candidates, bounded before aggregation. The receipt suppresses
    # them unless all identities, cardinalities and graph ownership are proven.
    return f"""
WITH RECURSIVE scoped_bookings AS MATERIALIZED (
 SELECT id,booking_id FROM public.booking_ops_records
 WHERE account_id::text={a} OR property_id::text={p}
), graph(t,k) AS (
 (""" + "\nUNION\n".join(seeds) + """)
 UNION
 SELECT child.t,child.k FROM graph n CROSS JOIN LATERAL (
""" + dep.traversal(active) + """
 ) child
), nodes AS MATERIALIZED (SELECT * FROM graph LIMIT 10001),
counts AS (""" + "\nUNION ALL\n".join(counts) + """)
SELECT jsonb_build_object(
 'nodeLimitExceeded',(SELECT count(*)>10000 FROM nodes),
 'counts',(SELECT jsonb_object_agg(t,jsonb_build_object('incidentLinked',linked,'scopeConflicts',conflicts)) FROM counts),
 'identities',jsonb_build_array(""" + ",".join(exact) + """),
 'identityRoots',jsonb_build_array(""" + ",".join(present) + """),
 'states',""" + states_sql() + """,
 'bookingIds',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb)
   FROM (SELECT r.id FROM public.booking_ops_records r JOIN nodes n
     ON n.t='booking_ops_records' AND n.k=ARRAY[r.id::text] ORDER BY r.id LIMIT 2) b),
 'intakeIds',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb)
   FROM (SELECT r.id FROM public.booking_inbound_intake_events r JOIN nodes n
     ON n.t='booking_inbound_intake_events' AND n.k=ARRAY[r.id::text] ORDER BY r.id LIMIT 2) i)
)::text"""


def guarded_sql(catalog, missing):
    """Reuse catalog locks/recheck and return old/new observations atomically."""
    require(schema_check(catalog) == missing, "CATALOG_MISSING_DRIFT")
    old = dep.census_sql(missing)
    query = "SELECT jsonb_build_object('old',(" + old + ")::jsonb,'retained',(" + census_sql(missing) + ")::jsonb)::text"
    guarded = dep.guarded_sql(catalog, missing)
    require(guarded.count(old + ";\nROLLBACK;") == 1, "GUARD_SOURCE_DRIFT")
    return guarded.replace(old + ";\nROLLBACK;", query + ";\nROLLBACK;")


def old_observation(data, missing):
    """Retain validated old counts even when historical identity/count gates fail."""
    require(type(data) is dict and set(data) == {"counts", "identities", "identityRoots",
                                               "nodeLimitExceeded"}, "OLD_SHAPE")
    exact, present = data["identities"], data["identityRoots"]
    require(type(exact) is list and type(present) is list and len(exact) == len(present) == 5
            and all(type(v) is int and v in (0, 1) for v in exact + present)
            and all(x <= y for x, y in zip(exact, present)), "OLD_IDENTITY_SHAPE")
    require(type(data["nodeLimitExceeded"]) is bool, "OLD_GRAPH_SHAPE")
    counts = data["counts"]
    require(type(counts) is dict and set(counts) == set(dep.TABLES) - missing, "OLD_COUNT_RELATIONS")
    for value in counts.values():
        require(type(value) is dict and set(value) == {"incidentLinked", "scopeConflicts"}
                and all(type(n) is int and 0 <= n <= 10000 for n in value.values())
                and value["scopeConflicts"] <= value["incidentLinked"], "OLD_COUNT_SHAPE")
    issues = []
    if data["nodeLimitExceeded"]: issues.append("OLD_GRAPH_LIMIT")
    if exact != list(dep.OLD_IDENTITY_BASELINE) or present != list(dep.OLD_IDENTITY_BASELINE):
        issues.append("OLD_IDENTITY_CONFLICT")
    if any(v["scopeConflicts"] for v in counts.values()): issues.append("OLD_SCOPE_CONFLICT")
    expected = {"booking_ops_events": 24, "booking_cleaning_tasks": 1,
                "booking_linen_tasks": 1, "booking_supplies_tasks": 1,
                "booking_physical_readiness": 1, "booking_inbound_intake_events": 0}
    matches = all(counts[t]["incidentLinked"] == n for t, n in expected.items())
    if not matches: issues.append("OLD_EVIDENCE_COUNT_DRIFT")
    return {"status": "BLOCK" if issues else "OLD_CURRENT_COUNTS_OBSERVED",
            "identityChecks": [{"category": category, "exact": x, "presentById": y}
                for category, x, y in zip(dep.IncidentIdentityMismatch.CATEGORIES, exact, present)],
            "tables": {t: counts.get(t) for t in sorted(dep.TABLES)},
            "knownEvidenceCountsMatch": matches,
            "fullRowPreservationSinceWriter": "UNKNOWN"}, issues


def receipt(data, missing):
    """Expose counts and uniquely verified UUIDs, never guest data or fake PASS."""
    require(type(data) is dict and set(data) == {"old", "retained"}, "RECEIPT_SHAPE")
    fresh = data["retained"]
    require(type(fresh) is dict and set(fresh) == {"counts", "identities", "identityRoots",
            "nodeLimitExceeded", "bookingIds", "intakeIds", "states"}, "RETAINED_SHAPE")
    exact, present = fresh["identities"], fresh["identityRoots"]
    require(type(exact) is list and type(present) is list and len(exact) == len(present) == 3
            and all(type(v) is int and v in (0, 1) for v in exact + present)
            and all(x <= y for x, y in zip(exact, present)), "IDENTITY_SHAPE")
    require(type(fresh["nodeLimitExceeded"]) is bool, "GRAPH_SHAPE")
    counts = fresh["counts"]
    require(type(counts) is dict and set(counts) == set(dep.TABLES) - missing, "COUNT_RELATIONS")
    for value in counts.values():
        require(type(value) is dict and set(value) == {"incidentLinked", "scopeConflicts"}
                and all(type(n) is int and 0 <= n <= 10000 for n in value.values())
                and value["scopeConflicts"] <= value["incidentLinked"], "COUNT_SHAPE")
    for name in ("bookingIds", "intakeIds"):
        values = fresh[name]
        require(type(values) is list and len(values) <= 2 and all(
            type(v) is str and re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", v)
            for v in values) and len(set(values)) == len(values), "CANDIDATE_SHAPE")
    state_counts = fresh["states"]
    require(type(state_counts) is dict and set(state_counts) == set(STATES), "STATE_RELATIONS")
    for name, states in STATES.items():
        value = state_counts[name]
        keys = set(states) | {"unknown"}
        if name == "booking_physical_readiness": keys |= {"finalReady", "approvedAndFinalReady"}
        require(type(value) is dict and set(value) == keys and all(
            type(n) is int and 0 <= n <= 10000 for n in value.values()), "STATE_SHAPE")
        require(sum(value[k] for k in set(states) | {"unknown"}) == counts[name]["incidentLinked"], "STATE_COUNT")
        if name == "booking_physical_readiness":
            require(value["approvedAndFinalReady"] <= min(value["approved"], value["finalReady"])
                    and value["finalReady"] <= counts[name]["incidentLinked"], "STATE_COUNT")
    bcount = counts["booking_ops_records"]["incidentLinked"]
    icount = counts["booking_inbound_intake_events"]["incidentLinked"]
    require(len(fresh["bookingIds"]) == min(bcount, 2)
            and len(fresh["intakeIds"]) == min(icount, 2), "CANDIDATE_COUNT")
    issues = []
    if any(v["unknown"] for v in state_counts.values()): issues.append("UNKNOWN_STATE")
    if fresh["nodeLimitExceeded"]: issues.append("GRAPH_LIMIT")
    if exact != present: issues.append("ROOT_IDENTITY_CONFLICT")
    if any(v["scopeConflicts"] for v in counts.values()): issues.append("CROSS_SCOPE_ROWS")
    if bcount > 1 or icount > 1: issues.append("MULTIPLE_CANDIDATES")
    candidate_ids = fresh["bookingIds"] + fresh["intakeIds"]
    if len(set(candidate_ids)) != len(candidate_ids) or set(candidate_ids) & (set(ROOTS.values()) | set(dep.prior.OWNED.values())):
        issues.append("ID_COLLISION")
    total = sum(v["incidentLinked"] for v in counts.values())
    if total and exact != [1, 1, 1]: issues.append("PARTIAL_ROOTS")
    old, old_issues = old_observation(data["old"], missing)
    issues.extend(old_issues)
    state = ("NO_ROWS_OBSERVED" if total == 0 else
             "BOOKING_AND_INTAKE_OBSERVED" if bcount == icount == 1 else
             "ROOTS_ONLY_OBSERVED" if bcount == icount == 0 else "PARTIAL_FLOW_OBSERVED")
    reveal = not issues and exact == [1, 1, 1]
    return {"status": "BLOCK" if issues else "C4_RETAINED_READONLY_OBSERVED",
            "incidentRun": RUN, "writerSha": SOURCE_SHA, "observation": state,
            "blockCodes": issues, "rootIdentities": [
                {"category": category, "exact": x, "presentById": y}
                for category, x, y in zip(("user", "account", "property"), exact, present)],
            "bookingIds": fresh["bookingIds"] if reveal else [],
            "intakeIds": fresh["intakeIds"] if reveal else [],
            "tables": {t: counts.get(t) for t in sorted(dep.TABLES)},
            "notDeployed": sorted(missing), "oldIncident": old, "states": state_counts,
            "stagingWrites": False, "cleanupAuthorized": False, "physicalReplayAuthorized": False,
            "historicalWriteOutcome": "NOT_INFERRED_FROM_CURRENT_SNAPSHOT",
            "fullPhysicalE2E": "NOT_YET_PROVEN", "externalEffectsObserved": "NOT_INDEPENDENTLY_PROVEN"}


class StageFailure(Block):
    """Carry only a fixed source label through transport/validation failures."""
    def __init__(self, stage):
        require(stage in {"ADMISSION", "CHECKOUT", "HISTORY", "CATALOG", "SCHEMA", "CENSUS", "RECEIPT"}, "STAGE")
        self.stage = stage
        super().__init__("RETAINED_" + stage + "_UNPROVEN")


def stage(label, operation):
    """Keep failure location while suppressing database and credential text."""
    try:
        return operation()
    except Exception:
        raise StageFailure(label) from None


def run(env):
    """Reuse pinned PG17/TLS/history gates; no SSH, HTTP, mutation or cleanup."""
    url = stage("ADMISSION", lambda: validate(env))
    prior = dep.prior
    head = stage("CHECKOUT", lambda: prior.g0.checked(
        ["git", "-C", str(prior.g0.ROOT), "rev-parse", "HEAD"])).stdout.decode("ascii").strip()
    require(head == env["GITHUB_SHA"], "CHECKOUT_DRIFT")
    stage("HISTORY", lambda: prior.g0.exact_sql_history(url))
    with tempfile.TemporaryDirectory(prefix="c4-retained-readonly-") as dirname:
        folder = Path(dirname)
        folder.chmod(0o700)
        cert = folder / "roots.pem"
        cert.write_bytes(Path("/etc/ssl/certs/ca-certificates.crt").read_bytes()
                         + b"\n" + prior.tls_guard.ca_bytes())
        cert.chmod(0o600)
        db_env = prior.pg.db_environment(url, cert, True)
        require("default_transaction_read_only=on" in db_env["PGOPTIONS"], "READ_ONLY_REQUIRED")
        cmd = prior.pg.postgres_client_command(folder, "postcheck")
        require(cmd[-2] == "-c", "PSQL_SHAPE")
        cmd[-2:] = ["-q", "--set", "VERBOSITY=sqlstate", "--file", "/work/retained.sql"]
        query = folder / "retained.sql"
        query.write_text("BEGIN READ ONLY; SET LOCAL row_security=off; SET LOCAL statement_timeout='45s';"
                         + dep.catalog_sql() + ";ROLLBACK;", encoding="utf-8")
        query.chmod(0o600)
        catalog = stage("CATALOG", lambda: dep.execute(cmd, db_env))
        missing = stage("SCHEMA", lambda: schema_check(catalog))
        query.write_text(guarded_sql(catalog, missing), encoding="utf-8")
        observed = stage("CENSUS", lambda: dep.execute(cmd, db_env))
        result = stage("RECEIPT", lambda: receipt(observed, missing))
        result["reviewedMainSha"] = env["GITHUB_SHA"]
        result["optionalModule"] = dep.optional_module_witness(catalog["optionalModule"])
        return result


def host_run(env):
    """Read the existing fixed G0 host preflight for this retained operator only."""
    stage("ADMISSION", lambda: validate(env))
    sha = env["GITHUB_SHA"]
    adapted = dict(env, GITHUB_WORKFLOW_REF=host_probe.WORKFLOW,
                   C4_CONFIRM="RUN_STRIGUNOV4_C4_PREFLIGHT_" + sha)
    _, host, port = stage("ADMISSION", lambda: host_probe.validate(adapted))
    head = stage("CHECKOUT", lambda: dep.prior.g0.checked(
        ["git", "-C", str(dep.prior.g0.ROOT), "rev-parse", "HEAD"])).stdout.decode("ascii").strip()
    require(head == sha, "CHECKOUT_DRIFT")
    try:
        result = host_probe.probe(adapted, host, port, operator_email=EMAIL, config_only=True)
        return dict(result, status="C4_HOST_CONFIG_READONLY_OBSERVED", incidentRun=RUN, reviewedMainSha=sha,
                    operatorConfigured=True, physicalReplayAuthorized=False,
                    historicalCause="NOT_INFERRED_FROM_CURRENT_PREFLIGHT")
    except Exception as error:
        allowed = {"HOST_" + code for code in host_probe.HOST_BLOCK_CODES}
        allowed |= {"REMOTE_JSON", "REMOTE_NOT_PROVEN", "OPERATOR_IDENTITY"}
        code = str(error) if type(error) is host_probe.Block and str(error) in allowed else "HOST_PREFLIGHT_UNPROVEN"
        return {"status": "BLOCK", "blockCode": code, "incidentRun": RUN,
                "reviewedMainSha": sha, "stagingWrites": False,
                "physicalReplayAuthorized": False, "fullE2E": "NOT_RUN",
                "historicalCause": "NOT_INFERRED_FROM_CURRENT_PREFLIGHT"}


def main(argv=None):
    """Never expose exceptions, SQL, credentials, catalog names or row contents."""
    try:
        args = sys.argv[1:] if argv is None else argv
        require(args in ([], ["--host-only"]), "ARGUMENTS")
        result = host_run(os.environ) if args else run(os.environ)
        print(json.dumps(result, sort_keys=True))
        return 2 if result["status"] == "BLOCK" else 0
    except Exception as error:
        code = str(error) if type(error) is StageFailure else "RETAINED_READONLY_UNPROVEN"
        print(json.dumps({"status": "BLOCK", "blockCode": code,
            "incidentRun": RUN, "stagingWrites": False, "cleanupAuthorized": False,
            "physicalReplayAuthorized": False, "fullPhysicalE2E": "NOT_YET_PROVEN"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
