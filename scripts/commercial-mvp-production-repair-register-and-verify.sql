DO $commercial_mvp_repair_register$
DECLARE
  receipt_history integer;
  property_history integer;
  property_contract_columns integer;
BEGIN
  SELECT count(*) INTO receipt_history
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260817090000';
  IF receipt_history <> 0 THEN
    RAISE EXCEPTION 'commercial_mvp_receipt_history_collision';
  END IF;

  SELECT count(*) INTO property_history
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260819110000';
  IF property_history <> 0 THEN
    RAISE EXCEPTION 'commercial_mvp_property_history_collision';
  END IF;

  IF to_regclass('public.telegram_inbound_receipts') IS NULL
     OR to_regprocedure('public.claim_telegram_inbound_receipt(text,bigint,text,bigint,bigint,jsonb,text,text,text,uuid)') IS NULL
     OR to_regprocedure('public.claim_telegram_inbound_receipt_retry(uuid,text,text,uuid)') IS NULL
     OR to_regprocedure('public.complete_telegram_inbound_receipt(uuid,uuid,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'commercial_mvp_receipt_physical_contract_missing';
  END IF;

  SELECT count(*) INTO property_contract_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'tg_property_knowledge'
    AND column_name IN (
      'property_policy',
      'wifi_instructions',
      'parking_instructions',
      'payment_rules',
      'upsells',
      'emergency_contacts'
    );
  IF property_contract_columns <> 6 THEN
    RAISE EXCEPTION 'commercial_mvp_property_contract_columns_missing';
  END IF;

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (
    '20260817090000',
    'telegram_inbound_receipts_v1',
    ARRAY[]::text[]
  );

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (
    '20260819110000',
    'commercial_mvp_property_knowledge_contract_v1',
    ARRAY[]::text[]
  );

  SELECT count(*) INTO receipt_history
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260817090000'
    AND name = 'telegram_inbound_receipts_v1';
  SELECT count(*) INTO property_history
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260819110000'
    AND name = 'commercial_mvp_property_knowledge_contract_v1';

  IF receipt_history <> 1 OR property_history <> 1 THEN
    RAISE EXCEPTION 'commercial_mvp_repair_history_verification_failed';
  END IF;
END
$commercial_mvp_repair_register$;

SELECT 'COMMERCIAL_MVP_REPAIR_SCHEMA=PASS';
SELECT 'COMMERCIAL_MVP_REPAIR_HISTORY=PASS';
