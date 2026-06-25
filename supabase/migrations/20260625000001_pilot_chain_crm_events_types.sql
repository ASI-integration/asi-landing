-- Pilot Automation Spine v1: CRM audit event types for pilot-chain steps.

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
      'autopilot_operator_handoff',
      'object_readiness_updated',
      'object_readiness_missing_photos',
      'object_readiness_ready_for_cm',
      'object_readiness_requested_channels',
      'lead_to_object_created',
      'object_to_channel_manager_prepared',
      'ops_case_created',
      'skipped_existing_object',
      'skipped_existing_ops'
    )
  );
