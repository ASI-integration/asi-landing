-- Real Booking Intake Autopilot v1: inbound request idempotency and audit trail.

CREATE TABLE IF NOT EXISTS public.booking_inbound_intake_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_ref text,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  booking_id uuid,
  guest_id text,
  owner_id text,
  property_id text,
  normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  automation_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text,
  duplicate_of_booking_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_inbound_intake_events_source_check
    CHECK (source IN ('web', 'telegram', 'admin', 'email_placeholder', 'channel_manager_placeholder')),
  CONSTRAINT booking_inbound_intake_events_status_check
    CHECK (status IN ('new', 'processed', 'duplicate', 'needs_review', 'failed')),
  CONSTRAINT booking_inbound_intake_events_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_booking_inbound_intake_events_booking
  ON public.booking_inbound_intake_events (booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_inbound_intake_events_status
  ON public.booking_inbound_intake_events (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_inbound_intake_events_source_ref
  ON public.booking_inbound_intake_events (source, source_ref)
  WHERE source_ref IS NOT NULL;

ALTER TABLE public.booking_inbound_intake_events ENABLE ROW LEVEL SECURITY;
