-- Communication Autopilot v1: per-object flag + CRM event types.

ALTER TABLE tg_property_knowledge
  ADD COLUMN IF NOT EXISTS communication_autopilot TEXT NOT NULL DEFAULT 'disabled';

ALTER TABLE tg_property_knowledge
  DROP CONSTRAINT IF EXISTS tg_property_knowledge_communication_autopilot_check;

ALTER TABLE tg_property_knowledge
  ADD CONSTRAINT tg_property_knowledge_communication_autopilot_check
  CHECK (communication_autopilot IN ('enabled', 'disabled'));

ALTER TABLE public.crm_events DROP CONSTRAINT IF EXISTS crm_events_type_check;
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
      'guest_concierge_answered',
      'operator_followup_required',
      'operator_followup_sent',
      'operator_reply_sent',
      'pilot_application_submitted',
      'pilot_selected',
      'status_change',
      'note',
      'autopilot_guest_reply',
      'conversation_resolved',
      'autopilot_clarification_requested',
      'autopilot_operator_handoff'
    )
  );
