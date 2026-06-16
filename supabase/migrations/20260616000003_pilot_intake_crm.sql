-- Pilot Intake + Onboarding Automation v1.
-- Добавляет CRM-статусы, источник и событие для публичной формы пилота.

ALTER TABLE public.crm_contacts
  DROP CONSTRAINT IF EXISTS crm_contacts_source_check;

ALTER TABLE public.crm_contacts
  ADD CONSTRAINT crm_contacts_source_check
  CHECK (source IN ('telegram', 'landing', 'manual', 'test', 'pilot_form'));

ALTER TABLE public.crm_contacts
  DROP CONSTRAINT IF EXISTS crm_contacts_status_check;

ALTER TABLE public.crm_contacts
  ADD CONSTRAINT crm_contacts_status_check
  CHECK (
    status IN (
      'new',
      'needs_clarification',
      'qualified',
      'creating_object',
      'object_filled',
      'testing_communication',
      'needs_reaction',
      'pilot_active',
      'pilot_candidate',
      'pilot_selected',
      'pilot_waitlist',
      'paused',
      'not_fit'
    )
  );

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
      'status_change',
      'note'
    )
  );
