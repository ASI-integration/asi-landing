-- Wave 5: add canonical account lineage to inbound intake events.
-- Public/unresolved intake may remain unbound (account_id NULL) until a canonical
-- booking or property establishes ownership. Tenant dashboard reads never span
-- bound accounts.

ALTER TABLE public.booking_inbound_intake_events
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

UPDATE public.booking_inbound_intake_events e
SET account_id = b.account_id,
    updated_at = now()
FROM public.booking_ops_records b
WHERE e.account_id IS NULL
  AND e.booking_id = b.id
  AND b.account_id IS NOT NULL;

UPDATE public.booking_inbound_intake_events e
SET account_id = p.account_id,
    updated_at = now()
FROM public.properties p
WHERE e.account_id IS NULL
  AND e.booking_id IS NULL
  AND e.property_id = p.id::text
  AND p.account_id IS NOT NULL;

ALTER TABLE public.booking_inbound_intake_events
  DROP CONSTRAINT IF EXISTS booking_inbound_intake_events_idempotency_key_unique;

ALTER TABLE public.booking_inbound_intake_events
  ADD COLUMN IF NOT EXISTS account_scope_key TEXT
  GENERATED ALWAYS AS (COALESCE(account_id::text, 'unbound')) STORED;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.booking_inbound_intake_events'::regclass
      AND conname = 'booking_inbound_intake_events_account_idempotency_unique'
  ) THEN
    ALTER TABLE public.booking_inbound_intake_events
      ADD CONSTRAINT booking_inbound_intake_events_account_idempotency_unique
      UNIQUE (account_scope_key, idempotency_key);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_booking_inbound_intake_events_account_created
  ON public.booking_inbound_intake_events (account_id, created_at DESC)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_inbound_intake_events_account_status
  ON public.booking_inbound_intake_events (account_id, status, created_at DESC)
  WHERE account_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
