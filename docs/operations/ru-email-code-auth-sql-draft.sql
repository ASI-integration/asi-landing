-- SOURCE-ONLY DESIGN DRAFT. NOT AN EXECUTABLE MIGRATION AND NOT APPLIED.
-- Create a real numbered migration with the Supabase CLI after independent
-- security review and protected staging approval; do not manually run in prod.
-- All operations use the EXISTING service-role server connection and users table.

CREATE TABLE IF NOT EXISTS public.ru_auth_email_challenges (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  sent_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  window_start TIMESTAMPTZ NOT NULL,
  window_issues INTEGER NOT NULL DEFAULT 0 CHECK (window_issues BETWEEN 0 AND 5)
);
CREATE TABLE IF NOT EXISTS public.ru_auth_ip_limits (
  ip_hash TEXT PRIMARY KEY CHECK (ip_hash ~ '^[a-f0-9]{64}$'),
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count BETWEEN 0 AND 20)
);
ALTER TABLE public.ru_auth_email_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ru_auth_ip_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ru_auth_email_challenges, public.ru_auth_ip_limits FROM PUBLIC, anon, authenticated;
-- No anon/authenticated RLS policies. Server service_role only.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ru_auth_email_challenges, public.ru_auth_ip_limits TO service_role;

CREATE OR REPLACE FUNCTION public.ru_auth_issue_email_code(p_email TEXT, p_hash TEXT, p_ip_hash TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  now_at TIMESTAMPTZ := clock_timestamp();
  ip_row public.ru_auth_ip_limits%ROWTYPE;
  email_row public.ru_auth_email_challenges%ROWTYPE;
BEGIN
  IF p_email IS NULL OR length(p_email) > 254 OR
     p_hash !~ '^[a-f0-9]{64}$' OR p_ip_hash !~ '^[a-f0-9]{64}$'
    THEN RETURN FALSE; END IF;
  -- Lock same-IP before same-email in the same order in every issuance.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ru-otp-ip:' || p_ip_hash, 0));
  SELECT * INTO ip_row FROM public.ru_auth_ip_limits WHERE ip_hash = p_ip_hash FOR UPDATE;
  IF FOUND AND ip_row.window_start > now_at - INTERVAL '1 hour' AND ip_row.count >= 20 THEN RETURN FALSE; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ru-otp-email:' || p_email, 0));
  SELECT * INTO email_row FROM public.ru_auth_email_challenges WHERE email = p_email FOR UPDATE;
  IF FOUND AND email_row.sent_at > now_at - INTERVAL '60 seconds' THEN RETURN FALSE; END IF;
  IF FOUND AND email_row.window_start > now_at - INTERVAL '1 hour' AND email_row.window_issues >= 5 THEN RETURN FALSE; END IF;

  INSERT INTO public.ru_auth_ip_limits(ip_hash,window_start,count)
  VALUES(p_ip_hash,now_at,1)
  ON CONFLICT (ip_hash) DO UPDATE SET
    window_start = CASE WHEN ru_auth_ip_limits.window_start <= now_at - INTERVAL '1 hour'
      THEN now_at ELSE ru_auth_ip_limits.window_start END,
    count = CASE WHEN ru_auth_ip_limits.window_start <= now_at - INTERVAL '1 hour'
      THEN 1 ELSE ru_auth_ip_limits.count + 1 END;

  INSERT INTO public.ru_auth_email_challenges(email,code_hash,sent_at,expires_at,failed_attempts,window_start,window_issues)
  VALUES(p_email,p_hash,now_at,now_at+INTERVAL '10 minutes',0,now_at,1)
  ON CONFLICT (email) DO UPDATE SET
    code_hash=EXCLUDED.code_hash,sent_at=EXCLUDED.sent_at,expires_at=EXCLUDED.expires_at,
    failed_attempts=0,
    window_start=CASE WHEN ru_auth_email_challenges.window_start <= now_at - INTERVAL '1 hour'
      THEN now_at ELSE ru_auth_email_challenges.window_start END,
    window_issues=CASE WHEN ru_auth_email_challenges.window_start <= now_at - INTERVAL '1 hour'
      THEN 1 ELSE ru_auth_email_challenges.window_issues+1 END;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.ru_auth_consume_email_code(p_email TEXT,p_hash TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE row_value public.ru_auth_email_challenges%ROWTYPE;
BEGIN
  IF p_email IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RETURN FALSE; END IF;
  SELECT * INTO row_value FROM public.ru_auth_email_challenges WHERE email=p_email FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF row_value.expires_at <= clock_timestamp() OR row_value.failed_attempts >= 5 THEN
    RETURN FALSE;
  END IF;
  IF row_value.code_hash <> p_hash THEN
    UPDATE public.ru_auth_email_challenges SET failed_attempts=failed_attempts+1 WHERE email=p_email;
    RETURN FALSE;
  END IF;
  -- Invalidate code but PRESERVE the 1-hour email quota history.
  -- Deleting on successful verification would allow unlimited new challenges.
  UPDATE public.ru_auth_email_challenges
    SET expires_at=clock_timestamp(), failed_attempts=5
    WHERE email=p_email;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.ru_auth_revoke_email_code(p_email TEXT,p_hash TEXT)
RETURNS VOID LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$
  -- Preserve issuance budget even when the email transport fails.
  UPDATE public.ru_auth_email_challenges
    SET expires_at=clock_timestamp(), failed_attempts=5
    WHERE email=p_email AND code_hash=p_hash;
$$;

REVOKE ALL ON FUNCTION public.ru_auth_issue_email_code(TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ru_auth_consume_email_code(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ru_auth_revoke_email_code(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ru_auth_issue_email_code(TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ru_auth_consume_email_code(TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ru_auth_revoke_email_code(TEXT,TEXT) TO service_role;

-- Prior to enabling: independently test concurrency, 5 failed attempts, 60s
-- cooldown, 5/email/hour, 20/IP/hour, 10-minute expiry, replay and DB/RPC
-- authorization denials under anon and authenticated roles.
