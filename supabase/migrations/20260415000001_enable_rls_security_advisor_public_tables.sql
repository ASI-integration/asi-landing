-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Close "RLS Disabled in Public" (Security Advisor)
--
-- Principle:
--   - deny by default
--   - no "allow all authenticated"
--   - these tables are NOT meant for direct client access in this codebase;
--     all DB access is performed server-side with SUPABASE_SERVICE_ROLE_KEY
--
-- Notes:
--   - Guarded with to_regclass() so the migration is safe across environments
--     where some tables may not exist yet.
--   - We still add an explicit "service_role_full_access" policy to make intent
--     obvious and to prevent accidental anon/authenticated usage if someone
--     later introduces a client Supabase key.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Core multitenant tables
  IF to_regclass('public.accounts') IS NOT NULL THEN
    ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.accounts FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.accounts;
    CREATE POLICY "service_role_full_access"
      ON public.accounts
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.account_members') IS NOT NULL THEN
    ALTER TABLE public.account_members ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.account_members FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.account_members FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.account_members;
    CREATE POLICY "service_role_full_access"
      ON public.account_members
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.properties') IS NOT NULL THEN
    ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.properties FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.properties FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.properties;
    CREATE POLICY "service_role_full_access"
      ON public.properties
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.channels') IS NOT NULL THEN
    ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.channels FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.channels FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.channels;
    CREATE POLICY "service_role_full_access"
      ON public.channels
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.conversations') IS NOT NULL THEN
    ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.conversations FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.conversations;
    CREATE POLICY "service_role_full_access"
      ON public.conversations
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.message_turns') IS NOT NULL THEN
    ALTER TABLE public.message_turns ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.message_turns FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.message_turns FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.message_turns;
    CREATE POLICY "service_role_full_access"
      ON public.message_turns
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  -- Leads (PII) must never be readable from the client
  IF to_regclass('public.public_leads') IS NOT NULL THEN
    ALTER TABLE public.public_leads ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.public_leads FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.public_leads FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.public_leads;
    CREATE POLICY "service_role_full_access"
      ON public.public_leads
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  -- Automation spine (internal)
  IF to_regclass('public.automation_spine_events') IS NOT NULL THEN
    ALTER TABLE public.automation_spine_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.automation_spine_events FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.automation_spine_events FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.automation_spine_events;
    CREATE POLICY "service_role_full_access"
      ON public.automation_spine_events
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.automation_spine_action_log') IS NOT NULL THEN
    ALTER TABLE public.automation_spine_action_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.automation_spine_action_log FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.automation_spine_action_log FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.automation_spine_action_log;
    CREATE POLICY "service_role_full_access"
      ON public.automation_spine_action_log
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  -- Communication backbone (internal)
  IF to_regclass('public.communication_trigger_idempotency') IS NOT NULL THEN
    ALTER TABLE public.communication_trigger_idempotency ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.communication_trigger_idempotency FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.communication_trigger_idempotency FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.communication_trigger_idempotency;
    CREATE POLICY "service_role_full_access"
      ON public.communication_trigger_idempotency
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.communication_conversation_thread_events') IS NOT NULL THEN
    ALTER TABLE public.communication_conversation_thread_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.communication_conversation_thread_events FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.communication_conversation_thread_events FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.communication_conversation_thread_events;
    CREATE POLICY "service_role_full_access"
      ON public.communication_conversation_thread_events
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.communication_scheduled_reminders') IS NOT NULL THEN
    ALTER TABLE public.communication_scheduled_reminders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.communication_scheduled_reminders FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.communication_scheduled_reminders FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.communication_scheduled_reminders;
    CREATE POLICY "service_role_full_access"
      ON public.communication_scheduled_reminders
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.communication_conversation_messages') IS NOT NULL THEN
    ALTER TABLE public.communication_conversation_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.communication_conversation_messages FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.communication_conversation_messages FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.communication_conversation_messages;
    CREATE POLICY "service_role_full_access"
      ON public.communication_conversation_messages
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.communication_conversation_threads') IS NOT NULL THEN
    ALTER TABLE public.communication_conversation_threads ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.communication_conversation_threads FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.communication_conversation_threads FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.communication_conversation_threads;
    CREATE POLICY "service_role_full_access"
      ON public.communication_conversation_threads
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.communication_recipient_channel_mappings') IS NOT NULL THEN
    ALTER TABLE public.communication_recipient_channel_mappings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.communication_recipient_channel_mappings FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.communication_recipient_channel_mappings FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.communication_recipient_channel_mappings;
    CREATE POLICY "service_role_full_access"
      ON public.communication_recipient_channel_mappings
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  -- Delivery / DLQ (internal)
  IF to_regclass('public.delivery_attempts') IS NOT NULL THEN
    ALTER TABLE public.delivery_attempts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.delivery_attempts FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.delivery_attempts FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.delivery_attempts;
    CREATE POLICY "service_role_full_access"
      ON public.delivery_attempts
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.delivery_dead_letters') IS NOT NULL THEN
    ALTER TABLE public.delivery_dead_letters ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.delivery_dead_letters FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.delivery_dead_letters FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.delivery_dead_letters;
    CREATE POLICY "service_role_full_access"
      ON public.delivery_dead_letters
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  -- Knowledge workflow (internal)
  IF to_regclass('public.knowledge_approval_policies') IS NOT NULL THEN
    ALTER TABLE public.knowledge_approval_policies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.knowledge_approval_policies FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.knowledge_approval_policies FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.knowledge_approval_policies;
    CREATE POLICY "service_role_full_access"
      ON public.knowledge_approval_policies
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.knowledge_publish_bundles') IS NOT NULL THEN
    ALTER TABLE public.knowledge_publish_bundles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.knowledge_publish_bundles FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.knowledge_publish_bundles FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.knowledge_publish_bundles;
    CREATE POLICY "service_role_full_access"
      ON public.knowledge_publish_bundles
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.knowledge_publish_bundle_release_history') IS NOT NULL THEN
    ALTER TABLE public.knowledge_publish_bundle_release_history ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.knowledge_publish_bundle_release_history FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.knowledge_publish_bundle_release_history FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.knowledge_publish_bundle_release_history;
    CREATE POLICY "service_role_full_access"
      ON public.knowledge_publish_bundle_release_history
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF to_regclass('public.knowledge_review_requests') IS NOT NULL THEN
    ALTER TABLE public.knowledge_review_requests ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.knowledge_review_requests FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.knowledge_review_requests FROM anon, authenticated;
    DROP POLICY IF EXISTS "service_role_full_access" ON public.knowledge_review_requests;
    CREATE POLICY "service_role_full_access"
      ON public.knowledge_review_requests
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

