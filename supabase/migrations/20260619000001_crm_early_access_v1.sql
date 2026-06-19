-- CRM v1 for ASI early access.
-- Extends the existing pilot CRM table when it is already present in production.

CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  contact TEXT,
  phone TEXT,
  telegram_username TEXT,
  telegram_user_id TEXT,
  telegram_chat_id TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'unknown',
  source TEXT NOT NULL DEFAULT 'manual',
  property_count INTEGER DEFAULT 0,
  city TEXT,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new_lead',
  communication_status TEXT NOT NULL DEFAULT 'no_contact',
  next_action TEXT NOT NULL DEFAULT '',
  next_action_due_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS communication_status TEXT NOT NULL DEFAULT 'no_contact';

ALTER TABLE public.crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_property_count_nonnegative;
ALTER TABLE public.crm_contacts
  ADD CONSTRAINT crm_contacts_property_count_nonnegative CHECK (property_count IS NULL OR property_count >= 0) NOT VALID;
ALTER TABLE public.crm_contacts VALIDATE CONSTRAINT crm_contacts_property_count_nonnegative;

ALTER TABLE public.crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_role_check;
ALTER TABLE public.crm_contacts
  ADD CONSTRAINT crm_contacts_role_check CHECK (role IN ('lead', 'owner', 'manager', 'partner', 'guest', 'unknown'));

ALTER TABLE public.crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_source_check;
ALTER TABLE public.crm_contacts
  ADD CONSTRAINT crm_contacts_source_check CHECK (source IN ('telegram', 'landing', 'form', 'manual', 'test', 'pilot_form', 'bragin_group', 'other'));

ALTER TABLE public.crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_status_check;
ALTER TABLE public.crm_contacts
  ADD CONSTRAINT crm_contacts_status_check CHECK (status IN (
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

ALTER TABLE public.crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_communication_status_check;
ALTER TABLE public.crm_contacts
  ADD CONSTRAINT crm_contacts_communication_status_check CHECK (communication_status IN (
    'no_contact',
    'wrote_first',
    'waiting_reply',
    'replied',
    'needs_manual_reaction',
    'has_problem',
    'escalation_closed'
  ));

CREATE OR REPLACE FUNCTION public.set_crm_contacts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_contacts_set_updated_at ON public.crm_contacts;
CREATE TRIGGER crm_contacts_set_updated_at
  BEFORE UPDATE ON public.crm_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_crm_contacts_updated_at();

CREATE INDEX IF NOT EXISTS idx_crm_contacts_status ON public.crm_contacts (status);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_source ON public.crm_contacts (source);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_next_action_due_at ON public.crm_contacts (next_action_due_at) WHERE next_action_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_created_at ON public.crm_contacts (created_at DESC);

ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contacts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON public.crm_contacts;
CREATE POLICY "service_role_full_access"
  ON public.crm_contacts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
