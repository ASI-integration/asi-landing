-- Controlled synthetic acceptance cleanup for Guest Lifecycle Communications v1.

-- Exact-manifest cleanup for the controlled synthetic acceptance. The
-- function refuses cleanup if any owned seam has lost its synthetic marker.
CREATE OR REPLACE FUNCTION public.cleanup_guest_lifecycle_synthetic_acceptance(
  p_run_id TEXT,
  p_booking_ops_record_id UUID,
  p_reservation_id TEXT,
  p_property_id TEXT,
  p_guest_id TEXT,
  p_scope_id UUID,
  p_policy_ids UUID[],
  p_dry_run BOOLEAN DEFAULT true,
  p_confirm TEXT DEFAULT 'DRY_RUN'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_booking RECORD;
  v_reservation RECORD;
  v_property RECORD;
  v_scope RECORD;
  v_legal RECORD;
  v_contact RECORD;
  v_identity RECORD;
  v_residue_count BIGINT := 0;
  v_residue JSONB := '{}'::jsonb;
BEGIN
  IF p_run_id IS NULL OR p_run_id NOT LIKE 'glc-synthetic-%' THEN
    RAISE EXCEPTION 'synthetic_run_id_required';
  END IF;
  v_token := substring(p_run_id FROM char_length('glc-synthetic-') + 1);
  IF v_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'synthetic_run_token_invalid';
  END IF;
  IF p_reservation_id IS DISTINCT FROM p_booking_ops_record_id::text
     OR p_property_id IS DISTINCT FROM 'glc-synthetic-property-' || v_token
     OR p_guest_id IS DISTINCT FROM 'glc-synthetic-guest-' || v_token THEN
    RAISE EXCEPTION 'synthetic_manifest_identity_mismatch';
  END IF;
  IF coalesce(array_length(p_policy_ids, 1), 0) <> 3
     OR (SELECT count(DISTINCT policy_id) FROM unnest(p_policy_ids) AS policy_id) <> 3 THEN
    RAISE EXCEPTION 'synthetic_policy_manifest_mismatch';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id, 0));

  SELECT id, booking_id, property_id, reservation_metadata
    INTO v_booking
    FROM public.booking_ops_records
   WHERE id = p_booking_ops_record_id;
  IF FOUND AND (
    v_booking.booking_id IS DISTINCT FROM p_reservation_id
    OR v_booking.property_id IS DISTINCT FROM p_property_id
    OR coalesce(v_booking.reservation_metadata->>'acceptanceHarness', '') IS DISTINCT FROM 'guest_lifecycle_communications_v1'
    OR coalesce(v_booking.reservation_metadata->>'acceptanceRunId', '') IS DISTINCT FROM p_run_id
    OR coalesce((v_booking.reservation_metadata->>'synthetic')::boolean, false) IS DISTINCT FROM true
    OR coalesce((v_booking.reservation_metadata->>'noExternalActions')::boolean, false) IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'synthetic_booking_ownership_mismatch';
  END IF;

  SELECT id, booking_id, property_id, guest_id, pilot_acceptance_marker
    INTO v_reservation
    FROM public.tg_guest_reservations
   WHERE id = p_reservation_id;
  IF FOUND AND (
    v_reservation.booking_id IS DISTINCT FROM p_reservation_id
    OR v_reservation.property_id IS DISTINCT FROM p_property_id
    OR v_reservation.guest_id IS DISTINCT FROM p_guest_id
    OR v_reservation.pilot_acceptance_marker IS DISTINCT FROM p_run_id
  ) THEN
    RAISE EXCEPTION 'synthetic_reservation_ownership_mismatch';
  END IF;

  SELECT property_id, pilot_acceptance_marker
    INTO v_property
    FROM public.tg_property_knowledge
   WHERE property_id = p_property_id;
  IF FOUND AND v_property.pilot_acceptance_marker IS DISTINCT FROM p_run_id THEN
    RAISE EXCEPTION 'synthetic_property_ownership_mismatch';
  END IF;

  SELECT id, email, first_name, last_name
    INTO v_contact
    FROM public.tg_contacts
   WHERE id = p_guest_id;
  IF FOUND AND (
    v_contact.email IS DISTINCT FROM 'glc-synthetic-' || v_token || '@example.invalid'
    OR v_contact.first_name IS DISTINCT FROM 'Synthetic'
    OR v_contact.last_name IS DISTINCT FROM 'Guest'
  ) THEN
    RAISE EXCEPTION 'synthetic_contact_ownership_mismatch';
  END IF;

  SELECT guest_id, email, display_name
    INTO v_identity
    FROM public.tg_guest_identities
   WHERE guest_id = p_guest_id;
  IF FOUND AND (
    v_identity.email IS DISTINCT FROM 'glc-synthetic-' || v_token || '@example.invalid'
    OR v_identity.display_name IS DISTINCT FROM 'Synthetic Guest'
  ) THEN
    RAISE EXCEPTION 'synthetic_identity_ownership_mismatch';
  END IF;

  SELECT id, scope_type, scope_ref, reason, actual_send_enabled, dry_run_only
    INTO v_scope
    FROM public.booking_ops_communication_auto_send_scopes
   WHERE id = p_scope_id;
  IF FOUND AND (
    v_scope.scope_type IS DISTINCT FROM 'booking'
    OR v_scope.scope_ref IS DISTINCT FROM p_reservation_id
    OR v_scope.reason IS DISTINCT FROM 'guest_lifecycle_communications_v1:' || p_run_id
    OR v_scope.actual_send_enabled IS DISTINCT FROM true
    OR v_scope.dry_run_only IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'synthetic_scope_ownership_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_ops_communication_policies
     WHERE scope = 'booking'
       AND scope_ref = p_reservation_id
       AND id <> ALL(p_policy_ids)
  ) OR EXISTS (
    SELECT 1 FROM public.booking_ops_communication_policies
     WHERE id = ANY(p_policy_ids)
       AND (
         scope IS DISTINCT FROM 'booking'
         OR scope_ref IS DISTINCT FROM p_reservation_id
         OR message_type NOT IN ('neutral_booking_acknowledgement', 'neutral_status_update', 'send_checkin_instructions')
         OR channel IS DISTINCT FROM 'any'
         OR auto_send_enabled IS DISTINCT FROM true
         OR actual_send_enabled IS DISTINCT FROM true
         OR requires_review IS DISTINCT FROM false
         OR quiet_hours_enabled IS DISTINCT FROM false
         OR max_auto_sends_per_booking_per_day IS DISTINCT FROM 20
         OR max_auto_sends_per_guest_per_day IS DISTINCT FROM 20
       )
  ) THEN
    RAISE EXCEPTION 'synthetic_policy_ownership_mismatch';
  END IF;

  SELECT booking_id, property_id, metadata
    INTO v_legal
    FROM public.booking_guest_legal_readiness
   WHERE booking_id = p_booking_ops_record_id;
  IF FOUND AND (
    v_legal.property_id IS DISTINCT FROM p_property_id
    OR coalesce(v_legal.metadata->>'acceptanceHarness', '') IS DISTINCT FROM 'guest_lifecycle_communications_v1'
    OR coalesce(v_legal.metadata->>'acceptanceRunId', '') IS DISTINCT FROM p_run_id
  ) THEN
    RAISE EXCEPTION 'synthetic_legal_readiness_ownership_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.guest_lifecycle_events
     WHERE reservation_id = p_reservation_id
       AND (source IS DISTINCT FROM 'synthetic_acceptance' OR source_event_id NOT LIKE p_run_id || ':%')
  ) THEN
    RAISE EXCEPTION 'synthetic_lifecycle_ownership_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_ops_communication_intents
     WHERE booking_ops_record_id = p_booking_ops_record_id
       AND (
         coalesce(metadata->>'lifecycle_source', '') IS DISTINCT FROM 'synthetic_acceptance'
         OR coalesce(metadata->>'lifecycle_source_event_id', '') NOT LIKE p_run_id || ':%'
       )
  ) THEN
    RAISE EXCEPTION 'synthetic_intent_ownership_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.guest_memory_events
     WHERE guest_id = p_guest_id
       AND (
         booking_reference IS DISTINCT FROM p_reservation_id
         OR event_type IS DISTINCT FROM 'completed_stay'
         OR source_kind IS DISTINCT FROM 'deterministic_system'
       )
  ) THEN
    RAISE EXCEPTION 'synthetic_memory_ownership_mismatch';
  END IF;

  SELECT jsonb_build_object(
    'bookingOpsRecords', (SELECT count(*) FROM public.booking_ops_records WHERE id = p_booking_ops_record_id),
    'reservations', (SELECT count(*) FROM public.tg_guest_reservations WHERE id = p_reservation_id),
    'properties', (SELECT count(*) FROM public.tg_property_knowledge WHERE property_id = p_property_id),
    'contacts', (SELECT count(*) FROM public.tg_contacts WHERE id = p_guest_id),
    'identities', (SELECT count(*) FROM public.tg_guest_identities WHERE guest_id = p_guest_id),
    'memoryProfiles', (SELECT count(*) FROM public.guest_memory_profiles WHERE guest_id = p_guest_id),
    'memoryEvents', (SELECT count(*) FROM public.guest_memory_events WHERE guest_id = p_guest_id),
    'lifecycleEvents', (SELECT count(*) FROM public.guest_lifecycle_events WHERE reservation_id = p_reservation_id),
    'intents', (SELECT count(*) FROM public.booking_ops_communication_intents WHERE booking_ops_record_id = p_booking_ops_record_id),
    'deliveries', (SELECT count(*) FROM public.booking_ops_communication_deliveries WHERE booking_id = p_reservation_id),
    'attempts', (SELECT count(*) FROM public.booking_ops_communication_auto_send_attempts WHERE booking_id = p_reservation_id),
    'legalReadiness', (SELECT count(*) FROM public.booking_guest_legal_readiness WHERE booking_id = p_booking_ops_record_id),
    'cleaningTasks', (SELECT count(*) FROM public.booking_cleaning_tasks WHERE booking_id = p_booking_ops_record_id),
    'linenTasks', (SELECT count(*) FROM public.booking_linen_tasks WHERE booking_id = p_booking_ops_record_id),
    'suppliesTasks', (SELECT count(*) FROM public.booking_supplies_tasks WHERE booking_id = p_booking_ops_record_id),
    'physicalReadiness', (SELECT count(*) FROM public.booking_physical_readiness WHERE booking_id = p_booking_ops_record_id),
    'bookingOpsTasks', (SELECT count(*) FROM public.booking_ops_tasks WHERE booking_ops_record_id = p_booking_ops_record_id),
    'bookingOpsEvents', (SELECT count(*) FROM public.booking_ops_events WHERE booking_ops_record_id = p_booking_ops_record_id),
    'domainEvents', (SELECT count(*) FROM public.booking_ops_domain_events WHERE booking_id = p_booking_ops_record_id),
    'lifecycleGates', (SELECT count(*) FROM public.booking_lifecycle_gates WHERE booking_id = p_reservation_id),
    'lifecycleExceptions', (SELECT count(*) FROM public.booking_lifecycle_exceptions WHERE booking_id = p_reservation_id),
    'sendScopes', (SELECT count(*) FROM public.booking_ops_communication_auto_send_scopes WHERE id = p_scope_id),
    'policies', (SELECT count(*) FROM public.booking_ops_communication_policies WHERE id = ANY(p_policy_ids))
  ) INTO v_residue;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true,
      'dryRun', true,
      'runId', p_run_id,
      'ownedRows', v_residue,
      'noExternalActions', true
    );
  END IF;

  IF p_confirm IS DISTINCT FROM 'CLEAN GUEST LIFECYCLE ' || p_run_id THEN
    RAISE EXCEPTION 'synthetic_cleanup_confirmation_mismatch';
  END IF;

  DELETE FROM public.booking_ops_communication_auto_send_scopes
   WHERE id = p_scope_id
     AND scope_type = 'booking'
     AND scope_ref = p_reservation_id
     AND reason = 'guest_lifecycle_communications_v1:' || p_run_id
     AND dry_run_only = true;
  DELETE FROM public.booking_ops_communication_policies
   WHERE id = ANY(p_policy_ids)
     AND scope = 'booking'
     AND scope_ref = p_reservation_id;
  DELETE FROM public.guest_lifecycle_events
   WHERE reservation_id = p_reservation_id
     AND source = 'synthetic_acceptance'
     AND source_event_id LIKE p_run_id || ':%';
  DELETE FROM public.booking_lifecycle_exceptions WHERE booking_id = p_reservation_id;
  DELETE FROM public.booking_lifecycle_gates WHERE booking_id = p_reservation_id;
  DELETE FROM public.booking_ops_records
   WHERE id = p_booking_ops_record_id
     AND coalesce(reservation_metadata->>'acceptanceHarness', '') = 'guest_lifecycle_communications_v1'
     AND coalesce(reservation_metadata->>'acceptanceRunId', '') = p_run_id;
  DELETE FROM public.guest_memory_events
   WHERE guest_id = p_guest_id
     AND booking_reference = p_reservation_id
     AND event_type = 'completed_stay'
     AND source_kind = 'deterministic_system';
  DELETE FROM public.guest_memory_profiles WHERE guest_id = p_guest_id;
  DELETE FROM public.tg_guest_reservations
   WHERE id = p_reservation_id AND pilot_acceptance_marker = p_run_id;
  DELETE FROM public.tg_guest_identities
   WHERE guest_id = p_guest_id
     AND email = 'glc-synthetic-' || v_token || '@example.invalid'
     AND display_name = 'Synthetic Guest';
  DELETE FROM public.tg_contacts
   WHERE id = p_guest_id
     AND email = 'glc-synthetic-' || v_token || '@example.invalid'
     AND first_name = 'Synthetic'
     AND last_name = 'Guest';
  DELETE FROM public.tg_property_knowledge
   WHERE property_id = p_property_id AND pilot_acceptance_marker = p_run_id;

  SELECT coalesce(sum(item_count), 0) INTO v_residue_count FROM (
    SELECT count(*) AS item_count FROM public.booking_ops_records WHERE id = p_booking_ops_record_id
    UNION ALL SELECT count(*) FROM public.tg_guest_reservations WHERE id = p_reservation_id
    UNION ALL SELECT count(*) FROM public.tg_property_knowledge WHERE property_id = p_property_id
    UNION ALL SELECT count(*) FROM public.tg_contacts WHERE id = p_guest_id
    UNION ALL SELECT count(*) FROM public.tg_guest_identities WHERE guest_id = p_guest_id
    UNION ALL SELECT count(*) FROM public.guest_memory_profiles WHERE guest_id = p_guest_id
    UNION ALL SELECT count(*) FROM public.guest_memory_events WHERE guest_id = p_guest_id
    UNION ALL SELECT count(*) FROM public.guest_lifecycle_events WHERE reservation_id = p_reservation_id
    UNION ALL SELECT count(*) FROM public.booking_ops_communication_intents WHERE booking_ops_record_id = p_booking_ops_record_id
    UNION ALL SELECT count(*) FROM public.booking_ops_communication_deliveries WHERE booking_id = p_reservation_id
    UNION ALL SELECT count(*) FROM public.booking_ops_communication_auto_send_attempts WHERE booking_id = p_reservation_id
    UNION ALL SELECT count(*) FROM public.booking_guest_legal_readiness WHERE booking_id = p_booking_ops_record_id
    UNION ALL SELECT count(*) FROM public.booking_cleaning_tasks WHERE booking_id = p_booking_ops_record_id
    UNION ALL SELECT count(*) FROM public.booking_linen_tasks WHERE booking_id = p_booking_ops_record_id
    UNION ALL SELECT count(*) FROM public.booking_supplies_tasks WHERE booking_id = p_booking_ops_record_id
    UNION ALL SELECT count(*) FROM public.booking_physical_readiness WHERE booking_id = p_booking_ops_record_id
    UNION ALL SELECT count(*) FROM public.booking_ops_tasks WHERE booking_ops_record_id = p_booking_ops_record_id
    UNION ALL SELECT count(*) FROM public.booking_ops_events WHERE booking_ops_record_id = p_booking_ops_record_id
    UNION ALL SELECT count(*) FROM public.booking_ops_domain_events WHERE booking_id = p_booking_ops_record_id
    UNION ALL SELECT count(*) FROM public.booking_lifecycle_gates WHERE booking_id = p_reservation_id
    UNION ALL SELECT count(*) FROM public.booking_lifecycle_exceptions WHERE booking_id = p_reservation_id
    UNION ALL SELECT count(*) FROM public.booking_ops_communication_auto_send_scopes WHERE id = p_scope_id
    UNION ALL SELECT count(*) FROM public.booking_ops_communication_policies WHERE id = ANY(p_policy_ids)
  ) residue;

  RETURN jsonb_build_object(
    'ok', v_residue_count = 0,
    'dryRun', false,
    'runId', p_run_id,
    'deletedOwnedRows', v_residue,
    'residueCount', v_residue_count,
    'zeroResidue', v_residue_count = 0,
    'noExternalActions', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_guest_lifecycle_synthetic_acceptance(TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID[], BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_guest_lifecycle_synthetic_acceptance(TEXT, UUID, TEXT, TEXT, TEXT, UUID, UUID[], BOOLEAN, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
