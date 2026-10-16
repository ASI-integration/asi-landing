-- Align the booking ops communication purpose constraint with the canonical
-- BOOKING_OPS_COMMUNICATION_PURPOSES list used by the deployed application.
--
-- Guest Lifecycle emits purposes such as neutral_booking_acknowledgement,
-- request_arrival_time and neutral_status_update. Older production constraints
-- predate those values and reject otherwise-valid lifecycle communication intents.

ALTER TABLE public.booking_ops_communication_intents
  DROP CONSTRAINT IF EXISTS booking_ops_communication_purpose_check;

ALTER TABLE public.booking_ops_communication_intents
  ADD CONSTRAINT booking_ops_communication_purpose_check
    CHECK (purpose IN (
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
    ));

NOTIFY pgrst, 'reload schema';
