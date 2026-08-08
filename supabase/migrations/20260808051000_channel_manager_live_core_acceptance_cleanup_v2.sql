-- Channel Manager Live Core acceptance cleanup v2.
-- Service-role-only SECURITY DEFINER RPC for removing deterministic synthetic
-- acceptance execution artifacts without granting DELETE on append-only tables.
-- The reusable synthetic owner/property/connection contour is intentionally preserved.

CREATE OR REPLACE FUNCTION public.channel_manager_live_core_acceptance_ops_cleanup_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.booking_ops_records%ROWTYPE;
  v_target_count integer := 0;
  v_deleted_parents integer := 0;
  v_deleted_drafts integer := 0;
  v_deleted_imported_bookings integer := 0;
  v_deleted_imported_objects integer := 0;
  v_deleted_calendar integer := 0;
  v_deleted_intake integer := 0;
  v_deleted_holds integer := 0;
  v_deleted_checks integer := 0;
  v_deleted_reservation_rows integer := 0;
  v_deleted_reconciliation integer := 0;
  v_deleted_ledger integer := 0;
  v_deliveries bigint := 0;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '20s', true);

  -- Fail closed if the deterministic setup identity has drifted into ordinary data.
  IF EXISTS (
    SELECT 1
    FROM public.booking_property_setup_profiles p
    WHERE p.property_id = 'asi-live-core-acceptance-v1'
      AND coalesce(p.metadata->>'acceptanceHarness', '') IS DISTINCT FROM 'channel_manager_live_core_v1'
  ) THEN
    RETURN jsonb_build_object('status','blocked','blocker','property_setup_identity_mismatch');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_channel_manager_connections c
    JOIN public.booking_property_setup_profiles p ON p.id = c.property_setup_id
    WHERE p.property_id = 'asi-live-core-acceptance-v1'
      AND c.provider = 'manual'
      AND coalesce(c.metadata->>'acceptanceHarness', '') IS DISTINCT FROM 'channel_manager_live_core_v1'
  ) THEN
    RETURN jsonb_build_object('status','blocked','blocker','connection_identity_mismatch');
  END IF;

  SELECT count(*) INTO v_target_count
  FROM public.booking_ops_records
  WHERE property_id = 'asi-live-core-acceptance-v1'
    AND booking_id = 'asi-lc-accept-book-v1';

  FOR r IN
    SELECT *
    FROM public.booking_ops_records
    WHERE property_id = 'asi-live-core-acceptance-v1'
      AND booking_id = 'asi-lc-accept-book-v1'
    FOR UPDATE
  LOOP
    IF r.guest_name IS DISTINCT FROM 'Тестовый Гость ASI'
       OR r.ota_source IS DISTINCT FROM 'channel_manager'
       OR coalesce(r.reservation_metadata->>'acceptanceHarness', '') IS DISTINCT FROM 'channel_manager_live_core_v1'
       OR r.account_id IS NOT NULL
       OR coalesce(r.guest_phone, '') <> ''
       OR coalesce(r.guest_email, '') <> ''
       OR coalesce(r.guest_telegram, '') <> '' THEN
      RETURN jsonb_build_object('status','blocked','blocker','acceptance_booking_identity_or_safety_mismatch');
    END IF;

    SELECT count(*) INTO v_deliveries
    FROM public.booking_ops_communication_deliveries d
    JOIN public.booking_ops_communication_intents i ON i.id = d.communication_intent_id
    WHERE i.booking_ops_record_id = r.id;
    IF v_deliveries <> 0 THEN
      RETURN jsonb_build_object('status','blocked','blocker','communication_deliveries_present');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.reservation_source_links
      WHERE booking_ops_record_id = r.id
    ) THEN
      RETURN jsonb_build_object('status','blocked','blocker','reservation_source_links_present');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.booking_channel_imported_bookings
      WHERE matched_booking_id = r.id
        AND external_booking_id IS DISTINCT FROM 'asi-lc-accept-book-v1'
    ) THEN
      RETURN jsonb_build_object('status','blocked','blocker','foreign_imported_booking_match_present');
    END IF;

    -- NO ACTION drafts may only be untouched internal drafts. Anything copied/sent/targeted blocks.
    IF EXISTS (
      SELECT 1
      FROM public.booking_ops_telegram_drafts
      WHERE booking_ops_record_id = r.id
        AND (
          status IS DISTINCT FROM 'draft'
          OR telegram_chat_id IS NOT NULL
          OR coalesce(telegram_target, '') <> ''
        )
    ) THEN
      RETURN jsonb_build_object('status','blocked','blocker','telegram_draft_not_pristine');
    END IF;
  END LOOP;

  -- Synthetic intake idempotency row must go before the next acceptance execution.
  DELETE FROM public.booking_inbound_intake_events
  WHERE source = 'channel_manager_placeholder'
    AND property_id = 'asi-live-core-acceptance-v1'
    AND (
      source_ref = 'asi-lc-accept-book-v1'
      OR idempotency_key = 'ext:channel_manager_placeholder:asi-lc-accept-book-v1'
    );
  GET DIAGNOSTICS v_deleted_intake = ROW_COUNT;

  -- Clear exact reservation artifacts while parent IDs are still available.
  DELETE FROM public.reservation_import_rows
  WHERE booking_ops_record_id IN (
    SELECT id FROM public.booking_ops_records
    WHERE property_id = 'asi-live-core-acceptance-v1'
      AND booking_id = 'asi-lc-accept-book-v1'
      AND coalesce(reservation_metadata->>'acceptanceHarness','') = 'channel_manager_live_core_v1'
  );
  GET DIAGNOSTICS v_deleted_reservation_rows = ROW_COUNT;

  DELETE FROM public.reservation_reconciliation_items
  WHERE booking_ops_record_id IN (
    SELECT id FROM public.booking_ops_records
    WHERE property_id = 'asi-live-core-acceptance-v1'
      AND booking_id = 'asi-lc-accept-book-v1'
      AND coalesce(reservation_metadata->>'acceptanceHarness','') = 'channel_manager_live_core_v1'
  );
  GET DIAGNOSTICS v_deleted_reconciliation = ROW_COUNT;

  DELETE FROM public.reservation_ledger_audit
  WHERE booking_ops_record_id IN (
    SELECT id FROM public.booking_ops_records
    WHERE property_id = 'asi-live-core-acceptance-v1'
      AND booking_id = 'asi-lc-accept-book-v1'
      AND coalesce(reservation_metadata->>'acceptanceHarness','') = 'channel_manager_live_core_v1'
  );
  GET DIAGNOSTICS v_deleted_ledger = ROW_COUNT;

  DELETE FROM public.booking_availability_holds
  WHERE property_id = 'asi-live-core-acceptance-v1'
     OR booking_id IN (
       SELECT id FROM public.booking_ops_records
       WHERE property_id = 'asi-live-core-acceptance-v1'
         AND booking_id = 'asi-lc-accept-book-v1'
         AND coalesce(reservation_metadata->>'acceptanceHarness','') = 'channel_manager_live_core_v1'
     );
  GET DIAGNOSTICS v_deleted_holds = ROW_COUNT;

  DELETE FROM public.booking_overbooking_conflict_checks
  WHERE property_id = 'asi-live-core-acceptance-v1'
     OR booking_id IN (
       SELECT id FROM public.booking_ops_records
       WHERE property_id = 'asi-live-core-acceptance-v1'
         AND booking_id = 'asi-lc-accept-book-v1'
         AND coalesce(reservation_metadata->>'acceptanceHarness','') = 'channel_manager_live_core_v1'
     );
  GET DIAGNOSTICS v_deleted_checks = ROW_COUNT;

  -- Telegram drafts are the reviewed NO ACTION edge.
  DELETE FROM public.booking_ops_telegram_drafts
  WHERE source_booking_id = 'asi-lc-accept-book-v1'
     OR booking_ops_record_id IN (
       SELECT id FROM public.booking_ops_records
       WHERE property_id = 'asi-live-core-acceptance-v1'
         AND booking_id = 'asi-lc-accept-book-v1'
         AND coalesce(reservation_metadata->>'acceptanceHarness','') = 'channel_manager_live_core_v1'
     );
  GET DIAGNOSTICS v_deleted_drafts = ROW_COUNT;

  -- Exact imported snapshot artifacts for the preserved harness connection.
  DELETE FROM public.booking_channel_imported_bookings b
  WHERE b.external_booking_id = 'asi-lc-accept-book-v1'
    AND b.connection_id IN (
      SELECT c.id
      FROM public.booking_channel_manager_connections c
      JOIN public.booking_property_setup_profiles p ON p.id = c.property_setup_id
      WHERE p.property_id = 'asi-live-core-acceptance-v1'
        AND c.provider = 'manual'
        AND coalesce(c.metadata->>'acceptanceHarness','') = 'channel_manager_live_core_v1'
    );
  GET DIAGNOSTICS v_deleted_imported_bookings = ROW_COUNT;

  DELETE FROM public.booking_channel_calendar_snapshots s
  WHERE s.external_object_id = 'asi-lc-accept-obj-v1'
    AND s.connection_id IN (
      SELECT c.id
      FROM public.booking_channel_manager_connections c
      JOIN public.booking_property_setup_profiles p ON p.id = c.property_setup_id
      WHERE p.property_id = 'asi-live-core-acceptance-v1'
        AND c.provider = 'manual'
        AND coalesce(c.metadata->>'acceptanceHarness','') = 'channel_manager_live_core_v1'
    );
  GET DIAGNOSTICS v_deleted_calendar = ROW_COUNT;

  DELETE FROM public.booking_channel_imported_objects o
  WHERE o.external_object_id = 'asi-lc-accept-obj-v1'
    AND o.connection_id IN (
      SELECT c.id
      FROM public.booking_channel_manager_connections c
      JOIN public.booking_property_setup_profiles p ON p.id = c.property_setup_id
      WHERE p.property_id = 'asi-live-core-acceptance-v1'
        AND c.provider = 'manual'
        AND coalesce(c.metadata->>'acceptanceHarness','') = 'channel_manager_live_core_v1'
    );
  GET DIAGNOSTICS v_deleted_imported_objects = ROW_COUNT;

  -- CASCADE children, including append-only booking_ops_events, are removed by PostgreSQL
  -- under the function owner's privilege. Normal rows never receive DELETE grants.
  DELETE FROM public.booking_ops_records
  WHERE property_id = 'asi-live-core-acceptance-v1'
    AND booking_id = 'asi-lc-accept-book-v1'
    AND guest_name = 'Тестовый Гость ASI'
    AND ota_source = 'channel_manager'
    AND account_id IS NULL
    AND coalesce(guest_phone, '') = ''
    AND coalesce(guest_email, '') = ''
    AND coalesce(guest_telegram, '') = ''
    AND coalesce(reservation_metadata->>'acceptanceHarness', '') = 'channel_manager_live_core_v1';
  GET DIAGNOSTICS v_deleted_parents = ROW_COUNT;

  IF v_deleted_parents <> v_target_count THEN
    RAISE EXCEPTION 'acceptance_cleanup_parent_count_mismatch expected=% actual=%', v_target_count, v_deleted_parents;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_ops_records
    WHERE property_id = 'asi-live-core-acceptance-v1'
      AND booking_id = 'asi-lc-accept-book-v1'
  ) THEN
    RAISE EXCEPTION 'acceptance_cleanup_parent_remains';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_channel_imported_bookings
    WHERE external_booking_id = 'asi-lc-accept-book-v1'
      AND connection_id IN (
        SELECT c.id FROM public.booking_channel_manager_connections c
        JOIN public.booking_property_setup_profiles p ON p.id = c.property_setup_id
        WHERE p.property_id = 'asi-live-core-acceptance-v1'
          AND c.provider = 'manual'
          AND coalesce(c.metadata->>'acceptanceHarness','') = 'channel_manager_live_core_v1'
      )
  ) THEN
    RAISE EXCEPTION 'acceptance_cleanup_imported_booking_remains';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_inbound_intake_events
    WHERE source = 'channel_manager_placeholder'
      AND property_id = 'asi-live-core-acceptance-v1'
      AND (source_ref = 'asi-lc-accept-book-v1' OR idempotency_key = 'ext:channel_manager_placeholder:asi-lc-accept-book-v1')
  ) THEN
    RAISE EXCEPTION 'acceptance_cleanup_intake_remains';
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_target_count = 0 THEN 'already_clean' ELSE 'passed' END,
    'blocker', null,
    'contourPreserved', true,
    'deletedBookingOpsRecords', v_deleted_parents,
    'deletedTelegramDrafts', v_deleted_drafts,
    'deletedImportedBookings', v_deleted_imported_bookings,
    'deletedImportedObjects', v_deleted_imported_objects,
    'deletedCalendarRows', v_deleted_calendar,
    'deletedIntakeEvents', v_deleted_intake,
    'deletedAvailabilityHolds', v_deleted_holds,
    'deletedOverbookingChecks', v_deleted_checks,
    'deletedReservationImportRows', v_deleted_reservation_rows,
    'deletedReservationReconciliationItems', v_deleted_reconciliation,
    'deletedReservationLedgerAudit', v_deleted_ledger
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_live_core_acceptance_ops_cleanup_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.channel_manager_live_core_acceptance_ops_cleanup_v2() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_live_core_acceptance_ops_cleanup_v2() TO service_role;

NOTIFY pgrst, 'reload schema';