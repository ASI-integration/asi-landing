-- Wave 5 follow-up: keep the SECURITY DEFINER trigger function off public RPC roles.
-- Supabase may grant EXECUTE explicitly to anon/authenticated when functions are created,
-- so revoke those role grants in addition to PUBLIC.

REVOKE ALL ON FUNCTION public.booking_ops_record_insert_scope_guard_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.booking_ops_record_insert_scope_guard_v1() FROM anon;
REVOKE ALL ON FUNCTION public.booking_ops_record_insert_scope_guard_v1() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.booking_ops_record_insert_scope_guard_v1() TO service_role;
