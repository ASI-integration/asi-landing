-- Guest Memory Tenant Isolation v1
-- Adds account_id to guest memory tables for tenant scoping.
-- This migration is additive (no data deleted) and must be applied
-- separately from the application deploy, before the tenant-scoped
-- application code ships.
--
-- account_id is nullable: pre-existing rows have no provable account
-- ownership and MUST remain inaccessible through the tenant-scoped
-- application code path (which always filters `.eq('account_id', accountId)`
-- with a non-null accountId) rather than being auto-assigned to a guess.

-- Add account_id column to guest_memory_profiles
ALTER TABLE public.guest_memory_profiles
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

-- Add account_id column to guest_memory_preferences
ALTER TABLE public.guest_memory_preferences
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

-- Add account_id column to guest_memory_events
ALTER TABLE public.guest_memory_events
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- guest_memory_profiles: the base migration made `guest_id` itself the
-- PRIMARY KEY, which forces exactly one profile row per guest GLOBALLY —
-- incompatible with per-account isolation (the same guest_id can be a real
-- guest at two different accounts' properties). Replace it with a surrogate
-- id and a composite unique index on (account_id, guest_id).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.guest_memory_profiles DROP CONSTRAINT IF EXISTS guest_memory_profiles_pkey;

ALTER TABLE public.guest_memory_profiles
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'guest_memory_profiles_id_pkey'
  ) THEN
    ALTER TABLE public.guest_memory_profiles ADD CONSTRAINT guest_memory_profiles_id_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- Legacy rows (account_id IS NULL) are intentionally NOT covered by this
-- unique index — Postgres treats each NULL as distinct, so pre-existing
-- single-row-per-guest_id legacy data cannot violate it, and the
-- account_id_required guards in application code mean no new NULL rows can
-- ever be written. This index is what makes `ON CONFLICT (account_id,
-- guest_id)` valid for the new tenant-scoped upsert in recordGuestSeen().
CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_memory_profiles_account_guest
  ON public.guest_memory_profiles (account_id, guest_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- guest_memory_preferences: the base migration's `UNIQUE (guest_id,
-- preference_key)` table constraint is NOT the same object as the
-- `uq_guest_memory_preferences_unique` index name and is never touched by a
-- `DROP INDEX`. Left in place, it would reject a second account's
-- legitimate active preference row for the same guest_id + preference_key
-- (i.e. it would actively break tenant isolation, not just fail to help).
-- Drop it explicitly by its actual (Postgres-assigned) constraint name.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop it by looking up its actual (Postgres-assigned) name rather than
-- assuming the default `<table>_<col1>_<col2>_key` naming convention, so
-- this migration is robust to how the base migration's constraint actually
-- got named.
DO $$
DECLARE
  legacy_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO legacy_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'guest_memory_preferences'
    AND con.contype = 'u'
    AND (
      SELECT array_agg(attname ORDER BY attname)
      FROM unnest(con.conkey) AS colnum
      JOIN pg_attribute attr ON attr.attrelid = con.conrelid AND attr.attnum = colnum
    ) = ARRAY['guest_id', 'preference_key']::text[];

  IF legacy_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.guest_memory_preferences DROP CONSTRAINT %I', legacy_constraint_name);
  END IF;
END $$;

-- Non-partial, matching the base migration's original (non-partial)
-- `UNIQUE (guest_id, preference_key)` semantics — a soft-deleted row is
-- reactivated in place on the next upsert for the same key, exactly as
-- before. This MUST stay non-partial: `upsertGuestPreference()` uses
-- Supabase's `.upsert(record, { onConflict: 'account_id,guest_id,preference_key' })`,
-- whose generated `ON CONFLICT (col_list)` (no WHERE) can only infer a
-- non-partial unique index/constraint as its arbiter — a partial index here
-- would make every upsert fail at runtime with "no unique or exclusion
-- constraint matching the ON CONFLICT specification".
CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_memory_preferences_unique
  ON public.guest_memory_preferences (account_id, guest_id, preference_key);

-- ─────────────────────────────────────────────────────────────────────────────
-- guest_memory_events: the base migration's only uniqueness guard is the
-- named partial index `uq_guest_memory_events_active_source`, which IS
-- correctly targeted by a DROP INDEX + recreate with account_id below.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS uq_guest_memory_events_active_source;
CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_memory_events_active_source
  ON public.guest_memory_events (account_id, guest_id, event_type, source_kind, source_ref)
  WHERE status = 'active' AND source_ref IS NOT NULL;

-- Add index for account-scoped queries
CREATE INDEX IF NOT EXISTS idx_guest_memory_profiles_account
  ON public.guest_memory_profiles (account_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_memory_preferences_account
  ON public.guest_memory_preferences (account_id, guest_id, updated_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_guest_memory_events_account
  ON public.guest_memory_events (account_id, guest_id, occurred_at DESC, created_at DESC)
  WHERE status = 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- The base migration's `update_guest_memory_stay_profile()` trigger inserts
-- into guest_memory_profiles ON CONFLICT (guest_id) whenever a
-- 'completed_stay' event is recorded. Left unmodified, this would upsert
-- into whichever pre-existing profile row happens to share guest_id
-- regardless of account_id — a direct cross-tenant write via a trigger the
-- application-layer account_id checks cannot see or prevent. It must key on
-- (account_id, guest_id), matching the new unique index above.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_guest_memory_stay_profile()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type = 'completed_stay' AND NEW.status = 'active' AND NEW.account_id IS NOT NULL THEN
    INSERT INTO public.guest_memory_profiles (
      guest_id,
      account_id,
      stay_count,
      first_seen_at,
      last_seen_at,
      last_stay_at
    ) VALUES (
      NEW.guest_id,
      NEW.account_id,
      1,
      NEW.occurred_at,
      NEW.occurred_at,
      NEW.occurred_at
    )
    ON CONFLICT (account_id, guest_id) DO UPDATE SET
      stay_count = public.guest_memory_profiles.stay_count + 1,
      last_seen_at = GREATEST(public.guest_memory_profiles.last_seen_at, EXCLUDED.last_seen_at),
      last_stay_at = GREATEST(public.guest_memory_profiles.last_stay_at, EXCLUDED.last_stay_at);
  END IF;
  RETURN NEW;
END;
$$;

-- Add check constraint for account_id format (defense in depth — the FK
-- above already enforces referential integrity to public.accounts).
ALTER TABLE public.guest_memory_profiles
  DROP CONSTRAINT IF EXISTS guest_memory_profiles_account_id_format;
ALTER TABLE public.guest_memory_preferences
  DROP CONSTRAINT IF EXISTS guest_memory_preferences_account_id_format;
ALTER TABLE public.guest_memory_events
  DROP CONSTRAINT IF EXISTS guest_memory_events_account_id_format;

COMMENT ON COLUMN public.guest_memory_profiles.account_id IS
  'Tenant account ID for memory isolation (FK to accounts.id). Required for all new writes. Legacy rows may be NULL and are inaccessible via the tenant-scoped application path.';
COMMENT ON COLUMN public.guest_memory_preferences.account_id IS
  'Tenant account ID for preference isolation (FK to accounts.id). Required for all new writes. Legacy rows may be NULL and are inaccessible via the tenant-scoped application path.';
COMMENT ON COLUMN public.guest_memory_events.account_id IS
  'Tenant account ID for event isolation (FK to accounts.id). Required for all new writes. Legacy rows may be NULL and are inaccessible via the tenant-scoped application path.';
