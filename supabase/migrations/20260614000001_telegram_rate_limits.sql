-- Soft rate-limit event history for ASI Telegram lead/support intake.
CREATE TABLE IF NOT EXISTS public.telegram_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (
    action_type IN (
      'lead_start',
      'lead_complete',
      'support_message',
      'prompt_injection',
      'webhook_message'
    )
  ),
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_telegram_rate_limits_user_action_created
  ON public.telegram_rate_limits (telegram_user_id, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telegram_rate_limits_created_at
  ON public.telegram_rate_limits (created_at DESC);

ALTER TABLE public.telegram_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_rate_limits FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.telegram_rate_limits FROM anon, authenticated;

DROP POLICY IF EXISTS "service_role_full_access" ON public.telegram_rate_limits;
CREATE POLICY "service_role_full_access"
  ON public.telegram_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
