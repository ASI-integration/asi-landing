-- Controlled actual auto-send v1 (production migration 20260701043157).
-- Eligibility and actual delivery are deliberately separate: existing global
-- eligibility rules remain useful, while actual delivery stays disabled until
-- an owner/property/booking scope explicitly enables it.

ALTER TABLE public.booking_ops_communication_policies
  ADD COLUMN IF NOT EXISTS actual_send_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.booking_ops_communication_deliveries (
  id UUID PRIMARY KEY,
  communication_intent_id UUID NOT NULL
    REFERENCES public.booking_ops_communication_intents(id) ON DELETE CASCADE,
  booking_id TEXT,
  recipient_role TEXT NOT NULL,
  recipient_ref TEXT,
  channel TEXT NOT NULL,
  message_type TEXT NOT NULL,
  policy_decision_id UUID
    REFERENCES public.booking_ops_communication_policies(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  failure_reason TEXT,
  safe_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_ops_communication_delivery_channel_check
    CHECK (channel IN ('telegram', 'email', 'web', 'sms')),
  CONSTRAINT booking_ops_communication_delivery_status_check
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped', 'blocked', 'dry_run')),
  CONSTRAINT booking_ops_communication_delivery_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT booking_ops_communication_delivery_metadata_json_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_booking_ops_communication_delivery_intent
  ON public.booking_ops_communication_deliveries (communication_intent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_ops_communication_delivery_queue
  ON public.booking_ops_communication_deliveries (status, created_at)
  WHERE status IN ('queued', 'failed', 'dry_run');

CREATE INDEX IF NOT EXISTS idx_booking_ops_communication_delivery_booking
  ON public.booking_ops_communication_deliveries (booking_id, created_at DESC)
  WHERE booking_id IS NOT NULL;

ALTER TABLE public.booking_ops_communication_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_ops_communication_deliveries FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_ops_communication_deliveries TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_ops_communication_deliveries;
CREATE POLICY "service_role_full_access"
  ON public.booking_ops_communication_deliveries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Explicitly preserve fail-closed global delivery even if an older policy row
-- was marked eligible by guardrails v1.
UPDATE public.booking_ops_communication_policies
SET actual_send_enabled = false,
    updated_at = now()
WHERE scope = 'global';

-- These rows classify the only message types that may enter the controlled
-- queue. Actual delivery remains false globally and therefore still requires a
-- narrower owner/property/booking override.
INSERT INTO public.booking_ops_communication_policies (
  id, scope, scope_ref, message_type, channel,
  auto_send_enabled, actual_send_enabled, requires_review,
  quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
  max_auto_sends_per_booking_per_day, max_auto_sends_per_guest_per_day,
  allowed_recipient_roles, blocked_keywords, required_metadata
)
VALUES
  ('f2000000-0000-4000-8000-000000000001', 'global', NULL, 'request_missing_guest_data', 'any', true, false, false, true, '22:00', '08:00', 3, 3, '["guest"]', '[]', '[]'),
  ('f2000000-0000-4000-8000-000000000002', 'global', NULL, 'request_arrival_time', 'any', true, false, false, true, '22:00', '08:00', 3, 3, '["guest"]', '[]', '[]'),
  ('f2000000-0000-4000-8000-000000000003', 'global', NULL, 'neutral_booking_acknowledgement', 'any', true, false, false, true, '22:00', '08:00', 3, 3, '["guest"]', '[]', '[]'),
  ('f2000000-0000-4000-8000-000000000004', 'global', NULL, 'neutral_status_update', 'any', true, false, false, true, '22:00', '08:00', 3, 3, '["guest"]', '[]', '[]'),
  ('f2000000-0000-4000-8000-000000000005', 'global', NULL, 'cleaner_task_assignment', 'any', true, false, false, true, '22:00', '08:00', 8, NULL, '["cleaner"]', '[]', '[]'),
  ('f2000000-0000-4000-8000-000000000006', 'global', NULL, 'cleaner_task_reminder', 'any', true, false, false, true, '22:00', '08:00', 8, NULL, '["cleaner"]', '[]', '[]'),
  ('f2000000-0000-4000-8000-000000000007', 'global', NULL, 'linen_task_assignment', 'any', true, false, false, true, '22:00', '08:00', 8, NULL, '["laundry"]', '[]', '[]'),
  ('f2000000-0000-4000-8000-000000000008', 'global', NULL, 'inspection_task_assignment', 'any', true, false, false, true, '22:00', '08:00', 8, NULL, '["admin"]', '[]', '[]'),
  ('f2000000-0000-4000-8000-000000000009', 'global', NULL, 'master_task_assignment', 'any', true, false, false, true, '22:00', '08:00', 8, NULL, '["master"]', '[]', '[]'),
  ('f2000000-0000-4000-8000-000000000010', 'global', NULL, 'master_task_reminder', 'any', true, false, false, true, '22:00', '08:00', 8, NULL, '["master"]', '[]', '[]'),
  ('f2000000-0000-4000-8000-000000000011', 'global', NULL, 'internal_status_notice', 'any', true, false, false, true, '22:00', '08:00', 8, NULL, '["admin","owner"]', '[]', '[]'),
  ('f2000000-0000-4000-8000-000000000012', 'global', NULL, 'fallback_created_notice', 'any', true, false, false, true, '22:00', '08:00', 8, NULL, '["admin","owner"]', '[]', '[]'),
  ('f2000000-0000-4000-8000-000000000013', 'global', NULL, 'task_overdue_notice', 'any', true, false, false, true, '22:00', '08:00', 8, NULL, '["admin","owner"]', '[]', '[]')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
