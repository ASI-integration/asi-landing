-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: extend subscriptions for YooKassa + enable RLS
-- Apply via: Supabase Dashboard → SQL Editor, or `supabase db push`
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add YooKassa payment reference field (idempotent)
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS yoo_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS plan_type      TEXT NOT NULL DEFAULT 'autopilot_pro';

-- Add index for quick webhook lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_yoo_payment_id
  ON subscriptions(yoo_payment_id)
  WHERE yoo_payment_id IS NOT NULL;

-- 2. Extend status CHECK to include 'trialing' (mirrors Stripe conventions)
--    Existing values: 'trial', 'active', 'past_due', 'canceled'
--    New values add:  'trialing' (alias preferred in new code)
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('trial', 'trialing', 'active', 'past_due', 'canceled'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Drop old policies if re-running
DROP POLICY IF EXISTS "users_select_own_subscription"   ON subscriptions;
DROP POLICY IF EXISTS "service_role_full_access"        ON subscriptions;

-- Policy A: Users can read only their own subscription row.
--   Uses app.current_user_id session variable set by API routes that
--   use the anon key. Service-role key bypasses RLS entirely.
CREATE POLICY "users_select_own_subscription"
  ON subscriptions
  FOR SELECT
  USING (
    user_id = COALESCE(
      -- Supabase Auth path (future)
      auth.uid()::uuid,
      -- Custom JWT path: API sets this before querying with anon key
      NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

-- Policy B: Service-role (used by all current API routes) has unrestricted
--   access. This policy makes the intent explicit in the audit trail.
CREATE POLICY "service_role_full_access"
  ON subscriptions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Helper view: current subscription status for quick reads
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW active_subscriptions AS
  SELECT
    s.id,
    s.user_id,
    s.status,
    s.plan_type,
    s.yoo_payment_id,
    s.current_period_end,
    s.created_at,
    u.email
  FROM subscriptions s
  JOIN users u ON u.id = s.user_id
  WHERE s.status IN ('active', 'trialing');

COMMENT ON VIEW active_subscriptions IS
  'Convenience view: only rows with active or trialing status.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Done. Apply to dashboard, then verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'subscriptions';
-- ─────────────────────────────────────────────────────────────────────────────
