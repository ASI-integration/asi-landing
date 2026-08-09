-- Guest Long-Term Memory v1.
-- Durable, bounded operational memory keyed by the unified tg_contacts.id guestId.
-- This migration is additive and must be applied separately from application deploy.

CREATE TABLE IF NOT EXISTS public.guest_memory_profiles (
  guest_id TEXT PRIMARY KEY REFERENCES public.tg_contacts(id) ON DELETE CASCADE,
  preferred_language TEXT CHECK (preferred_language IS NULL OR preferred_language IN ('ru', 'en')),
  preferred_language_source TEXT,
  preferred_communication_mode TEXT
    CHECK (preferred_communication_mode IS NULL OR preferred_communication_mode IN ('text', 'voice')),
  preferred_communication_mode_source TEXT,
  stay_count INTEGER NOT NULL DEFAULT 0 CHECK (stay_count >= 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_stay_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.guest_memory_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id TEXT NOT NULL REFERENCES public.tg_contacts(id) ON DELETE CASCADE,
  preference_key TEXT NOT NULL CHECK (
    preference_key IN ('quiet_room', 'parking', 'late_checkout', 'accessibility', 'crib', 'pet')
  ),
  preference_value TEXT NOT NULL CHECK (char_length(preference_value) BETWEEN 1 AND 240),
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('explicit_guest', 'verified_booking', 'operator_confirmed', 'deterministic_system')
  ),
  source_ref TEXT CHECK (source_ref IS NULL OR char_length(source_ref) <= 160),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guest_id, preference_key)
);

CREATE TABLE IF NOT EXISTS public.guest_memory_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id TEXT NOT NULL REFERENCES public.tg_contacts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'completed_stay',
      'booking_verified',
      'maintenance_resolution',
      'operator_confirmed_resolution',
      'refund_outcome',
      'access_incident',
      'house_rule_violation',
      'late_checkout_history'
    )
  ),
  summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 600),
  booking_reference TEXT CHECK (booking_reference IS NULL OR char_length(booking_reference) <= 80),
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('verified_booking', 'operator_confirmed', 'deterministic_system')
  ),
  source_ref TEXT CHECK (source_ref IS NULL OR char_length(source_ref) <= 160),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_memory_preferences_guest_active
  ON public.guest_memory_preferences (guest_id, updated_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_guest_memory_events_guest_recent
  ON public.guest_memory_events (guest_id, occurred_at DESC, created_at DESC)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_memory_events_active_source
  ON public.guest_memory_events (guest_id, event_type, source_kind, source_ref)
  WHERE status = 'active' AND source_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_guest_memory_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guest_memory_profiles_updated_at ON public.guest_memory_profiles;
CREATE TRIGGER guest_memory_profiles_updated_at
BEFORE UPDATE ON public.guest_memory_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_guest_memory_updated_at();

DROP TRIGGER IF EXISTS guest_memory_preferences_updated_at ON public.guest_memory_preferences;
CREATE TRIGGER guest_memory_preferences_updated_at
BEFORE UPDATE ON public.guest_memory_preferences
FOR EACH ROW EXECUTE FUNCTION public.set_guest_memory_updated_at();

DROP TRIGGER IF EXISTS guest_memory_events_updated_at ON public.guest_memory_events;
CREATE TRIGGER guest_memory_events_updated_at
BEFORE UPDATE ON public.guest_memory_events
FOR EACH ROW EXECUTE FUNCTION public.set_guest_memory_updated_at();

-- Keep at most 50 active operational events for each guest. Older rows are
-- removed after every insert so retention cannot grow without bound.
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

DROP TRIGGER IF EXISTS guest_memory_events_bounded_retention ON public.guest_memory_events;
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
      guest_id,
      stay_count,
      first_seen_at,
      last_seen_at,
      last_stay_at
    ) VALUES (
      NEW.guest_id,
      1,
      NEW.occurred_at,
      NEW.occurred_at,
      NEW.occurred_at
    )
    ON CONFLICT (guest_id) DO UPDATE SET
      stay_count = public.guest_memory_profiles.stay_count + 1,
      last_seen_at = GREATEST(public.guest_memory_profiles.last_seen_at, EXCLUDED.last_seen_at),
      last_stay_at = GREATEST(public.guest_memory_profiles.last_stay_at, EXCLUDED.last_stay_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guest_memory_completed_stay_profile ON public.guest_memory_events;
CREATE TRIGGER guest_memory_completed_stay_profile
AFTER INSERT ON public.guest_memory_events
FOR EACH ROW EXECUTE FUNCTION public.update_guest_memory_stay_profile();

ALTER TABLE public.guest_memory_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_memory_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_memory_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guest_memory_profiles FROM anon, authenticated;
REVOKE ALL ON TABLE public.guest_memory_preferences FROM anon, authenticated;
REVOKE ALL ON TABLE public.guest_memory_events FROM anon, authenticated;

COMMENT ON TABLE public.guest_memory_profiles IS
  'Bounded guest profile keyed by the unified tg_contacts guestId; service-role only.';
COMMENT ON TABLE public.guest_memory_preferences IS
  'Replaceable explicit operational preferences with provenance; no transcripts or sensitive payloads.';
COMMENT ON TABLE public.guest_memory_events IS
  'At most 50 structured operational history events per guest; no raw conversations, audio, or document contents.';
