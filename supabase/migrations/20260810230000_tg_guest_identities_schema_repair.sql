-- Production schema repair for tg_guest_identities.
--
-- The canonical guest-memory migration and the Guest Lifecycle synthetic
-- acceptance both expect display_name, trust_status, and last_seen_at. Some
-- production databases created tg_guest_identities before those additive
-- columns were introduced. Keep this repair additive and data-preserving.

ALTER TABLE public.tg_guest_identities
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS trust_status TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

DO $repair$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tg_guest_identities'::regclass
      AND conname = 'tg_guest_identities_trust_status_check'
  ) THEN
    ALTER TABLE public.tg_guest_identities
      ADD CONSTRAINT tg_guest_identities_trust_status_check
      CHECK (trust_status IN ('normal', 'trusted', 'suspicious'));
  END IF;
END
$repair$;

NOTIFY pgrst, 'reload schema';
