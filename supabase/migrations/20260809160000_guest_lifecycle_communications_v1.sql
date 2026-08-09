-- Guest Lifecycle Communications v1.
-- Canonical lifecycle ledger only. Delivery continues through the existing
-- Booking Ops communication intents, policy, delivery, and operator seams.

CREATE TABLE IF NOT EXISTS public.guest_lifecycle_events (
  id UUID PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  booking_ops_record_id UUID REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  scheduled_for TIMESTAMPTZ,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  communication_intent_id UUID REFERENCES public.booking_ops_communication_intents(id) ON DELETE SET NULL,
  delivery_id UUID REFERENCES public.booking_ops_communication_deliveries(id) ON DELETE SET NULL,
  operator_review_id TEXT,
  delivery_status TEXT,
  language TEXT,
  communication_mode TEXT,
  safe_communication_summary TEXT,
  operator_action_required BOOLEAN NOT NULL DEFAULT false,
  failure_reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT guest_lifecycle_event_type_check CHECK (event_type IN (
    'reservation.created', 'reservation.confirmed',
    'arrival.due_24h', 'arrival.due_3h', 'checkin.ready', 'guest.checked_in',
    'stay.active', 'stay.checkin_followup',
    'checkout.due_24h', 'checkout.due_3h',
    'late_checkout.requested', 'late_checkout.approved', 'late_checkout.denied',
    'guest.checked_out', 'stay.completed', 'reservation.cancelled',
    'incident.reported', 'incident.resolved'
  )),
  CONSTRAINT guest_lifecycle_stage_check CHECK (stage IN (
    'reservation', 'arrival', 'checkin', 'stay', 'checkout', 'completed', 'cancelled', 'incident'
  )),
  CONSTRAINT guest_lifecycle_status_check CHECK (status IN (
    'received', 'scheduled', 'processing', 'sent', 'dry_run', 'completed',
    'skipped', 'blocked', 'operator_required', 'failed'
  )),
  CONSTRAINT guest_lifecycle_language_check CHECK (language IS NULL OR language IN ('ru', 'en')),
  CONSTRAINT guest_lifecycle_mode_check CHECK (communication_mode IS NULL OR communication_mode IN ('text', 'voice')),
  CONSTRAINT guest_lifecycle_payload_object_check CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT guest_lifecycle_source_event_unique UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_guest_lifecycle_reservation_recent
  ON public.guest_lifecycle_events (reservation_id, occurred_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_lifecycle_due
  ON public.guest_lifecycle_events (scheduled_for, updated_at)
  WHERE status IN ('scheduled', 'failed');

CREATE INDEX IF NOT EXISTS idx_guest_lifecycle_operator_queue
  ON public.guest_lifecycle_events (operator_action_required, updated_at DESC)
  WHERE operator_action_required = true;

ALTER TABLE public.guest_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_lifecycle_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guest_lifecycle_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.guest_lifecycle_events TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.guest_lifecycle_events;
CREATE POLICY "service_role_full_access"
  ON public.guest_lifecycle_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.guest_lifecycle_events IS
  'Provider-neutral guest lifecycle event ledger. Payload excludes raw conversations, voice, access secrets, documents, and payment data.';

-- Check-in delivery is admitted to the existing policy seam only with exact
-- lifecycle identity/readiness metadata. Actual delivery remains disabled.
INSERT INTO public.booking_ops_communication_policies (
  id, scope, scope_ref, message_type, channel,
  auto_send_enabled, actual_send_enabled, requires_review,
  quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
  max_auto_sends_per_booking_per_day, max_auto_sends_per_guest_per_day,
  allowed_recipient_roles, blocked_keywords, required_metadata
)
VALUES (
  'f2000000-0000-4000-8000-000000000014', 'global', NULL, 'send_checkin_instructions', 'any',
  true, false, false,
  true, '22:00', '08:00',
  3, 3,
  '["guest"]', '[]', '["lifecycle_event_type","identity_verified","access_allowed"]'
)
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
