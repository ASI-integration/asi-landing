#!/usr/bin/env bash
# TEMPORARY read-only staging row verification for PR #318 LIVE STAGING E2E resume.
# Uses STAGING_DATABASE_URL only. Never prints secrets, passwords, wifi, or access notes.
set -euo pipefail

: "${STAGING_DATABASE_URL:?STAGING_DATABASE_URL required}"
: "${STAGING_SUPABASE_PROJECT_REF:?STAGING_SUPABASE_PROJECT_REF required}"

EMAIL="${E2E_EMAIL:-asi.ru.e2e.20260920115458@example.com}"
USER_ID="${E2E_USER_ID:-0ec65355-2195-4daf-a84d-68207f6a9bbc}"
MARKER="${E2E_MARKER:-RU_E2E_20260920115458}"
ARTIFACT="${STAGING_E2E_ROW_DIAGNOSTIC_ARTIFACT:-staging-e2e-ru-connect-row-diagnostic.txt}"

echo "::add-mask::${STAGING_DATABASE_URL}"

python3 - <<'PY'
import os, re
from urllib.parse import unquote, urlparse
raw = os.environ["STAGING_DATABASE_URL"]
expected = os.environ["STAGING_SUPABASE_PROJECT_REF"].strip().lower()
if not re.fullmatch(r"[a-z0-9]{20}", expected):
    raise SystemExit("invalid STAGING_SUPABASE_PROJECT_REF")
u = urlparse(raw)
host = (u.hostname or "").lower()
user = unquote(u.username or "").lower()
direct = host == f"db.{expected}.supabase.co"
pooler = host.endswith(".pooler.supabase.com") and user == f"postgres.{expected}"
if not (direct or pooler):
    raise SystemExit("Staging database identity does not match STAGING_SUPABASE_PROJECT_REF")
print(f"expected_project_ref={expected}")
print("STAGING_IDENTITY_CHECK=PASS")
PY

export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000"

