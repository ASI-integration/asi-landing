-- OPS v1 setup pipeline for owner/manager заявки.

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS interest_context TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS responsible_name TEXT NOT NULL DEFAULT 'Николай',
  ADD COLUMN IF NOT EXISTS responsible_telegram TEXT NOT NULL DEFAULT '@ASI_Support_Bot',
  ADD COLUMN IF NOT EXISTS responsible_phone TEXT NOT NULL DEFAULT '+79217926627',
  ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_reason TEXT NOT NULL DEFAULT '';

UPDATE public.crm_contacts
SET responsible_name = 'Николай'
WHERE responsible_name IS NULL OR responsible_name = '';

UPDATE public.crm_contacts
SET responsible_telegram = '@ASI_Support_Bot'
WHERE responsible_telegram IS NULL OR responsible_telegram = '';

UPDATE public.crm_contacts
SET responsible_phone = '+79217926627'
WHERE responsible_phone IS NULL OR responsible_phone = '';

ALTER TABLE public.crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_source_check;
ALTER TABLE public.crm_contacts
  ADD CONSTRAINT crm_contacts_source_check CHECK (source IN (
    'telegram',
    'web',
    'dashboard',
    'unknown',
    'landing',
    'form',
    'manual',
    'test',
    'pilot_form',
    'bragin_group',
    'other'
  ));

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
    'contact_sent',
    'operator_needed',
    'access_requested',
    'instruction_sent',
    'waiting_object_data',
    'access_received',
    'test_object_selected',
    'ready_for_setup',
    'object_setup',
    'ready_for_test',
    'pilot',
    'paused',
    'rejected',
    'not_relevant'
  ));

ALTER TABLE public.crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_interest_context_check;
ALTER TABLE public.crm_contacts
  ADD CONSTRAINT crm_contacts_interest_context_check CHECK (interest_context IN (
    'channel_manager_setup',
    'asi_connection',
    'support',
    'unknown'
  ));

CREATE INDEX IF NOT EXISTS idx_crm_contacts_interest_context
  ON public.crm_contacts (interest_context);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_telegram_user_id
  ON public.crm_contacts (telegram_user_id)
  WHERE telegram_user_id IS NOT NULL;
