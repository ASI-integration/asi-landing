-- Automation Loop v1: allow CRM to persist the basic "needs reaction" status.

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
      'paused',
      'not_fit'
    )
  );
