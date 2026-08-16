-- Complete the production tg_property_knowledge schema required by the strict partner loader.
-- Additive and data-preserving only.

ALTER TABLE public.tg_property_knowledge
  ADD COLUMN IF NOT EXISTS wifi_notes TEXT,
  ADD COLUMN IF NOT EXISTS door_code_notes TEXT,
  ADD COLUMN IF NOT EXISTS parking_rules TEXT,
  ADD COLUMN IF NOT EXISTS parking_paid_or_free TEXT,
  ADD COLUMN IF NOT EXISTS parking_location_notes TEXT;

NOTIFY pgrst, 'reload schema';
