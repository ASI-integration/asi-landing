-- Guest Lifecycle synthetic cleanup: remaining UUID/TEXT comparison repair.
--
-- The prior compatibility repair updated preview/final residue counts but the
-- installed function still retained two tg_guest_reservations primary-key
-- comparisons against p_reservation_id TEXT. Production stores
-- tg_guest_reservations.id as UUID, and the synthetic manifest guarantees
-- p_reservation_id = p_booking_ops_record_id::text. Patch those two remaining
-- primary-key references to the existing UUID parameter.

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

  -- Ownership lookup. Use a whitespace-tolerant replacement because
  -- pg_get_functiondef normalizes indentation. [.] avoids backslash escaping
  -- ambiguity under standard_conforming_strings.
  v_patched := regexp_replace(
    v_patched,
    'FROM public[.]tg_guest_reservations[[:space:]]+WHERE id = p_reservation_id;',
    E'FROM public.tg_guest_reservations\n   WHERE id = p_booking_ops_record_id;',
    'g'
  );

  -- Exact owned-row deletion.
  v_patched := regexp_replace(
    v_patched,
    'DELETE FROM public[.]tg_guest_reservations[[:space:]]+WHERE id = p_reservation_id AND pilot_acceptance_marker = p_run_id;',
    E'DELETE FROM public.tg_guest_reservations\n   WHERE id = p_booking_ops_record_id AND pilot_acceptance_marker = p_run_id;',
    'g'
  );

  IF v_patched = v_definition THEN
    RAISE EXCEPTION 'guest_lifecycle_cleanup_remaining_uuid_patch_not_applied';
  END IF;

  IF v_patched ~ 'FROM public[.]tg_guest_reservations[[:space:]]+WHERE id = p_reservation_id;'
     OR v_patched ~ 'DELETE FROM public[.]tg_guest_reservations[[:space:]]+WHERE id = p_reservation_id AND pilot_acceptance_marker = p_run_id;' THEN
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
