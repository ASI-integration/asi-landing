-- Booking Ops internal operational tasks v1.
-- Auto-created from readiness gate; manual tasks supported. No outbound sends.

CREATE TABLE IF NOT EXISTS public.booking_ops_tasks (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_ops_record_id UUID        NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  booking_id            TEXT,
  task_type             TEXT        NOT NULL,
  title                 TEXT        NOT NULL,
  description           TEXT,
  status                TEXT        NOT NULL DEFAULT 'open',
  priority              TEXT        NOT NULL DEFAULT 'normal',
  source                TEXT        NOT NULL DEFAULT 'readiness_gate',
  due_at                TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT booking_ops_tasks_status_check
    CHECK (status IN ('open', 'in_progress', 'blocked', 'completed', 'cancelled')),

  CONSTRAINT booking_ops_tasks_priority_check
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

  CONSTRAINT booking_ops_tasks_source_check
    CHECK (source IN ('readiness_gate', 'manual', 'system')),

  CONSTRAINT booking_ops_tasks_type_check
    CHECK (task_type IN (
      'complete_booking_data',
      'request_guest_documents',
      'verify_guest_documents',
      'prepare_contract',
      'send_contract_manual',
      'follow_up_contract_signature',
      'request_deposit',
      'confirm_deposit',
      'track_deposit_return',
      'collect_mvd_data',
      'prepare_mvd_report',
      'submit_mvd_report',
      'generate_telegram_drafts',
      'review_telegram_drafts',
      'manual_send_telegram_drafts'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_ops_tasks_open_dedup
  ON public.booking_ops_tasks (booking_ops_record_id, task_type)
  WHERE status IN ('open', 'in_progress', 'blocked');

CREATE INDEX IF NOT EXISTS idx_booking_ops_tasks_record_status
  ON public.booking_ops_tasks (booking_ops_record_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_ops_tasks_booking_id
  ON public.booking_ops_tasks (booking_id)
  WHERE booking_id IS NOT NULL;

ALTER TABLE public.booking_ops_tasks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_ops_tasks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_ops_tasks TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_ops_tasks;
CREATE POLICY "service_role_full_access"
  ON public.booking_ops_tasks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
