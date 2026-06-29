-- Booking Ops Turnover / Cleaning / Linen v1.
-- Post-checkout housekeeping tasks and unit readiness. No outbound sends.

ALTER TABLE public.booking_ops_records
  ADD COLUMN IF NOT EXISTS unit_readiness_status TEXT NOT NULL DEFAULT 'not_ready';

ALTER TABLE public.booking_ops_records
  DROP CONSTRAINT IF EXISTS booking_ops_records_unit_readiness_status_check;

ALTER TABLE public.booking_ops_records
  ADD CONSTRAINT booking_ops_records_unit_readiness_status_check
    CHECK (unit_readiness_status IN (
      'not_ready',
      'cleaning_pending',
      'linen_pending',
      'inspection_pending',
      'ready',
      'blocked'
    ));

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
      'supplies_check_needed'
    ));

ALTER TABLE public.booking_ops_events
  DROP CONSTRAINT IF EXISTS booking_ops_events_event_type_check;

ALTER TABLE public.booking_ops_events
  ADD CONSTRAINT booking_ops_events_event_type_check
    CHECK (event_type IN (
      'booking_created',
      'booking_updated',
      'readiness_status_changed',
      'readiness_completed',
      'operational_task_created',
      'task_action_run',
      'telegram_draft_created',
      'telegram_draft_reused',
      'task_status_changed',
      'completion_effect_applied',
      'completion_effect_suggested',
      'turnover_started',
      'unit_readiness_changed'
    ));

NOTIFY pgrst, 'reload schema';
