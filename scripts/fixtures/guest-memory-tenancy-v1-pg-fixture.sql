CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.accounts (
  id UUID PRIMARY KEY
);

CREATE TABLE public.tg_contacts (
  id TEXT PRIMARY KEY
);

CREATE TABLE public.guest_memory_profiles (
  guest_id TEXT PRIMARY KEY REFERENCES public.tg_contacts(id) ON DELETE CASCADE,
  preferred_language TEXT,
  preferred_language_source TEXT,
  preferred_communication_mode TEXT,
  preferred_communication_mode_source TEXT,
  stay_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_stay_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.guest_memory_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id TEXT NOT NULL REFERENCES public.tg_contacts(id) ON DELETE CASCADE,
  preference_key TEXT NOT NULL,
  preference_value TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_ref TEXT,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guest_id, preference_key)
);

CREATE TABLE public.guest_memory_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id TEXT NOT NULL REFERENCES public.tg_contacts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  booking_reference TEXT,
  source_kind TEXT NOT NULL,
  source_ref TEXT,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_guest_memory_preferences_guest_active
  ON public.guest_memory_preferences (guest_id, updated_at DESC)
  WHERE status = 'active';

CREATE INDEX idx_guest_memory_events_guest_recent
  ON public.guest_memory_events (guest_id, occurred_at DESC, created_at DESC)
  WHERE status = 'active';

CREATE UNIQUE INDEX uq_guest_memory_events_active_source
  ON public.guest_memory_events (guest_id, event_type, source_kind, source_ref)
  WHERE status = 'active' AND source_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prune_guest_memory_events()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.guest_memory_events AS events
  WHERE events.guest_id = NEW.guest_id
    AND events.id IN (
      SELECT id
      FROM public.guest_memory_events
      WHERE guest_id = NEW.guest_id
        AND status = 'active'
      ORDER BY occurred_at DESC, created_at DESC, id DESC
      OFFSET 50
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER guest_memory_events_bounded_retention
AFTER INSERT ON public.guest_memory_events
FOR EACH ROW EXECUTE FUNCTION public.prune_guest_memory_events();

CREATE OR REPLACE FUNCTION public.update_guest_memory_stay_profile()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type = 'completed_stay' AND NEW.status = 'active' THEN
    INSERT INTO public.guest_memory_profiles (
      guest_id, stay_count, first_seen_at, last_seen_at, last_stay_at
    ) VALUES (
      NEW.guest_id, 1, NEW.occurred_at, NEW.occurred_at, NEW.occurred_at
    )
    ON CONFLICT (guest_id) DO UPDATE SET
      stay_count = public.guest_memory_profiles.stay_count + 1,
      last_seen_at = GREATEST(public.guest_memory_profiles.last_seen_at, EXCLUDED.last_seen_at),
      last_stay_at = GREATEST(public.guest_memory_profiles.last_stay_at, EXCLUDED.last_stay_at);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guest_memory_completed_stay_profile
AFTER INSERT ON public.guest_memory_events
FOR EACH ROW EXECUTE FUNCTION public.update_guest_memory_stay_profile();
