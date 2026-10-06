-- Security hardening: pin search_path on trigger functions flagged by Supabase Advisor.
-- Function bodies and privileges are intentionally unchanged. An empty search_path keeps
-- resolution deterministic; all relation references used by these functions are schema-qualified
-- and PostgreSQL built-ins remain available through pg_catalog.

ALTER FUNCTION public.set_updated_at_asi_runtime_snapshots()
  SET search_path TO '';

ALTER FUNCTION public.set_updated_at_location_report_artifacts()
  SET search_path TO '';

ALTER FUNCTION public.set_updated_at_location_report_deliveries()
  SET search_path TO '';

ALTER FUNCTION public.set_updated_at_location_report_access_entitlements()
  SET search_path TO '';

ALTER FUNCTION public.set_updated_at_location_report_requests()
  SET search_path TO '';

ALTER FUNCTION public.set_guest_memory_updated_at()
  SET search_path TO '';

ALTER FUNCTION public.prune_guest_memory_events()
  SET search_path TO '';

ALTER FUNCTION public.normalize_guest_lifecycle_synthetic_scope_allowlist()
  SET search_path TO '';

ALTER FUNCTION public.update_guest_memory_stay_profile()
  SET search_path TO '';
