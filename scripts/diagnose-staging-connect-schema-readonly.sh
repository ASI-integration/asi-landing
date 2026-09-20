#!/usr/bin/env bash
# TEMPORARY / diagnostic-only: read-only catalog inspection of staging schema
# required by RU self-service connect (PR #318 step 2).
# SELECT / information_schema / pg_catalog only. No INSERT/UPDATE/DELETE/DDL/migration.
set -euo pipefail

: "${STAGING_DATABASE_URL:?Missing STAGING_DATABASE_URL}"
: "${STAGING_SUPABASE_PROJECT_REF:?Missing STAGING_SUPABASE_PROJECT_REF}"

command -v psql >/dev/null

# Mask URL in Actions logs without printing credentials.
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
  echo "::add-mask::${STAGING_DATABASE_URL}"
fi

export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
export PGOPTIONS="${PGOPTIONS:--c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000}"

artifact="${STAGING_CONNECT_SCHEMA_DIAGNOSTIC_ARTIFACT:-staging-connect-schema-diagnostic.txt}"

psql -X "$STAGING_DATABASE_URL" \
  --no-psqlrc \
  --set ON_ERROR_STOP=1 \
  --output "$artifact" <<'SQL'
\pset pager off
\pset footer off
\pset border 2
\pset null '(null)'

BEGIN TRANSACTION READ ONLY;

SHOW transaction_read_only
\gset
\if :transaction_read_only
\else
  \echo 'READ_ONLY_GUARD_FAILED'
  \quit 3
\endif

\qecho '=== READ_ONLY_GUARD ==='
SHOW transaction_read_only;
SHOW default_transaction_read_only;
SHOW statement_timeout;
SHOW lock_timeout;

\qecho '=== REQUIRED_TABLES_EXISTENCE_RLS_SERVICE_ROLE ==='
SELECT
  required.table_name,
  (to_regclass('public.' || required.table_name) IS NOT NULL) AS exists,
  COALESCE(cls.relrowsecurity, false) AS rls_enabled,
  CASE
    WHEN to_regclass('public.' || required.table_name) IS NULL THEN false
    ELSE has_table_privilege('service_role', to_regclass('public.' || required.table_name), 'SELECT')
  END AS service_role_select,
  CASE
    WHEN to_regclass('public.' || required.table_name) IS NULL THEN false
    ELSE has_table_privilege('service_role', to_regclass('public.' || required.table_name), 'INSERT')
  END AS service_role_insert,
  CASE
    WHEN to_regclass('public.' || required.table_name) IS NULL THEN false
    ELSE has_table_privilege('service_role', to_regclass('public.' || required.table_name), 'UPDATE')
  END AS service_role_update,
  CASE
    WHEN to_regclass('public.' || required.table_name) IS NULL THEN false
    ELSE has_table_privilege('service_role', to_regclass('public.' || required.table_name), 'DELETE')
  END AS service_role_delete
FROM (
  VALUES
    ('properties'),
    ('tg_property_knowledge'),
    ('ru_commercial_pilot_lifecycle'),
    ('ops_operator_tasks'),
    ('ops_v17_onboardings'),
    ('users'),
    ('accounts'),
    ('account_members')
) AS required(table_name)
LEFT JOIN pg_class AS cls
  ON cls.oid = to_regclass('public.' || required.table_name)
ORDER BY required.table_name;

\qecho '=== REQUIRED_COLUMNS_RU_COMMERCIAL_PILOT_LIFECYCLE ==='
SELECT
  required.column_name,
  (cols.column_name IS NOT NULL) AS exists,
  cols.data_type,
  cols.is_nullable
FROM (
  VALUES
    ('account_id'),
    ('property_id'),
    ('status'),
    ('setup_started_at'),
    ('ready_at'),
    ('pilot_started_at'),
    ('pilot_ends_at'),
    ('pilot_completed_at')
) AS required(column_name)
LEFT JOIN information_schema.columns AS cols
  ON cols.table_schema = 'public'
 AND cols.table_name = 'ru_commercial_pilot_lifecycle'
 AND cols.column_name = required.column_name
ORDER BY required.column_name;

\qecho '=== REQUIRED_COLUMNS_OPS_OPERATOR_TASKS ==='
SELECT
  required.column_name,
  (cols.column_name IS NOT NULL) AS exists,
  cols.data_type,
  cols.is_nullable
FROM (
  VALUES
    ('task_type'),
    ('task_status'),
    ('source'),
    ('object_id'),
    ('dedup_key'),
    ('description'),
    ('metadata')
) AS required(column_name)
LEFT JOIN information_schema.columns AS cols
  ON cols.table_schema = 'public'
 AND cols.table_name = 'ops_operator_tasks'
 AND cols.column_name = required.column_name
ORDER BY required.column_name;

\qecho '=== REQUIRED_COLUMNS_PROPERTIES ==='
SELECT
  required.column_name,
  (cols.column_name IS NOT NULL) AS exists,
  cols.data_type,
  cols.is_nullable
FROM (
  VALUES
    ('id'),
    ('account_id'),
    ('name'),
    ('address_line')
) AS required(column_name)
LEFT JOIN information_schema.columns AS cols
  ON cols.table_schema = 'public'
 AND cols.table_name = 'properties'
 AND cols.column_name = required.column_name
ORDER BY required.column_name;

\qecho '=== REQUIRED_COLUMNS_TG_PROPERTY_KNOWLEDGE ==='
SELECT
  required.column_name,
  (cols.column_name IS NOT NULL) AS exists,
  cols.data_type,
  cols.is_nullable
FROM (
  VALUES
    ('property_id'),
    ('object_name'),
    ('address'),
    ('description'),
    ('house_rules_text'),
    ('check_in_time'),
    ('check_out_time'),
    ('wifi_name'),
    ('wifi_password'),
    ('access_notes'),
    ('booking_channels'),
    ('photos_deferred'),
    ('active'),
    ('communication_autopilot')
) AS required(column_name)
LEFT JOIN information_schema.columns AS cols
  ON cols.table_schema = 'public'
 AND cols.table_name = 'tg_property_knowledge'
 AND cols.column_name = required.column_name
ORDER BY required.column_name;

\qecho '=== TARGETED_MIGRATION_HISTORY ==='
SELECT version
FROM supabase_migrations.schema_migrations
WHERE version IN (
  '20260729040307',
  '20260729040309',
  '20260729040332',
  '20260913120838',
  '20260913120856',
  '20260913120921',
  '20260913120945',
  '20260918120000'
)
ORDER BY version;

\qecho '=== MIGRATION_20260918120000_PRESENT ==='
SELECT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260918120000'
) AS migration_20260918120000_recorded;

\qecho '=== ORPHAN_REMOTE_MIGRATION_VERSIONS ==='
SELECT version AS orphan_remote_version
FROM supabase_migrations.schema_migrations
WHERE version IN (
  '20260729040307',
  '20260729040309',
  '20260729040332',
  '20260913120838',
  '20260913120856',
  '20260913120921',
  '20260913120945'
)
ORDER BY version;

ROLLBACK;
SQL

echo "READ_ONLY_GUARD=verified"
echo "DIAGNOSTIC_SCOPE=staging_connect_schema_catalog"
echo "DIAGNOSTIC_ARTIFACT=${artifact}"
echo "ORPHAN_VERSIONS_EXPECTED=20260729040307,20260729040309,20260729040332,20260913120838,20260913120856,20260913120921,20260913120945"
)
