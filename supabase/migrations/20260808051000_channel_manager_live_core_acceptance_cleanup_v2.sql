-- Channel Manager Live Core acceptance cleanup v2.
-- Service-role-only SECURITY DEFINER RPC for deleting only the deterministic synthetic
-- Booking Ops subtree. Normal Booking Ops rows remain append-only through PostgREST.

CREATE OR REPLACE FUNCTION public.channel_manager_live_core_acceptance_ops_cleanup_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.booking_ops_records%ROWTYPE;
  v_target_count integer := 0;
  v_deleted integer := 0;
  v_deliveries bigint := 0;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '15s', true);

  SELECT count(*) INTO v_target_count
  FROM public.booking_ops_records
  WHERE property_id = 'asi-live-core-acceptance-v1'
    AND booking_id = 'asi-lc-accept-book-v1';

  IF v_target_count = 0 THEN
    RETURN jsonb_build_object(
      'status', 'already_clean',
      'deletedBookingOpsRecords', 0,
      'blocker', null
    );
  END IF;

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
      RETURN jsonb_build_object(
        'status', 'blocked',
        'deletedBookingOpsRecords', 0,
        'blocker', 'acceptance_booking_identity_or_safety_mismatch'
      );
    END IF;

    SELECT count(*) INTO v_deliveries
    FROM public.booking_ops_communication_deliveries d
    JOIN public.booking_ops_communication_intents i
      ON i.id = d.communication_intent_id
    WHERE i.booking_ops_record_id = r.id;

    IF v_deliveries <> 0 THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'deletedBookingOpsRecords', 0,
        'blocker', 'communication_deliveries_present'
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.reservation_source_links
      WHERE booking_ops_record_id = r.id
    ) THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'deletedBookingOpsRecords', 0,
        'blocker', 'reservation_source_links_present'
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.booking_channel_imported_bookings
      WHERE matched_booking_id = r.id
        AND external_booking_id IS DISTINCT FROM 'asi-lc-accept-book-v1'
    ) THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'deletedBookingOpsRecords', 0,
        'blocker', 'foreign_imported_booking_match_present'
      );
    END IF;

    -- Telegram drafts use NO ACTION rather than CASCADE. Only untouched internal drafts
    -- may be removed here; anything copied/sent/targeted blocks cleanup.
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
      RETURN jsonb_build_object(
        'status', 'blocked',
        'deletedBookingOpsRecords', 0,
        'blocker', 'telegram_draft_not_pristine'
      );
    END IF;
  END LOOP;

  DELETE FROM public.booking_ops_telegram_drafts d
  USING public.booking_ops_records b
  WHERE d.booking_ops_record_id = b.id
    AND b.property_id = 'asi-live-core-acceptance-v1'
    AND b.booking_id = 'asi-lc-accept-book-v1'
    AND b.guest_name = 'Тестовый Гость ASI'
    AND coalesce(b.reservation_metadata->>'acceptanceHarness', '') = 'channel_manager_live_core_v1';

  -- All remaining direct Booking Ops children are handled by their reviewed FK actions.
  -- CASCADE children (including append-only booking_ops_events) are deleted by PostgreSQL
  -- under the definer's privilege; SET NULL children remain for the outer harness cleanup.
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

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted <> v_target_count THEN
    RAISE EXCEPTION 'acceptance_cleanup_parent_count_mismatch expected=% actual=%', v_target_count, v_deleted;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_ops_records
    WHERE property_id = 'asi-live-core-acceptance-v1'
      AND booking_id = 'asi-lc-accept-book-v1'
  ) THEN
    RAISE EXCEPTION 'acceptance_cleanup_parent_remains';
  END IF;

  RETURN jsonb_build_object(
    'status', 'passed',
    'deletedBookingOpsRecords', v_deleted,
    'blocker', null
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_live_core_acceptance_ops_cleanup_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.channel_manager_live_core_acceptance_ops_cleanup_v2() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_live_core_acceptance_ops_cleanup_v2() TO service_role;

NOTIFY pgrst, 'reload schema';