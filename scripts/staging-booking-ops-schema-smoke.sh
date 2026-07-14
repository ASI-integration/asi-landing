#!/usr/bin/env bash
set -euo pipefail

EXPECTED_MIGRATION_COUNT=82
: "${STAGING_DATABASE_URL:?Missing STAGING_DATABASE_URL}"
: "${STAGING_SUPABASE_PROJECT_REF:?Missing STAGING_SUPABASE_PROJECT_REF}"

command -v supabase >/dev/null
command -v psql >/dev/null
supabase --version
supabase db push --help | grep -F -- '--dry-run' >/dev/null
supabase db push --help | grep -F -- '--include-all' >/dev/null

echo 'Running read-only migration dry-run against staging'
supabase db push --db-url "$STAGING_DATABASE_URL" --dry-run --include-all

local_versions="$(mktemp)"
remote_versions="$(mktemp)"
trap 'rm -f "$local_versions" "$remote_versions"' EXIT

for migration in supabase/migrations/*.sql; do
  filename="${migration##*/}"
  printf '%s\n' "${filename%%_*}"
done | LC_ALL=C sort > "$local_versions"

local_count="$(wc -l < "$local_versions" | tr -d ' ')"
unique_count="$(LC_ALL=C sort -u "$local_versions" | wc -l | tr -d ' ')"
if [ "$local_count" -ne "$EXPECTED_MIGRATION_COUNT" ]; then
  echo "Expected ${EXPECTED_MIGRATION_COUNT} local migrations, found ${local_count}"
  exit 1
fi
if [ "$unique_count" -ne "$local_count" ]; then
  echo 'Local migration prefixes are not unique'
  uniq -d "$local_versions"
  exit 1
fi

psql "$STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc \
  'select version from supabase_migrations.schema_migrations order by version' \
  | LC_ALL=C sort > "$remote_versions"

remote_count="$(wc -l < "$remote_versions" | tr -d ' ')"
if [ "$remote_count" -ne "$EXPECTED_MIGRATION_COUNT" ]; then
  echo "Expected ${EXPECTED_MIGRATION_COUNT} staging migrations, found ${remote_count}"
  exit 1
fi
if ! diff -u "$local_versions" "$remote_versions"; then
  echo 'Local and staging migration history differ'
  exit 1
fi
echo "MIGRATION_HISTORY PASS local=${local_count} remote=${remote_count} uniquePrefixes=${unique_count} pending=0 unknown=0"

psql "$STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $verify$
DECLARE
  item text;
  relation regclass;
  fk record;
BEGIN
  FOREACH item IN ARRAY ARRAY[
    'tg_contacts','tg_conversations','tg_conversation_sessions','tg_message_turns',
    'comm_messages','comm_events','comm_dlq','pending_messages',
    'booking_ops_records','booking_ops_tasks','booking_ops_alerts','booking_lifecycle_gates',
    'booking_ops_lifecycle_runs','booking_ops_lifecycle_states','booking_ops_lifecycle_events',
    'reservation_source_links','reservation_import_batches','reservation_import_rows',
    'reservation_reconciliation_items','reservation_ledger_audit',
    'booking_owner_setup_profiles','booking_property_setup_profiles',
    'booking_channel_manager_connections','booking_channel_import_runs',
    'booking_channel_imported_objects','booking_channel_imported_bookings',
    'booking_channel_calendar_snapshots'
  ] LOOP
    relation := to_regclass(format('public.%I', item));
    IF relation IS NULL THEN
      RAISE EXCEPTION 'missing critical table: %', item;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE oid = relation AND relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled: %', item;
    END IF;
    IF NOT (
      has_table_privilege('service_role', relation, 'SELECT')
      AND has_table_privilege('service_role', relation, 'INSERT')
      AND has_table_privilege('service_role', relation, 'UPDATE')
      AND has_table_privilege('service_role', relation, 'DELETE')
    ) THEN
      RAISE EXCEPTION 'service_role CRUD grant missing: %', item;
    END IF;
  END LOOP;

  FOREACH item IN ARRAY ARRAY[
    'idx_tg_message_turns_chat_created_at','idx_tg_conversations_channel_chat',
    'idx_comm_messages_conversation','idx_pending_messages_chat_id',
    'idx_booking_ops_tasks_open_dedup','idx_booking_ops_alerts_active_dedupe',
    'idx_booking_lifecycle_gates_unique','idx_booking_ops_lifecycle_events_dedupe',
    'booking_ops_records_asi_reference_uidx','reservation_source_links_booking_idx',
    'idx_booking_owner_setup_profiles_status','idx_booking_property_setup_profiles_owner_setup',
    'idx_booking_channel_manager_connections_property','idx_booking_channel_import_runs_connection'
  ] LOOP
    IF to_regclass(format('public.%I', item)) IS NULL THEN
      RAISE EXCEPTION 'missing key index: %', item;
    END IF;
  END LOOP;

  FOR fk IN
    SELECT * FROM (VALUES
      ('tg_conversations','tg_contacts'),
      ('comm_messages','tg_conversations'),
      ('pending_messages','tg_conversations'),
      ('booking_ops_tasks','booking_ops_records'),
      ('booking_ops_alerts','booking_ops_records'),
      ('booking_ops_lifecycle_runs','booking_ops_records'),
      ('booking_ops_lifecycle_states','booking_ops_records'),
      ('booking_ops_lifecycle_events','booking_ops_records'),
      ('reservation_source_links','booking_ops_records'),
      ('reservation_import_rows','reservation_import_batches'),
      ('booking_property_setup_profiles','booking_owner_setup_profiles'),
      ('booking_channel_manager_connections','booking_property_setup_profiles'),
      ('booking_channel_import_runs','booking_channel_manager_connections'),
      ('booking_channel_imported_objects','booking_channel_manager_connections'),
      ('booking_channel_imported_bookings','booking_channel_manager_connections'),
      ('booking_channel_calendar_snapshots','booking_channel_manager_connections')
    ) AS required_fk(source_table, target_table)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE contype = 'f'
        AND conrelid = to_regclass(format('public.%I', fk.source_table))
        AND confrelid = to_regclass(format('public.%I', fk.target_table))
    ) THEN
      RAISE EXCEPTION 'missing key FK: % -> %', fk.source_table, fk.target_table;
    END IF;
  END LOOP;
END
$verify$;
SQL

echo 'SCHEMA_FK_INDEX_RLS_GRANTS PASS criticalTables=27'
