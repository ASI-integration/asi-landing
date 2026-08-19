\pset pager off
\pset footer off
\pset tuples_only on
\pset format unaligned

BEGIN TRANSACTION READ ONLY;

DO $commercial_mvp_repair_precheck$
DECLARE
  receipt_history integer;
  property_history integer;
  receipt_rls boolean;
  receipt_force_rls boolean;
  secured_functions integer;
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'commercial_mvp_repair_read_only_guard_failed';
  END IF;

  SELECT count(*) INTO receipt_history
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260817090000';
  IF receipt_history <> 0 THEN
    RAISE EXCEPTION 'commercial_mvp_receipt_history_already_registered';
  END IF;

  SELECT count(*) INTO property_history
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260819110000';
  IF property_history <> 0 THEN
    RAISE EXCEPTION 'commercial_mvp_property_contract_history_already_registered';
  END IF;

  IF to_regclass('public.telegram_inbound_receipts') IS NULL THEN
    RAISE EXCEPTION 'commercial_mvp_receipt_table_missing';
  END IF;

  IF to_regprocedure('public.claim_telegram_inbound_receipt(text,bigint,text,bigint,bigint,jsonb,text,text,text,uuid)') IS NULL
     OR to_regprocedure('public.claim_telegram_inbound_receipt_retry(uuid,text,text,uuid)') IS NULL
     OR to_regprocedure('public.complete_telegram_inbound_receipt(uuid,uuid,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'commercial_mvp_receipt_rpc_missing';
  END IF;

  SELECT relrowsecurity, relforcerowsecurity
  INTO receipt_rls, receipt_force_rls
  FROM pg_class
  WHERE oid = 'public.telegram_inbound_receipts'::regclass;
  IF receipt_rls IS DISTINCT FROM true OR receipt_force_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'commercial_mvp_receipt_rls_contract_failed';
  END IF;

  IF has_table_privilege('anon', 'public.telegram_inbound_receipts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.telegram_inbound_receipts', 'SELECT')
     OR has_function_privilege('anon', 'public.claim_telegram_inbound_receipt(text,bigint,text,bigint,bigint,jsonb,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_telegram_inbound_receipt(text,bigint,text,bigint,bigint,jsonb,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.claim_telegram_inbound_receipt_retry(uuid,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_telegram_inbound_receipt_retry(uuid,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.complete_telegram_inbound_receipt(uuid,uuid,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.complete_telegram_inbound_receipt(uuid,uuid,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'commercial_mvp_receipt_public_privilege_present';
  END IF;

  SELECT count(*) INTO secured_functions
  FROM pg_proc
  WHERE oid IN (
    to_regprocedure('public.claim_telegram_inbound_receipt(text,bigint,text,bigint,bigint,jsonb,text,text,text,uuid)'),
    to_regprocedure('public.claim_telegram_inbound_receipt_retry(uuid,text,text,uuid)'),
    to_regprocedure('public.complete_telegram_inbound_receipt(uuid,uuid,text,text,text,text)')
  )
    AND prosecdef = true;
  IF secured_functions <> 3 THEN
    RAISE EXCEPTION 'commercial_mvp_receipt_security_definer_contract_failed';
  END IF;

  IF to_regclass('public.tg_property_knowledge') IS NULL THEN
    RAISE EXCEPTION 'commercial_mvp_property_knowledge_missing';
  END IF;
END
$commercial_mvp_repair_precheck$;

SELECT 'COMMERCIAL_MVP_REPAIR_PRECHECK=PASS';
ROLLBACK;
