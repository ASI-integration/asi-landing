-- Property Knowledge v1 for internal Booking Ops check-in drafts.
-- Reuses tg_property_knowledge instead of creating a parallel property store.

ALTER TABLE public.tg_property_knowledge
  ADD COLUMN IF NOT EXISTS entrance_instructions TEXT,
  ADD COLUMN IF NOT EXISTS floor_apartment TEXT,
  ADD COLUMN IF NOT EXISTS intercom_code TEXT,
  ADD COLUMN IF NOT EXISTS key_pickup_instructions TEXT,
  ADD COLUMN IF NOT EXISTS quiet_hours TEXT,
  ADD COLUMN IF NOT EXISTS checkout_instructions TEXT,
  ADD COLUMN IF NOT EXISTS emergency_instructions TEXT,
  ADD COLUMN IF NOT EXISTS cleaning_linen_notes TEXT,
  ADD COLUMN IF NOT EXISTS public_guest_notes TEXT,
  ADD COLUMN IF NOT EXISTS private_operator_notes TEXT;

ALTER TABLE public.tg_property_knowledge ENABLE ROW LEVEL SECURITY;

-- Access codes and Wi-Fi passwords must never be readable through public roles.
REVOKE ALL ON TABLE public.tg_property_knowledge FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tg_property_knowledge TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.tg_property_knowledge;
CREATE POLICY "service_role_full_access"
  ON public.tg_property_knowledge
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
