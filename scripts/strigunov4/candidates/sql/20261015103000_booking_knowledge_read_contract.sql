-- Complete the existing Booking Ops read contract without sample property data.
-- Additive only; no send policy is enabled and public roles retain no access.
ALTER TABLE public.tg_property_knowledge
  ADD COLUMN IF NOT EXISTS object_name text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS check_in_instructions text,
  ADD COLUMN IF NOT EXISTS check_in_text text,
  ADD COLUMN IF NOT EXISTS key_instructions text,
  ADD COLUMN IF NOT EXISTS parking_instructions text,
  ADD COLUMN IF NOT EXISTS parking_text text,
  ADD COLUMN IF NOT EXISTS house_rules text,
  ADD COLUMN IF NOT EXISTS house_rules_text text,
  ADD COLUMN IF NOT EXISTS check_out_instructions text,
  ADD COLUMN IF NOT EXISTS emergency_contacts text,
  ADD COLUMN IF NOT EXISTS escalation_contact_text text;
GRANT SELECT ON public.booking_property_setup_profiles TO service_role;
NOTIFY pgrst, 'reload schema';
