-- Guest Long-Term Memory v1 tenancy hardening.
-- Additive only. Existing legacy rows are intentionally NOT backfilled from guest_id:
-- ownership cannot be inferred safely from guest identity alone.
--
-- NOT VALID account checks preserve legacy rows while immediately rejecting every
-- new/updated unscoped row. Application reads always require account_id + guest_id.

ALTER TABLE public.guest_memory_profiles
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE public.guest_memory_preferences
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE public.guest_memory_events
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.guest_memory_profiles'::regclass
      AND conname = 'guest_memory_profiles_account_required'
  ) THEN
    ALTER TABLE public.guest_memory_profiles
      ADD CONSTRAINT guest_memory_profiles_account_required
      CHECK (account_id IS NOT NULL) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.guest_memory_preferences'::regclass
      AND conname = 'guest_memory_preferences_account_required'
  ) THEN
    ALTER TABLE public.guest_memory_preferences
      ADD CONSTRAINT guest_memory_preferences_account_required
      CHECK (account_id IS NOT NULL) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.guest_memory_events'::regclass
      AND conname = 'guest_memory_events_account_required'
  ) THEN
    ALTER TABLE public.guest_memory_events
      ADD CONSTRAINT guest_memory_events_account_required
      CHECK (account_id IS NOT NULL) NOT VALID;
  END IF;
END;
$$;

-- Profiles used guest_id as their primary key, which made the same canonical
-- guest identifier collide across tenants. Introduce a surrogate PK and make
-- tenant ownership part of the logical identity.
ALTER TABLE public.guest_memory_profiles
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

UPDATE public.guest_memory_profiles
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE public.guest_memory_profiles
  ALTER COLUMN id SET NOT NULL;

DO $$
DECLARE
  current_pk TEXT;
BEGIN
  SELECT conname INTO current_pk
  FROM pg_constraint
  WHERE conrelid = 'public.guest_memory_profiles'::regclass
    AND contype = 'p'
  LIMIT 1;

  IF current_pk IS NOT NULL AND current_pk <> 'guest_memory_profiles_id_pkey' THEN
    EXECUTE format('ALTER TABLE public.guest_memory_profiles DROP CONSTRAINT %I', current_pk);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.guest_memory_profiles'::regclass
      AND conname = 'guest_memory_profiles_id_pkey'
  ) THEN
    ALTER TABLE public.guest_memory_profiles
      ADD CONSTRAINT guest_memory_profiles_id_pkey PRIMARY KEY (id);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_memory_profiles_account_guest
  ON public.guest_memory_profiles (account_id, guest_id);

-- Replace the legacy preference uniqueness with account-scoped uniqueness.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.guest_memory_preferences'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (guest_id, preference_key)'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.guest_memory_preferences DROP CONSTRAINT %I', constraint_name);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_memory_preferences_account_guest_key
  ON public.guest_memory_preferences (account_id, guest_id, preference_key);

DROP INDEX IF EXISTS public.uq_guest_memory_events_active_source;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_memory_events_account_active_source
  ON public.guest_memory_events (account_id, guest_id, event_type, source_kind, source_ref)
  WHERE account_id IS NOT NULL AND status = 'active' AND source_ref IS NOT NULL;

DROP INDEX IF EXISTS public.idx_guest_memory_preferences_guest_active;
CREATE INDEX IF NOT EXISTS idx_guest_memory_preferences_account_guest_active
  ON public.guest_memory_preferences (account_id, guest_id, updated_at DESC)
  WHERE account_id IS NOT NULL AND status = 'active';

DROP INDEX IF EXISTS public.idx_guest_memory_events_guest_recent;
CREATE INDEX IF NOT EXISTS idx_guest_memory_events_account_guest_recent
  ON public.guest_memory_events (account_id, guest_id, occurred_at DESC, created_at DESC)
  WHERE account_id IS NOT NULL AND status = 'active';

CREATE OR REPLACE FUNCTION public.prune_guest_memory_events()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.guest_memory_events AS events
  WHERE events.account_id = NEW.account_id
    AND events.guest_id = NEW.guest_id
    AND events.id IN (
      SELECT id
      FROM public.guest_memory_events
      WHERE account_id = NEW.account_id
        AND guest_id = NEW.guest_id
        AND status = 'active'
      ORDER BY occurred_at DESC, created_at DESC, id DESC
      OFFSET 50
    );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_guest_memory_stay_profile()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.event_type = 'completed_stay' AND NEW.status = 'active' THEN
    INSERT INTO public.guest_memory_profiles (
      account_id,
      guest_id,
      stay_count,
      first_seen_at,
      last_seen_at,
      last_stay_at
    ) VALUES (
      NEW.account_id,
      NEW.guest_id,
      1,
      NEW.occurred_at,
      NEW.occurred_at,
      NEW.occurred_at
    )
    ON CONFLICT (account_id, guest_id)
    DO UPDATE SET
      stay_count = public.guest_memory_profiles.stay_count + 1,
      last_seen_at = GREATEST(public.guest_memory_profiles.last_seen_at, EXCLUDED.last_seen_at),
      last_stay_at = GREATEST(public.guest_memory_profiles.last_stay_at, EXCLUDED.last_stay_at);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.guest_memory_profiles.account_id IS
  'Canonical tenant owner. Legacy NULL rows are retained but inaccessible to scoped application reads.';
COMMENT ON COLUMN public.guest_memory_preferences.account_id IS
  'Canonical tenant owner. New/updated rows must be scoped by guest_memory_preferences_account_required.';
COMMENT ON COLUMN public.guest_memory_events.account_id IS
  'Canonical tenant owner. New/updated rows must be scoped by guest_memory_events_account_required.';
