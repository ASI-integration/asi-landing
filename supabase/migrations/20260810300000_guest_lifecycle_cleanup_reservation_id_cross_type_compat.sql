-- Guest Lifecycle synthetic cleanup: tg_guest_reservations.id cross-type compatibility.
--
-- Historical clean-install migrations define public.tg_guest_reservations.id as
-- TEXT, while current production stores the same primary key as UUID. The
-- synthetic manifest guarantees p_reservation_id = p_booking_ops_record_id::text.
--
-- Normalize only tg_guest_reservations primary-key predicates to compare through
-- text. This is valid for both TEXT and UUID table shapes and avoids relying on
-- environment-specific schema drift.

DO $repair$
DECLARE
  v_signature regprocedure :=
    'public.cleanup_guest_lifecycle_synthetic_acceptance(text,uuid,text,text,text,uuid,uuid[],boolean,text)'::regprocedure;
  v_definition text;
  v_patched text;
  v_lookup_pattern text :=
    'FROM public\.tg_guest_reservations[[:space:]]+WHERE id[[:space:]]*=[[:space:]]*(p_booking_ops_record_id|p_reservation_id)';
  v_delete_pattern text :=
    'DELETE FROM public\.tg_guest_reservations[[:space:]]+WHERE id[[:space:]]*=[[:space:]]*(p_booking_ops_record_id|p_reservation_id)';
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'guest_lifecycle_cleanup_function_missing';
  END IF;

  v_patched := regexp_replace(
    v_definition,
    v_lookup_pattern,
    E'FROM public.tg_guest_reservations\n   WHERE id::text = p_reservation_id',
    'g'
  );

  v_patched := regexp_replace(
    v_patched,
    v_delete_pattern,
    E'DELETE FROM public.tg_guest_reservations\n   WHERE id::text = p_reservation_id',
    'g'
  );

  IF v_patched = v_definition THEN
    IF v_definition !~ 'FROM public\.tg_guest_reservations[[:space:]]+WHERE id::text[[:space:]]*=[[:space:]]*p_reservation_id'
       OR v_definition !~ 'DELETE FROM public\.tg_guest_reservations[[:space:]]+WHERE id::text[[:space:]]*=[[:space:]]*p_reservation_id' THEN
      RAISE EXCEPTION 'guest_lifecycle_cleanup_reservation_id_cross_type_unexpected_shape';
    END IF;
  ELSE
    IF v_patched ~ v_lookup_pattern OR v_patched ~ v_delete_pattern THEN
      RAISE EXCEPTION 'guest_lifecycle_cleanup_reservation_id_cross_type_patch_incomplete';
    END IF;
    EXECUTE v_patched;
  END IF;
END
$repair$;

REVOKE ALL ON FUNCTION public.cleanup_guest_lifecycle_synthetic_acceptance(TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID[], BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_guest_lifecycle_synthetic_acceptance(TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID[], BOOLEAN, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
