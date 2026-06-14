-- Adds intermediate manual CRM action statuses for dashboard lead handling.
-- Keeps existing and legacy statuses valid so old leads continue to open.

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_status_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_status_check
  CHECK (
    status IN (
      'new',
      'needs_pms_access',
      'instruction_sent',
      'access_received',
      'test_object_selected',
      'ready_for_setup',
      'qualified',
      'manual_reply_needed',
      'pilot_candidate',
      'not_fit',
      'archived',
      'contacted',
      'demo_offered',
      'closed'
    )
  );
