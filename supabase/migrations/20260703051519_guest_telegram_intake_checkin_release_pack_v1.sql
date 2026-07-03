-- Guest Telegram Intake & Check-in Release Pack v1.
-- Draft-only and service-role-only. No trigger or function performs an external send.

ALTER TABLE public.booking_ops_guest_intake_sessions
  ADD COLUMN IF NOT EXISTS property_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_username TEXT,
  ADD COLUMN IF NOT EXISTS guest_phone TEXT,
  ADD COLUMN IF NOT EXISTS guest_email TEXT,
  ADD COLUMN IF NOT EXISTS required_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS submitted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS operator_notes TEXT,
  ADD COLUMN IF NOT EXISTS escalation_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

ALTER TABLE public.booking_ops_guest_intake_sessions
  ADD CONSTRAINT booking_ops_guest_intake_required_fields_array_check
    CHECK (jsonb_typeof(required_fields) = 'array'),
  ADD CONSTRAINT booking_ops_guest_intake_submitted_fields_object_check
    CHECK (jsonb_typeof(submitted_fields) = 'object'),
  ADD CONSTRAINT booking_ops_guest_intake_escalation_status_check
    CHECK (escalation_status IN ('none', 'needed', 'draft_prepared', 'resolved'));

CREATE TABLE IF NOT EXISTS public.booking_ops_guest_intake_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.booking_ops_guest_intake_sessions(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_ops_guest_intake_events_type_check CHECK (event_type IN (
    'session_created', 'guest_message_draft_created', 'guest_submission_received',
    'validation_failed', 'validation_passed', 'operator_escalation_created',
    'intake_completed', 'intake_verified', 'checkin_release_blocked',
    'checkin_release_draft_created', 'release_simulated'
  )),
  CONSTRAINT booking_ops_guest_intake_events_actor_check
    CHECK (actor_type IN ('system', 'guest_simulated', 'operator', 'test'))
);

CREATE INDEX IF NOT EXISTS idx_booking_ops_guest_intake_events_session_created
  ON public.booking_ops_guest_intake_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_ops_guest_intake_events_booking_created
  ON public.booking_ops_guest_intake_events(booking_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_ops_checkin_release_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  guest_intake_session_id UUID NOT NULL REFERENCES public.booking_ops_guest_intake_sessions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'blocked',
  blocker_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  draft_channel TEXT NOT NULL DEFAULT 'telegram',
  draft_recipient TEXT,
  draft_body TEXT,
  prepared_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  released_simulated_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{"draftOnly":true,"noExternalSend":true}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_ops_checkin_release_status_check
    CHECK (status IN ('blocked', 'ready_for_draft', 'draft_prepared', 'released_simulated', 'cancelled')),
  CONSTRAINT booking_ops_checkin_release_blockers_array_check
    CHECK (jsonb_typeof(blocker_reasons) = 'array'),
  CONSTRAINT booking_ops_checkin_release_channel_check
    CHECK (draft_channel IN ('telegram', 'manual'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_ops_checkin_release_booking
  ON public.booking_ops_checkin_release_drafts(booking_id);

ALTER TABLE public.booking_ops_telegram_drafts
  DROP CONSTRAINT IF EXISTS booking_ops_telegram_drafts_action_check;
ALTER TABLE public.booking_ops_telegram_drafts
  ADD CONSTRAINT booking_ops_telegram_drafts_action_check CHECK (action_id IN (
    'request_guest_documents', 'send_contract', 'request_deposit', 'prepare_checkin_instructions',
    'initial_guest_intake', 'missing_guest_data', 'operator_guest_intake', 'final_checkin_instructions'
  ));

ALTER TABLE public.booking_ops_guest_intake_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_ops_checkin_release_drafts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_ops_guest_intake_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_ops_checkin_release_drafts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_ops_guest_intake_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_ops_checkin_release_drafts TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_ops_guest_intake_events;
CREATE POLICY "service_role_full_access" ON public.booking_ops_guest_intake_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_ops_checkin_release_drafts;
CREATE POLICY "service_role_full_access" ON public.booking_ops_checkin_release_drafts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
