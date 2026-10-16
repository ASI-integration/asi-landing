-- Run only after exact optional repair in the same rollback-only outer transaction.
-- Bounded check-constraint acceptance proof; not full communication-intent workflow proof.
CREATE TEMP TABLE asi_purpose_constraint_probe (purpose text NOT NULL) ON COMMIT DROP;
DO $purpose$
DECLARE definition text; value text; state text; constraint_name text; accepted integer:=0;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint
 WHERE conrelid='public.booking_ops_communication_intents'::regclass
 AND conname='booking_ops_communication_purpose_check' AND contype='c' AND convalidated;
 EXECUTE 'ALTER TABLE pg_temp.asi_purpose_constraint_probe ADD CONSTRAINT asi_exact_purpose_check ' || definition;
 FOREACH value IN ARRAY ARRAY[
  'request_missing_guest_data',
  'request_arrival_time',
  'neutral_booking_acknowledgement',
  'neutral_status_update',
  'cleaner_task_assignment',
  'cleaner_task_reminder',
  'linen_task_assignment',
  'inspection_task_assignment',
  'master_task_assignment',
  'master_task_reminder',
  'internal_status_notice',
  'fallback_created_notice',
  'task_overdue_notice',
  'request_guest_documents',
  'request_contract_confirmation',
  'request_deposit_payment',
  'request_mvd_data',
  'send_checkin_instructions',
  'remind_guest_before_checkin',
  'checkout_reminder',
  'cleaning_assignment',
  'cleaning_reminder',
  'inspection_request',
  'issue_followup',
  'checkin_instructions',
  'arrival_confirmation_request',
  'access_issue_followup',
  'checkout_instructions',
  'checkout_confirmation_request',
  'guest_issue_acknowledgement',
  'guest_stay_issue_followup',
  'deposit_return_readiness_notice',
  'linen_pickup_request',
  'linen_delivery_request',
  'linen_status_check',
  'maintenance_request',
  'repair_status_check',
  'preparation_blocked_notice',
  'readiness_confirmation_needed',
  'guest_data_missing_notice',
  'unit_ready_notice',
  'issue_escalation_notice'
 ]::text[] LOOP
  INSERT INTO pg_temp.asi_purpose_constraint_probe(purpose) VALUES(value);
  accepted:=accepted+1;
 END LOOP;
 IF accepted<>42 OR (SELECT count(DISTINCT purpose) FROM pg_temp.asi_purpose_constraint_probe)<>42 THEN
  RAISE EXCEPTION 'canonical purpose cardinality mismatch';
 END IF;
 BEGIN
  INSERT INTO pg_temp.asi_purpose_constraint_probe(purpose) VALUES('asi_restore_unknown_purpose_2a7f58e4');
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE, constraint_name=CONSTRAINT_NAME;
  IF state<>'23514' OR constraint_name<>'asi_exact_purpose_check' THEN RAISE; END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'unknown purpose unexpectedly accepted';
END $purpose$;
SELECT 'PURPOSE_CONSTRAINT_42_ACCEPTED_UNKNOWN_REJECTED' AS sanitized_status;
