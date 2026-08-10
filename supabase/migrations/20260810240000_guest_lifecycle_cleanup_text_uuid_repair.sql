-- Guest Lifecycle synthetic cleanup: repair accidental TEXT/UUID rewrites.
--
-- An earlier production-only compatibility patch used a suffix-matching regex
-- for `id = p_reservation_id`. That could also match the tail of identifiers
-- such as reservation_id and booking_id, rewriting TEXT predicates to compare
-- against p_booking_ops_record_id UUID.
--
-- Repair only the three TEXT seams that canonical cleanup addresses through
-- p_reservation_id. This migration is intentionally idempotent: on a fresh
-- installation where the earlier migration is already safe, it is a no-op.

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

  -- guest_lifecycle_events.reservation_id is TEXT.
  v_patched := regexp_replace(
    v_patched,
    'public[.]guest_lifecycle_events[[:space:]]+WHERE reservation_id[[:space:]]*=[[:space:]]*p_booking_ops_record_id',
    'public.guest_lifecycle_events WHERE reservation_id = p_reservation_id',
    'g'
  );

  -- booking_lifecycle_gates.booking_id is TEXT.
  v_patched := regexp_replace(
    v_patched,
    'public[.]booking_lifecycle_gates[[:space:]]+WHERE booking_id[[:space:]]*=[[:space:]]*p_booking_ops_record_id',
    'public.booking_lifecycle_gates WHERE booking_id = p_reservation_id',
    'g'
  );

  -- booking_lifecycle_exceptions.booking_id is TEXT.
  v_patched := regexp_replace(
    v_patched,
    'public[.]booking_lifecycle_exceptions[[:space:]]+WHERE booking_id[[:space:]]*=[[:space:]]*p_booking_ops_record_id',
    'public.booking_lifecycle_exceptions WHERE booking_id = p_reservation_id',
    'g'
  );

  IF v_patched ~ 'public[.]guest_lifecycle_events[[:space:]]+WHERE reservation_id[[:space:]]*=[[:space:]]*p_booking_ops_record_id'
     OR v_patched ~ 'public[.]booking_lifecycle_gates[[:space:]]+WHERE booking_id[[:space:]]*=[[:space:]]*p_booking_ops_record_id'
     OR v_patched ~ 'public[.]booking_lifecycle_exceptions[[:space:]]+WHERE booking_id[[:space:]]*=[[:space:]]*p_booking_ops_record_id' THEN
    RAISE EXCEPTION 'guest_lifecycle_cleanup_text_uuid_repair_incomplete';
  END IF;

  IF v_patched IS DISTINCT FROM v_definition THEN
    EXECUTE v_patched;
  END IF;
END
$repair$;

REVOKE ALL ON FUNCTION public.cleanup_guest_lifecycle_synthetic_acceptance(TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID[], BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_guest_lifecycle_synthetic_acceptance(TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID[], BOOLEAN, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
