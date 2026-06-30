-- Communication auto-send guardrails v1.
-- This migration creates policy and audit storage only. It does not create an
-- external sender and does not enable Telegram/email delivery.

CREATE TABLE IF NOT EXISTS public.booking_ops_communication_policies (
  id UUID PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_ref TEXT,
  message_type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'any',
  auto_send_enabled BOOLEAN NOT NULL DEFAULT false,
  requires_review BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  max_auto_sends_per_booking_per_day INTEGER,
  max_auto_sends_per_guest_per_day INTEGER,
  allowed_recipient_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocked_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_metadata JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_ops_communication_policy_scope_check
    CHECK (scope IN ('global', 'owner', 'property', 'booking')),
  CONSTRAINT booking_ops_communication_policy_scope_ref_check
    CHECK ((scope = 'global' AND scope_ref IS NULL) OR (scope <> 'global' AND length(trim(scope_ref)) > 0)),
  CONSTRAINT booking_ops_communication_policy_channel_check
    CHECK (channel IN ('telegram', 'email', 'web', 'sms', 'phone', 'internal', 'manual', 'any')),
  CONSTRAINT booking_ops_communication_policy_booking_limit_check
    CHECK (max_auto_sends_per_booking_per_day IS NULL OR max_auto_sends_per_booking_per_day > 0),
  CONSTRAINT booking_ops_communication_policy_guest_limit_check
    CHECK (max_auto_sends_per_guest_per_day IS NULL OR max_auto_sends_per_guest_per_day > 0),
  CONSTRAINT booking_ops_communication_policy_roles_json_check
    CHECK (jsonb_typeof(allowed_recipient_roles) = 'array'),
  CONSTRAINT booking_ops_communication_policy_keywords_json_check
    CHECK (jsonb_typeof(blocked_keywords) = 'array'),
  CONSTRAINT booking_ops_communication_policy_metadata_json_check
    CHECK (jsonb_typeof(required_metadata) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_ops_communication_policy_key
  ON public.booking_ops_communication_policies (
    scope,
    COALESCE(scope_ref, ''),
    message_type,
    channel
  );

CREATE INDEX IF NOT EXISTS idx_booking_ops_communication_policy_lookup
  ON public.booking_ops_communication_policies (message_type, channel, scope, scope_ref);

CREATE TABLE IF NOT EXISTS public.booking_ops_communication_auto_send_attempts (
  id UUID PRIMARY KEY,
  communication_intent_id UUID NOT NULL
    REFERENCES public.booking_ops_communication_intents(id) ON DELETE CASCADE,
  result TEXT NOT NULL,
  booking_id TEXT,
  guest_ref TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_ops_communication_attempt_result_check
    CHECK (result IN (
      'allowed',
      'review_required',
      'blocked',
      'rate_limited',
      'quiet_hours',
      'missing_metadata',
      'unsafe_content',
      'unknown_message_type',
      'sent',
      'failed',
      'dry_run'
    )),
  CONSTRAINT booking_ops_communication_attempt_metadata_json_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_booking_ops_communication_attempt_intent_created
  ON public.booking_ops_communication_auto_send_attempts (communication_intent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_ops_communication_attempt_booking_created
  ON public.booking_ops_communication_auto_send_attempts (booking_id, created_at DESC)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_ops_communication_attempt_guest_created
  ON public.booking_ops_communication_auto_send_attempts (guest_ref, created_at DESC)
  WHERE guest_ref IS NOT NULL;

ALTER TABLE public.booking_ops_communication_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_ops_communication_auto_send_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_ops_communication_policies FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_ops_communication_auto_send_attempts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_ops_communication_policies TO service_role;
GRANT SELECT, INSERT ON TABLE public.booking_ops_communication_auto_send_attempts TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_ops_communication_policies;
CREATE POLICY "service_role_full_access"
  ON public.booking_ops_communication_policies
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_ops_communication_auto_send_attempts;
CREATE POLICY "service_role_full_access"
  ON public.booking_ops_communication_auto_send_attempts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- The default is fail-closed. Only low-risk message types are eligible, and
-- eligibility still does not perform delivery.
INSERT INTO public.booking_ops_communication_policies (
  id,
  scope,
  scope_ref,
  message_type,
  channel,
  auto_send_enabled,
  requires_review,
  quiet_hours_enabled,
  quiet_hours_start,
  quiet_hours_end,
  max_auto_sends_per_booking_per_day,
  max_auto_sends_per_guest_per_day,
  allowed_recipient_roles,
  blocked_keywords,
  required_metadata
)
VALUES
  ('f1000000-0000-4000-8000-000000000001', 'global', NULL, '*', 'any', false, true, true, '22:00', '08:00', 3, 3, '[]', '["cvv", "cvc", "код от двери", "код локбокса"]', '[]'),
  ('f1000000-0000-4000-8000-000000000002', 'global', NULL, 'guest_data_missing_notice', 'any', true, false, true, '22:00', '08:00', 3, 3, '["guest"]', '[]', '[]'),
  ('f1000000-0000-4000-8000-000000000003', 'global', NULL, 'arrival_confirmation_request', 'any', true, false, true, '22:00', '08:00', 3, 3, '["guest"]', '[]', '[]'),
  ('f1000000-0000-4000-8000-000000000004', 'global', NULL, 'checkout_confirmation_request', 'any', true, false, true, '22:00', '08:00', 3, 3, '["guest"]', '[]', '[]'),
  ('f1000000-0000-4000-8000-000000000005', 'global', NULL, 'guest_issue_acknowledgement', 'any', true, false, true, '22:00', '08:00', 3, 3, '["guest"]', '[]', '[]'),
  ('f1000000-0000-4000-8000-000000000006', 'global', NULL, 'cleaning_assignment', 'any', true, false, true, '22:00', '08:00', 8, NULL, '["cleaner"]', '[]', '[]'),
  ('f1000000-0000-4000-8000-000000000007', 'global', NULL, 'cleaning_reminder', 'any', true, false, true, '22:00', '08:00', 8, NULL, '["cleaner"]', '[]', '[]'),
  ('f1000000-0000-4000-8000-000000000008', 'global', NULL, 'maintenance_request', 'any', true, false, true, '22:00', '08:00', 8, NULL, '["master"]', '[]', '[]'),
  ('f1000000-0000-4000-8000-000000000009', 'global', NULL, 'repair_status_check', 'any', true, false, true, '22:00', '08:00', 8, NULL, '["master"]', '[]', '[]'),
  ('f1000000-0000-4000-8000-000000000010', 'global', NULL, 'unit_ready_notice', 'any', true, false, true, '22:00', '08:00', 4, NULL, '["owner", "admin"]', '[]', '[]'),
  ('f1000000-0000-4000-8000-000000000011', 'global', NULL, 'readiness_confirmation_needed', 'any', true, false, true, '22:00', '08:00', 8, NULL, '["admin"]', '[]', '[]')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
