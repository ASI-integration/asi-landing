-- Pilot rollout gate v1: explicit pilot queue statuses for gradual launch.

ALTER TABLE public.crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_status_check;
ALTER TABLE public.crm_contacts
  ADD CONSTRAINT crm_contacts_status_check CHECK (status IN (
    'new',
    'waitlist',
    'invited',
    'onboarding',
    'active_pilot',
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
    'not_fit',
    'new_lead',
    'contact',
    'instruction_sent',
    'waiting_object_data',
    'access_received',
    'test_object_selected',
    'object_setup',
    'ready_for_test',
    'pilot',
    'paused',
    'rejected',
    'not_relevant'
  ));