SQL=$(cat <<'SQL'
BEGIN;
SELECT '=== READ_ONLY_GUARD ===' AS section;
SHOW transaction_read_only;

SELECT '=== USER ===' AS section;
SELECT id::text AS user_id,
       (email = :'email') AS email_match,
       (id::text = :'user_id') AS id_match
FROM public.users
WHERE email = :'email' OR id::text = :'user_id';

SELECT '=== ACCOUNT_MEMBER ===' AS section;
SELECT am.account_id::text AS account_id,
       am.user_id::text AS user_id,
       am.role::text AS role
FROM public.account_members am
JOIN public.users u ON u.id = am.user_id
WHERE u.email = :'email' OR u.id::text = :'user_id';

SELECT '=== ACCOUNTS ===' AS section;
SELECT a.id::text AS account_id
FROM public.accounts a
JOIN public.account_members am ON am.account_id = a.id
JOIN public.users u ON u.id = am.user_id
WHERE u.email = :'email' OR u.id::text = :'user_id';

SELECT '=== ONBOARDING ===' AS section;
SELECT o.account_id::text AS account_id,
       (o.data ? 'rentalConnection') AS has_rental_connection,
       (o.data->'rentalConnection'->>'manager') AS manager,
       (o.data->'rentalConnection'->'channels')::text AS channels,
       (o.data->'rentalConnection'->>'step') AS draft_step,
       (o.data->'rentalConnection'->>'name') AS object_name
FROM public.ops_v17_onboardings o
JOIN public.account_members am ON am.account_id = o.account_id
JOIN public.users u ON u.id = am.user_id
WHERE u.email = :'email' OR u.id::text = :'user_id';

SELECT '=== PROPERTIES ===' AS section;
SELECT p.id::text AS property_id,
       p.account_id::text AS account_id,
       p.name AS property_name,
       (p.address_line IS NOT NULL AND length(p.address_line) > 0) AS has_address,
       count(*) OVER () AS property_count
FROM public.properties p
JOIN public.account_members am ON am.account_id = p.account_id
JOIN public.users u ON u.id = am.user_id
WHERE u.email = :'email' OR u.id::text = :'user_id';

SELECT '=== KNOWLEDGE ===' AS section;
SELECT k.property_id::text AS property_id,
       k.object_name,
       (k.wifi_name IS NOT NULL) AS has_wifi_name,
       (k.wifi_password IS NOT NULL AND length(k.wifi_password) > 0) AS has_wifi_password,
       (k.access_notes IS NOT NULL AND length(k.access_notes) > 0) AS has_access_notes,
       k.booking_channels,
       k.photos_deferred,
       count(*) OVER () AS knowledge_count
FROM public.tg_property_knowledge k
JOIN public.properties p ON p.id::text = k.property_id::text
JOIN public.account_members am ON am.account_id = p.account_id
JOIN public.users u ON u.id = am.user_id
WHERE u.email = :'email' OR u.id::text = :'user_id';

SELECT '=== LIFECYCLE ===' AS section;
SELECT l.id::text AS lifecycle_id,
       l.account_id::text AS account_id,
       l.property_id::text AS property_id,
       l.status,
       (l.setup_started_at IS NOT NULL) AS setup_started_at_present,
       (l.ready_at IS NULL) AS ready_at_null,
       (l.pilot_started_at IS NULL) AS pilot_started_at_null,
       (l.pilot_ends_at IS NULL) AS pilot_ends_at_null,
       (l.pilot_completed_at IS NULL) AS pilot_completed_at_null,
       count(*) OVER () AS lifecycle_count
FROM public.ru_commercial_pilot_lifecycle l
JOIN public.account_members am ON am.account_id = l.account_id
JOIN public.users u ON u.id = am.user_id
WHERE u.email = :'email' OR u.id::text = :'user_id';

SELECT '=== OPERATOR_TASK ===' AS section;
WITH ids AS (
  SELECT am.account_id, p.id AS property_id
  FROM public.account_members am
  JOIN public.users u ON u.id = am.user_id
  JOIN public.properties p ON p.account_id = am.account_id
  WHERE u.email = :'email' OR u.id::text = :'user_id'
),
knowledge AS (
  SELECT k.property_id::text AS property_id,
         nullif(k.wifi_password, '') AS wifi_password,
         nullif(k.access_notes, '') AS access_notes
  FROM public.tg_property_knowledge k
  JOIN ids ON k.property_id::text = ids.property_id::text
)
SELECT t.id::text AS task_id,
       t.task_type,
       t.task_status,
       t.source,
       t.dedup_key,
       (t.metadata->>'integration') AS metadata_integration,
       (coalesce(t.description,'') ILIKE '%Bnovo%' OR coalesce(t.description,'') ILIKE '%bnovo%') AS desc_has_bnovo,
       (
         coalesce(t.description,'') ILIKE '%Свой сайт%'
         OR coalesce(t.description,'') ILIKE '%соцсети%'
         OR coalesce(t.description,'') ILIKE '%direct%'
       ) AS desc_has_channels,
       (
         k.wifi_password IS NOT NULL
         AND (
           position(k.wifi_password in coalesce(t.description,'')) > 0
           OR position(k.wifi_password in coalesce(t.metadata::text,'')) > 0
         )
       ) AS leaks_wifi_password,
       (
         k.access_notes IS NOT NULL
         AND (
           position(k.access_notes in coalesce(t.description,'')) > 0
           OR position(k.access_notes in coalesce(t.metadata::text,'')) > 0
         )
       ) AS leaks_guest_access_instructions,
       (
         coalesce(t.metadata::text,'') ILIKE '%session%'
         OR coalesce(t.metadata::text,'') ILIKE '%refresh_token%'
         OR coalesce(t.metadata::text,'') ILIKE '%access_token%'
         OR coalesce(t.metadata::text,'') ILIKE '%password%'
         OR coalesce(t.description,'') ILIKE '%password%'
         OR coalesce(t.description,'') ILIKE '%пароль%'
       ) AS leaks_auth_or_password_fields,
       count(*) OVER () AS dedup_count
FROM public.ops_operator_tasks t
JOIN ids ON t.dedup_key = 'ru-owner-connect:' || ids.account_id::text || ':' || ids.property_id::text
LEFT JOIN knowledge k ON k.property_id = ids.property_id::text;

SELECT '=== DUPLICATE_COUNTS ===' AS section;
WITH ids AS (
  SELECT am.account_id
  FROM public.account_members am
  JOIN public.users u ON u.id = am.user_id
  WHERE u.email = :'email' OR u.id::text = :'user_id'
  LIMIT 1
)
SELECT
  (SELECT count(*) FROM public.properties p, ids WHERE p.account_id = ids.account_id) AS property_rows,
  (SELECT count(*) FROM public.ru_commercial_pilot_lifecycle l, ids WHERE l.account_id = ids.account_id) AS lifecycle_rows,
  (SELECT count(*) FROM public.ops_operator_tasks t
     JOIN public.properties p ON t.object_id = p.id::text
     JOIN ids ON p.account_id = ids.account_id
    WHERE t.task_type = 'verify_channel_manager'
      AND t.dedup_key LIKE 'ru-owner-connect:' || ids.account_id::text || ':%') AS verify_channel_manager_rows;

SELECT '=== MARKER_SANITY ===' AS section;
SELECT :'marker' AS marker, :'email' AS email;

ROLLBACK;
SQL
)

{
  echo "BEGIN"
  echo "marker=${MARKER}"
  echo "email=${EMAIL}"
  echo "user_id=${USER_ID}"
  psql "$STAGING_DATABASE_URL" \
    -v ON_ERROR_STOP=1 \
    -v email="$EMAIL" \
    -v user_id="$USER_ID" \
    -v marker="$MARKER" \
    -P pager=off \
    -c "$SQL"
  echo "END"
} | tee "$ARTIFACT"

echo "STAGING_E2E_ROW_DIAGNOSTIC=PASS"
