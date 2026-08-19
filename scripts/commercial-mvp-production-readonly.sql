\pset pager off
\pset footer off
\pset tuples_only on
\pset format unaligned

BEGIN TRANSACTION READ ONLY;

DO $commercial_mvp$
DECLARE
  migration_rows integer;
  receipt_rls boolean;
  receipt_force_rls boolean;
  secured_functions integer;
  knowledge_columns integer;
  active_knowledge bigint;
  processed_receipts bigint;
  stale_receipts bigint;
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'commercial_mvp_read_only_guard_failed';
  END IF;

  IF to_regclass('public.telegram_inbound_receipts') IS NULL THEN
    RAISE EXCEPTION 'commercial_mvp_telegram_inbound_receipts_missing';
  END IF;

  SELECT count(*) INTO migration_rows
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260817090000';
  IF migration_rows <> 1 THEN
    RAISE EXCEPTION 'commercial_mvp_telegram_inbound_receipts_history_missing';
  END IF;

  IF to_regprocedure('public.claim_telegram_inbound_receipt(text,bigint,text,bigint,bigint,jsonb,text,text,text,uuid)') IS NULL
     OR to_regprocedure('public.claim_telegram_inbound_receipt_retry(uuid,text,text,uuid)') IS NULL
     OR to_regprocedure('public.complete_telegram_inbound_receipt(uuid,uuid,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'commercial_mvp_telegram_inbound_receipt_rpc_missing';
  END IF;

  SELECT relrowsecurity, relforcerowsecurity
  INTO receipt_rls, receipt_force_rls
  FROM pg_class
  WHERE oid = 'public.telegram_inbound_receipts'::regclass;
  IF receipt_rls IS DISTINCT FROM true OR receipt_force_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'commercial_mvp_telegram_inbound_receipts_rls_not_forced';
  END IF;

  IF has_table_privilege('anon', 'public.telegram_inbound_receipts', 'SELECT')
     OR has_table_privilege('anon', 'public.telegram_inbound_receipts', 'INSERT')
     OR has_table_privilege('anon', 'public.telegram_inbound_receipts', 'UPDATE')
     OR has_table_privilege('anon', 'public.telegram_inbound_receipts', 'DELETE')
     OR has_table_privilege('authenticated', 'public.telegram_inbound_receipts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.telegram_inbound_receipts', 'INSERT')
     OR has_table_privilege('authenticated', 'public.telegram_inbound_receipts', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.telegram_inbound_receipts', 'DELETE') THEN
    RAISE EXCEPTION 'commercial_mvp_telegram_inbound_receipts_public_privilege_present';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.claim_telegram_inbound_receipt(text,bigint,text,bigint,bigint,jsonb,text,text,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_telegram_inbound_receipt(text,bigint,text,bigint,bigint,jsonb,text,text,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.claim_telegram_inbound_receipt_retry(uuid,text,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_telegram_inbound_receipt_retry(uuid,text,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.complete_telegram_inbound_receipt(uuid,uuid,text,text,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.complete_telegram_inbound_receipt(uuid,uuid,text,text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'commercial_mvp_telegram_inbound_receipt_rpc_public_execute_present';
  END IF;

  SELECT count(*) INTO secured_functions
  FROM pg_proc AS procedure_record
  WHERE procedure_record.oid IN (
    to_regprocedure('public.claim_telegram_inbound_receipt(text,bigint,text,bigint,bigint,jsonb,text,text,text,uuid)'),
    to_regprocedure('public.claim_telegram_inbound_receipt_retry(uuid,text,text,uuid)'),
    to_regprocedure('public.complete_telegram_inbound_receipt(uuid,uuid,text,text,text,text)')
  )
    AND procedure_record.prosecdef = true;
  IF secured_functions <> 3 THEN
    RAISE EXCEPTION 'commercial_mvp_telegram_inbound_receipt_rpc_security_contract_failed';
  END IF;

  IF to_regclass('public.tg_property_knowledge') IS NULL THEN
    RAISE EXCEPTION 'commercial_mvp_property_knowledge_table_missing';
  END IF;

  SELECT count(*) INTO knowledge_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'tg_property_knowledge'
    AND column_name IN (
      'property_id',
      'property_policy',
      'house_rules',
      'checkin_instructions',
      'checkout_notes',
      'wifi_instructions',
      'wifi_name',
      'wifi_password',
      'parking_instructions',
      'payment_rules',
      'upsells',
      'emergency_contacts',
      'active'
    );
  IF knowledge_columns <> 13 THEN
    RAISE EXCEPTION 'commercial_mvp_property_knowledge_loader_columns_missing';
  END IF;

  SELECT count(*) INTO active_knowledge
  FROM public.tg_property_knowledge
  WHERE active IS TRUE;
  IF active_knowledge < 1 THEN
    RAISE EXCEPTION 'commercial_mvp_no_active_property_knowledge';
  END IF;

  SELECT count(*) INTO processed_receipts
  FROM public.telegram_inbound_receipts
  WHERE status = 'processed';
  IF processed_receipts < 1 THEN
    RAISE EXCEPTION 'commercial_mvp_durable_inbound_not_exercised';
  END IF;

  SELECT count(*) INTO stale_receipts
  FROM public.telegram_inbound_receipts
  WHERE status = 'processing'
    AND lease_expires_at <= now();
  IF stale_receipts <> 0 THEN
    RAISE EXCEPTION 'commercial_mvp_stale_inbound_receipts_present';
  END IF;
END
$commercial_mvp$;

SELECT 'READ_ONLY_GUARD=PASS';
SELECT 'TELEGRAM_INBOUND_RECEIPTS_SCHEMA=PASS';
SELECT 'TELEGRAM_INBOUND_RECEIPTS_HISTORY=PASS';
SELECT 'TELEGRAM_INBOUND_RECEIPTS_RLS=PASS';
SELECT 'PROPERTY_KNOWLEDGE_SCHEMA=PASS';
SELECT 'PROPERTY_KNOWLEDGE_ACTIVE_COUNT=' || count(*)::text
FROM public.tg_property_knowledge
WHERE active IS TRUE;
SELECT 'TELEGRAM_RECEIPTS_TOTAL=' || count(*)::text
FROM public.telegram_inbound_receipts;
SELECT 'TELEGRAM_RECEIPTS_PROCESSED=' || count(*)::text
FROM public.telegram_inbound_receipts
WHERE status = 'processed';
SELECT 'TELEGRAM_RECEIPTS_FAILED=' || count(*)::text
FROM public.telegram_inbound_receipts
WHERE status = 'failed';
SELECT 'TELEGRAM_RECEIPTS_RETRYABLE=' || count(*)::text
FROM public.telegram_inbound_receipts
WHERE status = 'failed' AND retryable IS TRUE;
SELECT 'TELEGRAM_RECEIPTS_STALE_PROCESSING=' || count(*)::text
FROM public.telegram_inbound_receipts
WHERE status = 'processing' AND lease_expires_at <= now();
SELECT 'COMMERCIAL_MVP_DB_READONLY_ACCEPTANCE=PASS';

ROLLBACK;
