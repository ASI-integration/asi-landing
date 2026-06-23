-- Support bot OPS task type and source for @ASI_Support_Bot escalations.

ALTER TABLE ops_operator_tasks
  DROP CONSTRAINT IF EXISTS ops_operator_tasks_type_check;

ALTER TABLE ops_operator_tasks
  ADD CONSTRAINT ops_operator_tasks_type_check
    CHECK (task_type IN (
      'prepare_checkin',
      'prepare_checkout',
      'verify_cleaning',
      'verify_guest_issue',
      'request_owner_data',
      'verify_channel_manager',
      'contact_owner',
      'support_review',
      'other'
    ));

ALTER TABLE ops_operator_tasks
  DROP CONSTRAINT IF EXISTS ops_operator_tasks_source_check;

ALTER TABLE ops_operator_tasks
  ADD CONSTRAINT ops_operator_tasks_source_check
    CHECK (source IN (
      'telegram',
      'telegram_support',
      'crm',
      'communication_autopilot',
      'channel_manager',
      'manual'
    ));
