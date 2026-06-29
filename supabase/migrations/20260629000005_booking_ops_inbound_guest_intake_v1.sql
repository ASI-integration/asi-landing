-- Booking Ops inbound guest intake v1.
-- Tokenized guest entrypoint and safe submission audit. No outbound sends.

ALTER TABLE public.booking_ops_guest_intake_sessions
  ADD COLUMN IF NOT EXISTS public_token TEXT,
  ADD COLUMN IF NOT EXISTS token_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS token_opened_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_ops_guest_intake_public_token
  ON public.booking_ops_guest_intake_sessions (public_token)
  WHERE public_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.booking_ops_guest_intake_submissions (
  id UUID PRIMARY KEY,
  booking_ops_record_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  guest_intake_session_id UUID NOT NULL REFERENCES public.booking_ops_guest_intake_sessions(id) ON DELETE CASCADE,
  submission_source TEXT NOT NULL DEFAULT 'web',
  submitted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  attachment_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_status TEXT NOT NULL DEFAULT 'validation_needed',
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_ops_guest_intake_submissions_source_check
    CHECK (submission_source IN ('web', 'telegram', 'api')),
  CONSTRAINT booking_ops_guest_intake_submissions_status_check
    CHECK (validation_status IN (
      'partially_completed',
      'validation_needed',
      'completed',
      'fallback_required'
    )),
  CONSTRAINT booking_ops_guest_intake_submitted_fields_object_check
    CHECK (jsonb_typeof(submitted_fields) = 'object'),
  CONSTRAINT booking_ops_guest_intake_attachment_refs_array_check
    CHECK (jsonb_typeof(attachment_refs) = 'array'),
  CONSTRAINT booking_ops_guest_intake_submission_errors_array_check
    CHECK (jsonb_typeof(validation_errors) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_booking_ops_guest_intake_submissions_session
  ON public.booking_ops_guest_intake_submissions (guest_intake_session_id, created_at DESC);

ALTER TABLE public.booking_ops_guest_intake_submissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_ops_guest_intake_submissions FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.booking_ops_guest_intake_submissions TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_ops_guest_intake_submissions;
CREATE POLICY "service_role_full_access"
  ON public.booking_ops_guest_intake_submissions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.booking_ops_events
  DROP CONSTRAINT IF EXISTS booking_ops_events_event_type_check;

ALTER TABLE public.booking_ops_events
  ADD CONSTRAINT booking_ops_events_event_type_check
    CHECK (event_type IN (
      'booking_created',
      'booking_updated',
      'readiness_status_changed',
      'readiness_completed',
      'operational_task_created',
      'task_action_run',
      'telegram_draft_created',
      'telegram_draft_reused',
      'task_status_changed',
      'completion_effect_applied',
      'completion_effect_suggested',
      'turnover_started',
      'unit_readiness_changed',
      'communication_intent_created',
      'communication_draft_created',
      'communication_intent_superseded',
      'communication_waiting_for_external_input',
      'guest_intake_started',
      'guest_intake_updated',
      'guest_intake_completed',
      'guest_intake_fallback_required',
      'guest_intake_waiting_for_guest',
      'guest_intake_link_opened',
      'guest_intake_submission_received',
      'guest_intake_validation_failed',
      'guest_intake_partially_completed'
    ));

NOTIFY pgrst, 'reload schema';
