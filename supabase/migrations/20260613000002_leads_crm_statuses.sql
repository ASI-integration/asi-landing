-- Minimal CRM status expansion for the dashboard leads page.
-- Keeps legacy statuses valid so existing rows and older flows do not break.

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_status_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_status_check
  CHECK (
    status IN (
      'new',
      'qualified',
      'needs_pms_access',
      'ready_for_setup',
      'manual_reply_needed',
      'pilot_candidate',
      'not_fit',
      'archived',
      'contacted',
      'demo_offered',
      'closed'
    )
  );
