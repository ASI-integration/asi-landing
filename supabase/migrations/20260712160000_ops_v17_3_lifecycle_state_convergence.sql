-- OPS v17.3: allow the shared lifecycle projection to store canonical OPS v16 stages.
ALTER TABLE public.booking_ops_lifecycle_states
  DROP CONSTRAINT IF EXISTS booking_ops_lifecycle_states_stage_check;

ALTER TABLE public.booking_ops_lifecycle_states
  ADD CONSTRAINT booking_ops_lifecycle_states_stage_check CHECK (current_stage IN (
    'booking_received','guest_contacted','guest_data_requested','guest_data_completed',
    'documents_requested','documents_received','documents_verified','contract_generated',
    'deposit_requested','deposit_confirmed','mvd_completed','turnover_created',
    'cleaning_completed','linen_completed','consumables_completed','inspection_completed',
    'maintenance_completed','property_ready','checkin_released','checked_in','in_stay',
    'checkout_started','checkout_inspected','deposit_returned','closed',
    'guest_intake','legal_preparation','physical_preparation','final_readiness_review',
    'checkin_release_ready','checkin_release_draft_prepared','checkout_pending','completed',
    'blocked','cancelled'
  ));
