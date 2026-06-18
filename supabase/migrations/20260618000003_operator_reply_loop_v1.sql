-- Operator Reply Loop v1: CRM operator replies sent back to the guest.

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
      'guest_test_ready',
      'guest_test_started',
      'guest_test_question',
      'guest_test_passed_basic',
      'guest_test_missing_data',
      'operator_followup_required',
      'operator_followup_sent',
      'operator_reply_sent',
      'pilot_application_submitted',
      'pilot_selected',
      'status_change',
      'note'
    )
  );
