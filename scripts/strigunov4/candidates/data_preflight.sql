-- Run on disposable restored database first. Aggregate counts only; no row identities.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='60s';
SELECT 'non_global_scopes_disabled_by_migration' AS check_name,count(*) AS affected
FROM public.booking_ops_communication_auto_send_scopes WHERE scope_type<>'global';
SELECT 'intake_booking_backfill' AS check_name,count(*) AS affected
FROM public.booking_inbound_intake_events e JOIN public.booking_ops_records b ON e.booking_id=b.id JOIN public.accounts a ON a.id::text=b.account_id;
SELECT 'intake_property_backfill' AS check_name,count(*) AS affected
FROM public.booking_inbound_intake_events e JOIN public.properties p ON e.property_id=p.id::text WHERE e.booking_id IS NULL AND p.account_id IS NOT NULL;
SELECT 'ambiguous_booking_scope' AS check_name,count(*) AS affected FROM (
SELECT s.id FROM public.booking_ops_communication_auto_send_scopes s
JOIN public.booking_ops_records b ON s.scope_type='booking' AND (s.scope_ref=b.id::text OR s.scope_ref=b.booking_id)
JOIN public.accounts a ON a.id::text=b.account_id GROUP BY s.id HAVING count(DISTINCT a.id)>1) x;
SELECT 'holds_booking_backfill' AS check_name,count(*) AS affected FROM public.booking_availability_holds h JOIN public.booking_ops_records b ON h.booking_id=b.id WHERE h.account_id IS NULL AND b.account_id IS NOT NULL;
SELECT 'blocks_property_backfill' AS check_name,count(*) AS affected FROM public.booking_availability_blocks b JOIN public.properties p ON b.property_id=p.id::text WHERE b.account_id IS NULL AND p.account_id IS NOT NULL;
SELECT 'purpose_constraint_definition' AS check_name,pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid='public.booking_ops_communication_intents'::regclass AND conname='booking_ops_communication_purpose_check';
ROLLBACK;
