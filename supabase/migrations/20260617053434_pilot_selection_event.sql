-- Pilot Selection + Object Start Automation v1.
-- Разрешает отдельное CRM-событие выбора кандидата в пилот.

ALTER TABLE public.crm_events
  DROP CONSTRAINT IF EXISTS crm_events_type_check;

ALTER TABLE public.crm_events
  ADD CONSTRAINT crm_events_type_check
  CHECK (
    event_type IN (
      'escalation',
      'missing_data',
      'blocked',
      'auto_reply',
      'message_inbound',
      'message_outbound',
      'role_selected_owner',
      'role_selected_lead',
      'role_selected_guest',
      'guest_test_started',
      'pilot_application_submitted',
      'pilot_selected',
      'status_change',
      'note'
    )
  );
