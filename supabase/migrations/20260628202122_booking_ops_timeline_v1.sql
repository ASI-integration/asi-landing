-- Booking Ops Timeline v1.
-- Append-only internal lifecycle events. No outbound messages or sensitive document payloads.

CREATE TABLE IF NOT EXISTS public.booking_ops_events (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_ops_record_id UUID        NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  event_type            TEXT        NOT NULL,
  title                 TEXT        NOT NULL,
  description           TEXT,
  actor_type            TEXT        NOT NULL DEFAULT 'system',
  metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT booking_ops_events_actor_type_check
    CHECK (actor_type IN ('system', 'admin', 'readiness_gate', 'task_runner')),
  CONSTRAINT booking_ops_events_event_type_check
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
      'completion_effect_suggested'
    )),
  CONSTRAINT booking_ops_events_title_not_blank_check
    CHECK (length(btrim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_booking_ops_events_record_created
  ON public.booking_ops_events (booking_ops_record_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_ops_events_dedupe
  ON public.booking_ops_events (booking_ops_record_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.booking_ops_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_ops_events FROM anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.booking_ops_events TO service_role;

DROP POLICY IF EXISTS "service_role_read_events" ON public.booking_ops_events;
CREATE POLICY "service_role_read_events"
  ON public.booking_ops_events
  FOR SELECT
  TO service_role
  USING (true);

DROP POLICY IF EXISTS "service_role_insert_events" ON public.booking_ops_events;
CREATE POLICY "service_role_insert_events"
  ON public.booking_ops_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
