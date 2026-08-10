-- Guest Lifecycle synthetic cleanup: remaining UUID/TEXT comparison repair.
--
-- The installed function still contains exactly two tg_guest_reservations
-- primary-key predicates that compare UUID id to p_reservation_id TEXT.
-- The synthetic manifest guarantees p_reservation_id =
-- p_booking_ops_record_id::text, so those predicates must use the existing UUID
-- parameter. Match the two unique predicate strings directly so formatting in
-- pg_get_functiondef cannot prevent the repair from applying.

DO $repair$
DECLARE
  v_signature regprocedure :=
    'public.cleanup_guest_lifecycle_synthetic_acceptance(text,uuid,text,text,text,uuid,uuid[],boolean,text)'::regprocedure;
  v_definition text;
  v_patched text;
  v_lookup_count integer;
  v_delete_count integer;
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'guest_lifecycle_cleanup_function_missing';
  END IF;

  v_lookup_count := (
    length(v_definition) - length(replace(v_definition, 'WHERE id = p_reservation_id;', ''))
  ) / length('WHERE id = p_reservation_id;');

  v_delete_count := (
    length(v_definition) - length(replace(
      v_definition,
      'WHERE id = p_reservation_id AND pilot_acceptance_marker = p_run_id;',
      ''
    ))
  ) / length('WHERE id = p_reservation_id AND pilot_acceptance_marker = p_run_id;');

  IF v_lookup_count <> 1 OR v_delete_count <> 1 THEN
    RAISE EXCEPTION
      'guest_lifecycle_cleanup_remaining_uuid_unexpected_shape:lookup=% delete=%',
      v_lookup_count,
      v_delete_count;
  END IF;

  v_patched := replace(
    v_definition,
    'WHERE id = p_reservation_id;',
    'WHERE id = p_booking_ops_record_id;'
  );

  v_patched := replace(
    v_patched,
    'WHERE id = p_reservation_id AND pilot_acceptance_marker = p_run_id;',
    'WHERE id = p_booking_ops_record_id AND pilot_acceptance_marker = p_run_id;'
  );

  IF v_patched = v_definition THEN
    RAISE EXCEPTION 'guest_lifecycle_cleanup_remaining_uuid_patch_not_applied';
  END IF;

  IF v_patched LIKE '%WHERE id = p_reservation_id;%'
     OR v_patched LIKE '%WHERE id = p_reservation_id AND pilot_acceptance_marker = p_run_id;%' THEN
    RAISE EXCEPTION 'guest_lifecycle_cleanup_remaining_uuid_patch_incomplete';
  END IF;

  EXECUTE v_patched;
END
$repair$;

REVOKE ALL ON FUNCTION public.cleanup_guest_lifecycle_synthetic_acceptance(TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID[], BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_guest_lifecycle_synthetic_acceptance(TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID[], BOOLEAN, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
