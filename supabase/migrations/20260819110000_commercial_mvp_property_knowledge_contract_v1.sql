-- Complete the communication-facing tg_property_knowledge contract.
-- Additive and data-preserving only; no existing property values are rewritten.

ALTER TABLE public.tg_property_knowledge
  ADD COLUMN IF NOT EXISTS property_policy TEXT,
  ADD COLUMN IF NOT EXISTS wifi_instructions TEXT,
  ADD COLUMN IF NOT EXISTS parking_instructions TEXT,
  ADD COLUMN IF NOT EXISTS payment_rules TEXT,
  ADD COLUMN IF NOT EXISTS upsells TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contacts TEXT;

NOTIFY pgrst, 'reload schema';
