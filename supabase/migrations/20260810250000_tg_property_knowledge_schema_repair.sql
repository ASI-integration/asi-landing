-- Repair production schema drift for tg_property_knowledge required by Guest Lifecycle synthetic acceptance.
-- Additive and data-preserving only.

ALTER TABLE public.tg_property_knowledge
  ADD COLUMN IF NOT EXISTS access_notes TEXT,
  ADD COLUMN IF NOT EXISTS checkin_instructions TEXT,
  ADD COLUMN IF NOT EXISTS checkout_notes TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

NOTIFY pgrst, 'reload schema';
