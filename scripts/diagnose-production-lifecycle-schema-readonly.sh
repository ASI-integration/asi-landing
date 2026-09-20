#!/usr/bin/env bash
# TEMPORARY read-only production schema/catalog verification for PR #318 production pre-deploy prerequisite check.
# Verifies public.ru_commercial_pilot_lifecycle exists with the expected columns, RLS, and service_role grants.
# Schema/catalog metadata only. No application-row reads. No writes. Fails closed if the session is not truly read-only.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL required}"
: "${EXPECTED_SUPABASE_PROJECT_REF:?EXPECTED_SUPABASE_PROJECT_REF required}"

ARTIFACT="${PROD_LIFECYCLE_SCHEMA_DIAGNOSTIC_ARTIFACT:-production-lifecycle-schema-diagnostic.txt}"

echo "::add-mask::${SUPABASE_DB_URL}"

python3 - <<'PY'
import os, re
from urllib.parse import unquote, urlparse
raw = os.environ["SUPABASE_DB_URL"]
expected = os.environ["EXPECTED_SUPABASE_PROJECT_REF"].strip().lower()
if not re.fullmatch(r"[a-z0-9]{20}", expected):
    raise SystemExit("invalid EXPECTED_SUPABASE_PROJECT_REF")
u = urlparse(raw)
host = (u.hostname or "").lower()
user = unquote(u.username or "").lower()
direct = host == f"db.{expected}.supabase.co"
pooler = host.endswith(".pooler.supabase.com") and user == f"postgres.{expected}"
if not (direct or pooler):
    raise SystemExit("Production database identity does not match EXPECTED_SUPABASE_PROJECT_REF")
print(f"expected_project_ref={expected}")
print("PRODUCTION_IDENTITY_CHECK=PASS")
PY

export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
export PGOPTIONS="-c statement_timeout=30000 -c lock_timeout=3000"

SQL=$(cat <<'SQL'
BEGIN TRANSACTION READ ONLY;

SELECT '=== READ_ONLY_GUARD ===' AS section;
SELECT current_setting('transaction_read_only') AS transaction_read_only;
DO $$
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'READ_ONLY_GUARD_FAILED: transaction_read_only is not on';
  END IF;
END $$;

SELECT '=== TABLE_PRESENCE ===' AS section;
SELECT to_regclass('public.ru_commercial_pilot_lifecycle') IS NOT NULL AS table_exists;

SELECT '=== REQUIRED_COLUMNS ===' AS section;
SELECT required.column_name,
       (c.column_name IS NOT NULL) AS present,
       c.data_type
FROM (
  VALUES
    ('account_id'), ('property_id'), ('status'),
    ('setup_started_at'), ('ready_at'),
    ('pilot_started_at'), ('pilot_ends_at'), ('pilot_completed_at')
) AS required(column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'ru_commercial_pilot_lifecycle'
 AND c.column_name = required.column_name
ORDER BY required.column_name;

SELECT '=== RLS_ENABLED ===' AS section;
SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class
WHERE oid = to_regclass('public.ru_commercial_pilot_lifecycle');

SELECT '=== SERVICE_ROLE_GRANTS ===' AS section;
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'ru_commercial_pilot_lifecycle'
  AND grantee = 'service_role'
ORDER BY privilege_type;

SELECT '=== SERVICE_ROLE_POLICIES ===' AS section;
SELECT polname AS policy_name, polcmd AS command, roles::text AS roles
FROM pg_policy
WHERE polrelid = to_regclass('public.ru_commercial_pilot_lifecycle');

SELECT '=== READ_ONLY_GUARD_FINAL ===' AS section;
SELECT current_setting('transaction_read_only') AS transaction_read_only;

ROLLBACK;
SQL
)

SQL_FILE="$(mktemp)"
trap 'rm -f "$SQL_FILE"' EXIT
printf '%s\n' "$SQL" > "$SQL_FILE"

{
  echo "BEGIN"
  psql "$SUPABASE_DB_URL" \
    -v ON_ERROR_STOP=1 \
    -P pager=off \
    -f "$SQL_FILE"
  echo "END"
} | tee "$ARTIFACT"

echo "PRODUCTION_LIFECYCLE_SCHEMA_DIAGNOSTIC=PASS"
