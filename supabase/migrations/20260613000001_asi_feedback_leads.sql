-- Public ASI Feedback Telegram bot leads.
-- Server-only access: Telegram webhook writes through SUPABASE_SERVICE_ROLE_KEY.

CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id TEXT NOT NULL,
  telegram_username TEXT,
  first_name TEXT,
  source TEXT NOT NULL DEFAULT 'unknown',
  answers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT leads_source_check
    CHECK (source IN ('site', 'tenchat', 'dzen', 'telegram_group', 'partner', 'unknown')),

  CONSTRAINT leads_status_check
    CHECK (status IN ('new', 'contacted', 'qualified', 'demo_offered', 'pilot_candidate', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_leads_telegram_user_id
  ON public.leads (telegram_user_id);

CREATE INDEX IF NOT EXISTS idx_leads_status_created_at
  ON public.leads (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_source_created_at
  ON public.leads (source, created_at DESC);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.leads FROM anon, authenticated;

DROP POLICY IF EXISTS "service_role_full_access" ON public.leads;

CREATE POLICY "service_role_full_access"
  ON public.leads
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
