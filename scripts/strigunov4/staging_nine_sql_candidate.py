"""Build the exact nine-migration Strigunov4 staging SQL candidate, offline only.

A successful build proves byte/order/transaction shape, not owner approval,
restoration, fresh staging compatibility, or permission to apply the SQL.
There is deliberately no database connector, executor or --execute option.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

import protected_staging_admission as gate

VERSIONS = (
    "20260810280000", "20261003124500", "20261003141500",
    "20261003150000", "20261005090000", "20261015103000",
    "20261016090000", "20261016203000", "20261016213000",
)
PRESERVE = (
    "20260729040307", "20260729040309", "20260729040332",
    "20260913120838", "20260913120856", "20260913120921",
    "20260913120945",
)
COLUMNS = {
    "booking_inbound_intake_events": ("account_id", "account_scope_key"),
    "booking_ops_communication_auto_send_scopes": ("account_id", "account_scope_key"),
    "booking_ops_communication_auto_send_runs": ("account_id",),
    "booking_ops_communication_deliveries": ("account_id",),
    "booking_overbooking_conflict_checks": ("account_id",),
    "booking_ops_records": ("automation_paused",),
    "booking_ops_alerts": ("revision",),
    "tg_property_knowledge": (
        "check_in_instructions", "key_instructions",
        "parking_instructions", "check_out_instructions",
        "emergency_contacts",
    ),
}

def require(check, code):
    if not check:
        raise gate.Block(code)

def read_sources(root, files=None):
    files = gate.SQL_FILES if files is None else tuple(files)
    require(len(files) == len(VERSIONS) == 9, "FILE_COUNT")
    sources = []
    for i, ((name, expected), version) in enumerate(zip(files, VERSIONS)):
        basename = Path(name).name
        require(basename.startswith(version + "_") and basename.endswith(".sql"), "MIGRATION_ORDER")
        # Fail if any user-supplied or platform-local copy differs from pinned source.
        require(gate._file_digest(root, name) == expected, "SOURCE_DIGEST")
        text = (Path(root) / name).read_bytes().decode("utf-8")
        require("\r" not in text, "NOT_GIT_LF")
        require(not re.search(r"(?m)^\s*\\", text), "PSQL_META_IN_SOURCE")
        txn_begins = re.findall(r"(?m)^BEGIN;[ \t]*$", text)
        txn_commits = re.findall(r"(?m)^COMMIT;[ \t]*$", text)
        txn_rollbacks = re.findall(r"(?m)^ROLLBACK;[ \t]*$", text)
        require(not txn_rollbacks, "EMBEDDED_ROLLBACK")
        if i == 6:
            require(len(txn_begins) == len(txn_commits) == 1, "G0_TRANSACTION_SHAPE")
            text = re.sub(r"(?m)^BEGIN;[ \t]*\n", "", text, count=1)
            text = re.sub(r"(?m)^COMMIT;[ \t]*(\n|$)", "", text, count=1)
        else:
            require(not txn_begins and not txn_commits, "EMBEDDED_TRANSACTION")
        require(not re.search(r"(?m)^(BEGIN|COMMIT|ROLLBACK);[ \t]*$", text),
                "LEFTOVER_TRANSACTION_MARKER")
        logical = basename[len(version) + 1 : -4]
        require(re.fullmatch("[a-z0-9_]+", logical) is not None, "MIGRATION_NAME")
        sources.append((version, logical, expected, text))
    return sources

def render(root=gate.SOURCE_ROOT, files=None):
    sources = read_sources(root, files)
    preserved = ",".join("'" + x + "'" for x in PRESERVE)
    new = ",".join("'" + x[0] + "'" for x in sources)
    sql = [
        "-- REVIEWED SOURCE ONLY. NO DATABASE EXECUTION AUTHORITY.",
        "-- Requires independently approved staging environment and live preflight.",
        r"\set ON_ERROR_STOP on",
        "BEGIN;",
        "SET LOCAL lock_timeout = '5s';",
        "SET LOCAL statement_timeout = '600s';",
        "SELECT pg_advisory_xact_lock(7411, 20261017);",
        "DO $precheck$",
        "BEGIN",
        " IF current_setting('server_version_num')::int / 10000 <> 17 THEN",
        "   RAISE EXCEPTION 'postgres17_required'; END IF;",
        " IF current_setting('transaction_read_only') <> 'off' THEN",
        "   RAISE EXCEPTION 'read_only_connection'; END IF;",
        " IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN",
        "   RAISE EXCEPTION 'migration_history_missing'; END IF;",
        " IF NOT EXISTS (SELECT 1 FROM pg_constraint c",
        "   WHERE c.conrelid='supabase_migrations.schema_migrations'::regclass",
        "   AND c.contype='p' AND pg_get_constraintdef(c.oid)='PRIMARY KEY (version)') THEN",
        "   RAISE EXCEPTION 'migration_history_contract'; END IF;",
        " IF NOT EXISTS (SELECT 1 FROM information_schema.columns",
        "  WHERE table_schema='supabase_migrations' AND table_name='schema_migrations'",
        "  AND column_name='version' AND data_type='text' AND is_nullable='NO')",
        " OR NOT EXISTS (SELECT 1 FROM information_schema.columns",
        "  WHERE table_schema='supabase_migrations' AND table_name='schema_migrations'",
        "  AND column_name='name' AND data_type='text')",
        " OR NOT EXISTS (SELECT 1 FROM information_schema.columns",
        "  WHERE table_schema='supabase_migrations' AND table_name='schema_migrations'",
        "  AND column_name='statements' AND data_type='ARRAY' AND udt_name='_text') THEN",
        "   RAISE EXCEPTION 'migration_history_column_contract'; END IF;",
        " IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations",
        f"   WHERE version IN ({new})) THEN",
        "   RAISE EXCEPTION 'selected_history_already_registered'; END IF;",
        " IF (SELECT count(*) FROM supabase_migrations.schema_migrations",
        f"   WHERE version IN ({preserved})) <> 7 THEN",
        "   RAISE EXCEPTION 'seven_staging_only_versions_missing'; END IF;",
        " IF to_regclass('public.booking_ops_automation_executions') IS NOT NULL",
        "    OR to_regprocedure('public.g0_begin_automation(uuid,uuid)') IS NOT NULL",
        "    OR to_regprocedure('public.g0_acknowledge_operator_alert(uuid,uuid,uuid,bigint)') IS NOT NULL THEN",
        "   RAISE EXCEPTION 'partially_applied_g0'; END IF;",
        "END $precheck$;",
        "CREATE TEMP TABLE strigunov_preserved_history ON COMMIT DROP AS",
        " SELECT version,name,statements FROM supabase_migrations.schema_migrations",
        f" WHERE version IN ({preserved});",
        "CREATE TEMP TABLE strigunov_runtime_functions ON COMMIT DROP AS",
        " SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,",
        " pg_get_functiondef(p.oid) definition,p.proacl,p.proowner,p.proconfig",
        " FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace",
        " WHERE n.nspname='runtime_bridge' OR p.proname LIKE '%asi_runtime_bridge%';",
    ]
    # Require the same 14-field absence as the reviewed staging catalog.
    # A changed live schema must be reconciled and independently reviewed,
    # never patched through the original nine-file bundle opportunistically.
    baseline = [
        " IF NOT EXISTS (SELECT 1 FROM pg_constraint",
        "  WHERE conrelid='public.booking_ops_communication_intents'::regclass",
        "  AND conname='booking_ops_communication_purpose_check') THEN",
        "   RAISE EXCEPTION 'purpose_constraint_baseline_missing'; END IF;",
    ]
    for table, columns in COLUMNS.items():
        for col in columns:
            baseline.extend([
                " IF EXISTS (SELECT 1 FROM information_schema.columns",
                f"  WHERE table_schema='public' AND table_name='{table}' AND column_name='{col}') THEN",
                f"   RAISE EXCEPTION 'source_schema_drift_{table}_{col}'; END IF;",
            ])
    sql[sql.index("END $precheck$;"):sql.index("END $precheck$;")] = baseline
    for version, logical, sha, text in sources:
        sql += ["", f"-- VERSION {version}: {logical}", f"-- VERIFIED_SOURCE_SHA256 {sha}",
                text.rstrip("\n")]
    sql.extend([
        "",
        "DO $postcheck$",
        "BEGIN",
    ])
    for table, columns in COLUMNS.items():
        for col in columns:
            sql.extend([
                " IF NOT EXISTS (SELECT 1 FROM information_schema.columns",
                f"  WHERE table_schema='public' AND table_name='{table}' AND column_name='{col}') THEN",
                f"  RAISE EXCEPTION 'missing_{table}_{col}'; END IF;",
            ])
    sql.extend([
        " IF EXISTS(SELECT version,name,statements FROM strigunov_preserved_history",
        "    EXCEPT SELECT version,name,statements FROM supabase_migrations.schema_migrations) THEN",
        "   RAISE EXCEPTION 'seven_staging_only_versions_changed'; END IF;",
        " IF EXISTS (SELECT * FROM strigunov_runtime_functions EXCEPT",
        "  SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),",
        "  pg_get_functiondef(p.oid),p.proacl,p.proowner,p.proconfig",
        "  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace",
        "  WHERE n.nspname='runtime_bridge' OR p.proname LIKE '%asi_runtime_bridge%') THEN",
        "   RAISE EXCEPTION 'runtime_bridge_changed'; END IF;",
        " IF EXISTS (SELECT 1 FROM public.booking_ops_communication_auto_send_scopes",
        "  WHERE scope_type<>'global' AND (actual_send_enabled IS DISTINCT FROM false",
        "  OR dry_run_only IS DISTINCT FROM true)) THEN",
        "   RAISE EXCEPTION 'unsafe_send_scope'; END IF;",
        " IF has_function_privilege('anon','public.g0_begin_automation(uuid,uuid)','EXECUTE')",
        " OR has_function_privilege('authenticated',",
        "  'public.g0_acknowledge_operator_alert(uuid,uuid,uuid,bigint)','EXECUTE') THEN",
        "   RAISE EXCEPTION 'client_privilege_exposed'; END IF;",
        "END $postcheck$;",
        "",
        "-- The exact nine migration history records are written in the SAME transaction.",
        "INSERT INTO supabase_migrations.schema_migrations (version,name,statements)",
        "VALUES",
    ])
    sql.append(",\n".join(
        f" ('{version}','{logical}',ARRAY[]::text[])"
        for version, logical, _, _ in sources
    ) + ";")
    sql.extend([
        "DO $history_postcheck$",
        "BEGIN",
        " IF (SELECT count(*) FROM supabase_migrations.schema_migrations",
        f"  WHERE version IN ({new})) <> 9 THEN",
        "   RAISE EXCEPTION 'nine_history_rows_missing'; END IF;",
        " IF EXISTS(SELECT version,name,statements FROM strigunov_preserved_history",
        "    EXCEPT SELECT version,name,statements FROM supabase_migrations.schema_migrations) THEN",
        "   RAISE EXCEPTION 'staging_only_versions_changed'; END IF;",
        "END $history_postcheck$;",
        "COMMIT;",
        "",
    ])
    candidate = "\n".join(sql)
    # Known safe shape: exactly one top-level pair, no extra BEGIN/COMMIT lines.
    require(len(re.findall(r"(?m)^BEGIN;$", candidate)) == 1, "OUTER_BEGIN")
    require(len(re.findall(r"(?m)^COMMIT;$", candidate)) == 1, "OUTER_COMMIT")
    require(not re.search(r"(?m)^ROLLBACK;$", candidate), "ROLLBACK_IN_APPLY")
    return candidate

def main():
    try:
        output = render()
        result = {
            "status": "NINE_STAGING_SQL_CANDIDATE_NOT_AUTHORIZED",
            "migration_count": 9,
            "transaction": "ONE_BEGIN_ONE_COMMIT",
            "source_commit": gate.RELEASE_SHA,
            "sha256": hashlib.sha256(output.encode("utf-8")).hexdigest(),
            "sql_bytes": len(output.encode("utf-8")),
            "database_mutation": False,
            "migration_history_mutation": False,
        }
        print(json.dumps(result, sort_keys=True))
        return 0
    except (gate.Block, ValueError, OSError, UnicodeError):
        print('{"status":"BLOCK","database_mutation":false}')
        return 2

if __name__ == "__main__":
    sys.exit(main())
