-- Durable idempotency claims for payment provider webhooks and guest
-- payment-confirmation delivery. Contains provider/payment identifiers only;
-- no request bodies, credentials, or guest message content.

CREATE TABLE IF NOT EXISTS public.payment_event_dedup (
  dedupe_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('webhook', 'confirmation')),
  provider TEXT,
  event_id TEXT,
  payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_event_dedup_shape CHECK (
    (kind = 'webhook' AND provider IS NOT NULL AND event_id IS NOT NULL AND payment_id IS NULL)
    OR
    (kind = 'confirmation' AND provider IS NULL AND event_id IS NULL AND payment_id IS NOT NULL)
  )
);

ALTER TABLE public.payment_event_dedup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_event_dedup FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_event_dedup FROM anon, authenticated;

DROP POLICY IF EXISTS "service_role_full_access" ON public.payment_event_dedup;
CREATE POLICY "service_role_full_access"
  ON public.payment_event_dedup
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
