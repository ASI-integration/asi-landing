-- Booking Ops Automation Engine v1.
-- Extends the existing internal task model; no outbound communication or new tables.

ALTER TABLE public.booking_ops_tasks
  DROP CONSTRAINT IF EXISTS booking_ops_tasks_type_check;

ALTER TABLE public.booking_ops_tasks
  ADD CONSTRAINT booking_ops_tasks_type_check
    CHECK (task_type IN (
      'complete_booking_data',
      'request_guest_documents',
      'verify_guest_documents',
      'prepare_contract',
      'send_contract_manual',
      'follow_up_contract_signature',
      'request_deposit',
      'confirm_deposit',
      'track_deposit_return',
      'collect_mvd_data',
      'prepare_mvd_report',
      'submit_mvd_report',
      'generate_telegram_drafts',
      'review_telegram_drafts',
      'manual_send_telegram_drafts',
      'checkout_confirmed',
      'cleaning_needed',
      'cleaning_assigned',
      'cleaning_in_progress',
      'cleaning_done',
      'unit_inspection_needed',
      'unit_ready_for_next_guest',
      'linen_pickup_needed',
      'linen_replaced',
      'laundry_dropoff_needed',
      'laundry_return_needed',
      'supplies_check_needed',
      'inspection_needed',
      'maintenance_needed',
      'unit_ready_confirmation'
    ));

NOTIFY pgrst, 'reload schema';
