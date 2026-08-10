-- Guest Lifecycle synthetic cleanup: remaining UUID/TEXT comparison repair.
--
-- Production stores public.tg_guest_reservations.id as UUID while the cleanup
-- RPC accepts p_reservation_id as TEXT. The synthetic manifest guarantees
-- p_reservation_id = p_booking_ops_record_id::text.
--
-- Patch only standalone `id = p_reservation_id` predicates. The leading
-- boundary explicitly excludes identifier characters so suffixes such as
-- booking_id and reservation_id cannot be rewritten accidentally.
--
-- This migration is intentionally idempotent across both historical production
-- drift and clean installs: if the canonical UUID predicate is already present,
-- no rewrite is required.

DO $repair$
DECLARE
  v_signature regprocedure :=
    'public.cleanup_guest_lifecycle_synthetic_acceptance(text,uuid,text,text,text,uuid,uuid[],boolean,text)'::regprocedure;
  v_definition text;
  v_patched text;
  v_bad_pattern text := '(^|[^[:alnum:]_])id[[:space:]]*=[[:space:]]*p_reservation_id';
  v_good_pattern text := '(^|[^[:alnum:]_])id[[:space:]]*=[[:space:]]*p_booking_ops_record_id';
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'guest_lifecycle_cleanup_function_missing';
  END IF;

  v_patched := regexp_replace(
    v_definition,
    v_bad_pattern,
    E'\\1id = p_booking_ops_record_id',
    'g'
  );

  IF v_patched = v_definition THEN
    IF v_definition !~ v_good_pattern THEN
      RAISE EXCEPTION 'guest_lifecycle_cleanup_remaining_uuid_unexpected_shape';
    END IF;
    -- Clean installs may already contain the canonical UUID predicate.
    -- In that case this repair is a safe no-op.
  ELSE
    IF v_patched ~ v_bad_pattern THEN
      RAISE EXCEPTION 'guest_lifecycle_cleanup_remaining_uuid_patch_incomplete';
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
