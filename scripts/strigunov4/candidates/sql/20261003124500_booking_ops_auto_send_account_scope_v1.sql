-- Wave 5: bind controlled auto-send scopes, runs and deliveries to canonical accounts.
-- Legacy non-global scopes are disabled before any backfill. Ambiguous owner/pilot
-- scopes intentionally remain unbound and cannot authorize account-scoped delivery.

ALTER TABLE public.booking_ops_communication_auto_send_scopes
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE public.booking_ops_communication_auto_send_runs
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE public.booking_ops_communication_deliveries
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

UPDATE public.booking_ops_communication_auto_send_scopes
SET actual_send_enabled = false,
    dry_run_only = true,
    disabled_at = COALESCE(disabled_at, now()),
    reason = COALESCE(reason, 'Disabled during account-scope migration.'),
    updated_at = now()
WHERE scope_type <> 'global';
WITH booking_matches AS (
  SELECT
    s.id AS scope_id,
    MIN(a.id::text)::uuid AS account_id
  FROM public.booking_ops_communication_auto_send_scopes s
  JOIN public.booking_ops_records b
    ON s.scope_type = 'booking'
   AND b.account_id IS NOT NULL
   AND (s.scope_ref = b.id::text OR s.scope_ref = b.booking_id)
  JOIN public.accounts a
    ON a.id::text = b.account_id
  GROUP BY s.id
  HAVING COUNT(DISTINCT a.id) = 1
)
UPDATE public.booking_ops_communication_auto_send_scopes s
SET account_id = m.account_id,
    updated_at = now()
FROM booking_matches m
WHERE s.id = m.scope_id
  AND s.account_id IS NULL;

WITH property_matches AS (
  SELECT
    s.id AS scope_id,
    MIN(p.account_id::text)::uuid AS account_id
  FROM public.booking_ops_communication_auto_send_scopes s
  JOIN public.properties p
    ON s.scope_type = 'property'
   AND s.scope_ref = p.id::text
  GROUP BY s.id
  HAVING COUNT(DISTINCT p.account_id) = 1
)
UPDATE public.booking_ops_communication_auto_send_scopes s
SET account_id = m.account_id,
    updated_at = now()
FROM property_matches m
WHERE s.id = m.scope_id
  AND s.account_id IS NULL;
UPDATE public.booking_ops_communication_deliveries d
SET account_id = a.id,
    updated_at = now()
FROM public.booking_ops_communication_intents i
JOIN public.booking_ops_records b
  ON b.id = i.booking_ops_record_id
JOIN public.accounts a
  ON a.id::text = b.account_id
WHERE d.communication_intent_id = i.id
  AND d.account_id IS NULL
  AND b.account_id IS NOT NULL;

DO $$
DECLARE
  old_constraint TEXT;
BEGIN
  SELECT c.conname
  INTO old_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'public.booking_ops_communication_auto_send_scopes'::regclass
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) LIKE 'UNIQUE (scope_type, scope_ref_key)%'
  LIMIT 1;

  IF old_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.booking_ops_communication_auto_send_scopes DROP CONSTRAINT %I',
      old_constraint
    );
  END IF;
END
$$;

ALTER TABLE public.booking_ops_communication_auto_send_scopes
  ADD COLUMN IF NOT EXISTS account_scope_key TEXT
  GENERATED ALWAYS AS (COALESCE(account_id::text, 'global')) STORED;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.booking_ops_communication_auto_send_scopes'::regclass
      AND conname = 'booking_ops_auto_send_scope_account_unique'
  ) THEN
    ALTER TABLE public.booking_ops_communication_auto_send_scopes
      ADD CONSTRAINT booking_ops_auto_send_scope_account_unique
      UNIQUE (account_scope_key, scope_type, scope_ref_key);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.booking_ops_communication_auto_send_scopes'::regclass
      AND conname = 'booking_ops_auto_send_scope_account_guard'
  ) THEN
    ALTER TABLE public.booking_ops_communication_auto_send_scopes
      ADD CONSTRAINT booking_ops_auto_send_scope_account_guard
      CHECK (
        (scope_type = 'global' AND account_id IS NULL)
        OR (
          scope_type <> 'global'
          AND (
            account_id IS NOT NULL
            OR (actual_send_enabled = false AND dry_run_only = true)
          )
        )
      );
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS idx_booking_ops_auto_send_scope_account
  ON public.booking_ops_communication_auto_send_scopes (account_id, scope_type, scope_ref)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_ops_auto_send_runs_account_started
  ON public.booking_ops_communication_auto_send_runs (account_id, started_at DESC)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_ops_communication_delivery_account
  ON public.booking_ops_communication_deliveries (account_id, created_at DESC)
  WHERE account_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
