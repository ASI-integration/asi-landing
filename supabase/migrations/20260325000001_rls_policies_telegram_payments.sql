-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: explicit RLS policies for operational_payments,
--            tg_conversation_sessions, tg_message_turns
--
-- Context:
--   All three tables are accessed exclusively via service_role key (server-side).
--   The service_role key bypasses RLS regardless of policies, so these policies
--   are not required for functionality. They are added to:
--     1. Make security intent explicit in the audit trail
--     2. Block any future accidental anon/authenticated access
--     3. Match the established pattern from subscriptions RLS migration
--
-- Apply via: Supabase Dashboard → SQL Editor, or `supabase db push`
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. operational_payments
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE operational_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON operational_payments;

-- Only service_role (backend) may read or write payment records.
-- No anon or authenticated user should ever access this table directly.
CREATE POLICY "service_role_full_access"
  ON operational_payments
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. tg_conversation_sessions
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tg_conversation_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON tg_conversation_sessions;

-- Only service_role (Telegram webhook handler, cron) may access session rows.
CREATE POLICY "service_role_full_access"
  ON tg_conversation_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. tg_message_turns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tg_message_turns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON tg_message_turns;

-- Only service_role (communication orchestrator) may insert/read message turns.
CREATE POLICY "service_role_full_access"
  ON tg_message_turns
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
