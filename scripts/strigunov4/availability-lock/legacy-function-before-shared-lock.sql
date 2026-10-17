CREATE OR REPLACE FUNCTION public.create_booking_availability_hold_atomic(
  p_property_setup_id uuid,
  p_property_id text,
  p_booking_id uuid,
  p_source text,
  p_date_from date,
  p_date_to date,
  p_hold_expires_at timestamptz,
  p_safe_summary text,
  p_metadata jsonb,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing public.booking_availability_holds%ROWTYPE;
  v_hold public.booking_availability_holds%ROWTYPE;
  v_conflicts jsonb := '[]'::jsonb;
  v_hard_count integer := 0;
  v_hold_count integer := 0;
  v_status text;
  v_hold_status text;
  v_check_id uuid := gen_random_uuid();
  v_lock_scope text;
BEGIN
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from >= p_date_to THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = '22007';
  END IF;
  IF p_property_setup_id IS NULL AND nullif(btrim(p_property_id), '') IS NULL THEN
    RAISE EXCEPTION 'property_required' USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('booking_intake', 'pilot_autorun', 'channel_import', 'operator', 'manual_block', 'internal') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM public.booking_availability_holds WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN to_jsonb(v_existing); END IF;

  v_lock_scope := coalesce(p_property_setup_id::text, 'property:' || btrim(p_property_id));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_scope, 7411));

  SELECT * INTO v_existing FROM public.booking_availability_holds WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN to_jsonb(v_existing); END IF;

  WITH found AS (
    SELECT 'active_hold'::text kind, h.id::text entity_id, 'possible'::text severity
      FROM public.booking_availability_holds h
     WHERE h.status IN ('active', 'confirmed')
       AND (h.hold_expires_at IS NULL OR h.hold_expires_at > now())
       AND (p_booking_id IS NULL OR h.booking_id IS DISTINCT FROM p_booking_id)
       AND ((p_property_setup_id IS NOT NULL AND h.property_setup_id = p_property_setup_id)
         OR (nullif(btrim(p_property_id), '') IS NOT NULL AND h.property_id = btrim(p_property_id)))
       AND h.date_from < p_date_to AND p_date_from < h.date_to
    UNION ALL
    SELECT 'manual_block', b.id::text, 'confirmed'
      FROM public.booking_availability_blocks b
     WHERE b.status IN ('active', 'blocked')
       AND ((p_property_setup_id IS NOT NULL AND b.property_setup_id = p_property_setup_id)
         OR (nullif(btrim(p_property_id), '') IS NOT NULL AND b.property_id = btrim(p_property_id)))
       AND b.date_from < p_date_to AND p_date_from < b.date_to
    UNION ALL
    SELECT 'booking', r.id::text, 'confirmed'
      FROM public.booking_ops_records r
     WHERE (p_booking_id IS NULL OR r.id IS DISTINCT FROM p_booking_id)
       AND nullif(btrim(p_property_id), '') IS NOT NULL AND r.property_id = btrim(p_property_id)
       AND r.check_in_at IS NOT NULL AND r.check_out_at IS NOT NULL
       AND r.check_in_at < p_date_to::timestamptz AND p_date_from::timestamptz < r.check_out_at
    UNION ALL
    SELECT 'channel_booking', cb.id::text, 'confirmed'
      FROM public.booking_channel_imported_bookings cb
      LEFT JOIN public.booking_channel_imported_objects co
        ON co.connection_id = cb.connection_id AND co.external_object_id = cb.external_object_id
     WHERE cb.status <> 'cancelled' AND cb.checkin_date IS NOT NULL AND cb.checkout_date IS NOT NULL
       AND (p_booking_id IS NULL OR cb.matched_booking_id IS DISTINCT FROM p_booking_id)
       AND ((p_property_setup_id IS NOT NULL AND co.matched_property_setup_id = p_property_setup_id)
         OR (nullif(btrim(p_property_id), '') IS NOT NULL AND co.matched_property_id = btrim(p_property_id)))
       AND cb.checkin_date < p_date_to AND p_date_from < cb.checkout_date
    UNION ALL
    SELECT 'channel_calendar', cs.id::text, 'confirmed'
      FROM public.booking_channel_calendar_snapshots cs
      JOIN public.booking_channel_imported_objects co
        ON co.connection_id = cs.connection_id AND co.external_object_id = cs.external_object_id
     WHERE cs.availability_status IN ('booked', 'blocked')
       AND ((p_property_setup_id IS NOT NULL AND co.matched_property_setup_id = p_property_setup_id)
         OR (nullif(btrim(p_property_id), '') IS NOT NULL AND co.matched_property_id = btrim(p_property_id)))
       AND cs.date >= p_date_from AND cs.date < p_date_to
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('type', kind, 'id', entity_id, 'severity', severity)), '[]'::jsonb),
         count(*) FILTER (WHERE severity = 'confirmed'), count(*) FILTER (WHERE severity = 'possible')
    INTO v_conflicts, v_hard_count, v_hold_count FROM found;

  v_status := CASE WHEN v_hard_count > 0 THEN 'confirmed_conflict'
                   WHEN v_hold_count > 0 THEN 'possible_conflict' ELSE 'no_conflict' END;
  v_hold_status := CASE WHEN v_status = 'no_conflict' THEN 'active' ELSE 'conflict' END;

  INSERT INTO public.booking_availability_holds (
    id, property_setup_id, property_id, booking_id, source, status, date_from, date_to, nights,
    hold_expires_at, conflict_status, conflict_summary, safe_summary, metadata, idempotency_key
  ) VALUES (
    gen_random_uuid(), p_property_setup_id, nullif(btrim(p_property_id), ''), p_booking_id, p_source,
    v_hold_status, p_date_from, p_date_to, p_date_to - p_date_from, p_hold_expires_at, v_status,
    v_conflicts, left(nullif(btrim(p_safe_summary), ''), 500), coalesce(p_metadata, '{}'::jsonb), p_idempotency_key
  ) RETURNING * INTO v_hold;

  INSERT INTO public.booking_overbooking_conflict_checks (
    id, property_setup_id, property_id, booking_id, hold_id, check_type, status,
    requested_date_from, requested_date_to, conflicts, blockers, safe_summary
  ) VALUES (
    v_check_id, p_property_setup_id, nullif(btrim(p_property_id), ''), p_booking_id, v_hold.id,
    CASE p_source WHEN 'booking_intake' THEN 'pre_intake' WHEN 'pilot_autorun' THEN 'pre_autorun'
      WHEN 'channel_import' THEN 'channel_import' ELSE 'manual_review' END,
    v_status, p_date_from, p_date_to, v_conflicts,
    CASE WHEN v_status = 'no_conflict' THEN '[]'::jsonb ELSE jsonb_build_array('Нужна проверка доступности оператором.') END,
    CASE WHEN v_status = 'no_conflict' THEN 'Диапазон временно удерживается.' ELSE 'Найдено пересечение дат.' END
  );

  IF p_booking_id IS NOT NULL THEN
    UPDATE public.booking_ops_records SET
      availability_status = CASE WHEN v_status = 'no_conflict' THEN 'held' ELSE 'conflict' END,
      overbooking_risk_status = v_status,
      availability_hold_id = v_hold.id,
      availability_summary = jsonb_build_object('status', v_status, 'check_id', v_check_id, 'hold_id', v_hold.id),
      updated_at = now()
    WHERE id = p_booking_id;
  END IF;
  RETURN to_jsonb(v_hold) || jsonb_build_object('check_id', v_check_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking_availability_hold_atomic(uuid, text, uuid, text, date, date, timestamptz, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_availability_hold_atomic(uuid, text, uuid, text, date, date, timestamptz, text, jsonb, text) TO service_role;
NOTIFY pgrst, 'reload schema';

