-- Guest Lifecycle synthetic cleanup: production UUID/TEXT compatibility repair.
--
-- Production stores public.tg_guest_reservations.id as UUID while the cleanup
-- RPC intentionally accepts p_reservation_id as TEXT because lifecycle,
-- booking_id, reservation_ref, and scope_ref seams use text identifiers.
-- The synthetic manifest guarantees p_reservation_id =
-- p_booking_ops_record_id::text, so UUID primary-key lookups must use the
-- existing p_booking_ops_record_id UUID parameter instead of p_reservation_id.
--
-- Patch only the four tg_guest_reservations primary-key references in the
-- currently installed function. Fail closed if the expected function shape is
-- not present, rather than silently changing an unexpected definition.

DO $repair$
DECLARE
  v_signature regprocedure :=
    'public.cleanup_guest_lifecycle_synthetic_acceptance(text,uuid,text,text,text,uuid,uuid[],boolean,text)'::regprocedure;
  v_definition text;
  v_patched text;
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'guest_lifecycle_cleanup_function_missing';
  END IF;

  v_patched := v_definition;

  -- Ownership lookup: tg_guest_reservations.id is UUID.
  v_patched := replace(
    v_patched,
    E'FROM public.tg_guest_reservations\n   WHERE id = p_reservation_id;',
    E'FROM public.tg_guest_reservations\n   WHERE id = p_booking_ops_record_id;'
  );

  -- Preview and final residue counts: tg_guest_reservations.id is UUID.
  v_patched := replace(
    v_patched,
    'FROM public.tg_guest_reservations WHERE id = p_reservation_id',
    'FROM public.tg_guest_reservations WHERE id = p_booking_ops_record_id'
  );

  -- Exact owned-row deletion: tg_guest_reservations.id is UUID.
  v_patched := replace(
    v_patched,
    E'DELETE FROM public.tg_guest_reservations\n   WHERE id = p_reservation_id AND pilot_acceptance_marker = p_run_id;',
    E'DELETE FROM public.tg_guest_reservations\n   WHERE id = p_booking_ops_record_id AND pilot_acceptance_marker = p_run_id;'
  );

  IF v_patched = v_definition THEN
    RAISE EXCEPTION 'guest_lifecycle_cleanup_uuid_patch_not_applied';
  END IF;

  IF v_patched LIKE '%tg_guest_reservations WHERE id = p_reservation_id%'
     OR v_patched LIKE E'%FROM public.tg_guest_reservations\n   WHERE id = p_reservation_id;%'
     OR v_patched LIKE E'%DELETE FROM public.tg_guest_reservations\n   WHERE id = p_reservation_id AND%' THEN
    RAISE EXCEPTION 'guest_lifecycle_cleanup_uuid_patch_incomplete';
  END IF;

  EXECUTE v_patched;
END
$repair$;

REVOKE ALL ON FUNCTION public.cleanup_guest_lifecycle_synthetic_acceptance(TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID[], BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_guest_lifecycle_synthetic_acceptance(TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID[], BOOLEAN, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';