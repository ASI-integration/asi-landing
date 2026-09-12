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

ALTER TABLE public.guest_memory_profiles
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE public.guest_memory_preferences
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE public.guest_memory_events
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

-- guest_memory_profiles: replace guest_id PRIMARY KEY with a surrogate id and
-- composite uniqueness on (account_id, guest_id) so the same guest can have
-- separate profiles under different accounts.

ALTER TABLE public.guest_memory_profiles DROP CONSTRAINT IF EXISTS guest_memory_profiles_pkey;

ALTER TABLE public.guest_memory_profiles
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'guest_memory_profiles'
      AND con.conname = 'guest_memory_profiles_id_pkey'
  ) THEN
    ALTER TABLE public.guest_memory_profiles ADD CONSTRAINT guest_memory_profiles_id_pkey PRIMARY KEY (id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_memory_profiles_account_guest
  ON public.guest_memory_profiles (account_id, guest_id);

-- Drop the legacy UNIQUE(guest_id, preference_key) constraint by introspection
-- so a second account can store the same preference_key for the same guest_id.

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
      SELECT array_agg(attr.attname::text ORDER BY attr.attname::text)
      FROM unnest(con.conkey) AS colnum
      JOIN pg_attribute attr ON attr.attrelid = con.conrelid AND attr.attnum = colnum
    ) = ARRAY['guest_id', 'preference_key']::text[];

  IF legacy_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.guest_memory_preferences DROP CONSTRAINT %I', legacy_constraint_name);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_memory_preferences_unique
  ON public.guest_memory_preferences (account_id, guest_id, preference_key);

DROP INDEX IF EXISTS uq_guest_memory_events_active_source;
CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_memory_events_active_source
  ON public.guest_memory_events (account_id, guest_id, event_type, source_kind, source_ref)
  WHERE status = 'active' AND source_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guest_memory_profiles_account
  ON public.guest_memory_profiles (account_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_memory_preferences_account
  ON public.guest_memory_preferences (account_id, guest_id, updated_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_guest_memory_events_account
  ON public.guest_memory_events (account_id, guest_id, occurred_at DESC, created_at DESC)
  WHERE status = 'active';

-- Stay-profile trigger must key on (account_id, guest_id), never guest_id alone.

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

-- Retention must prune per (account_id, guest_id), not globally by guest_id.

CREATE OR REPLACE FUNCTION public.prune_guest_memory_events()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.guest_memory_events AS events
  WHERE events.guest_id = NEW.guest_id
    AND events.account_id = NEW.account_id
    AND events.id IN (
      SELECT id
      FROM public.guest_memory_events
      WHERE guest_id = NEW.guest_id
        AND account_id = NEW.account_id
        AND status = 'active'
      ORDER BY occurred_at DESC, created_at DESC, id DESC
      OFFSET 50
    );
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.guest_memory_profiles.account_id IS
  'Tenant account ID for memory isolation (FK to accounts.id). Required for all new writes. Legacy rows may be NULL and are inaccessible via the tenant-scoped application path.';
COMMENT ON COLUMN public.guest_memory_preferences.account_id IS
  'Tenant account ID for preference isolation (FK to accounts.id). Required for all new writes. Legacy rows may be NULL and are inaccessible via the tenant-scoped application path.';
COMMENT ON COLUMN public.guest_memory_events.account_id IS
  'Tenant account ID for event isolation (FK to accounts.id). Required for all new writes. Legacy rows may be NULL and are inaccessible via the tenant-scoped application path.';
