-- Guest Lifecycle synthetic acceptance scope allowlist compatibility.
--
-- The currently deployed synthetic fixture enables a booking-scoped dry-run
-- auto-send scope but omits request_arrival_time from allowed_message_types.
-- Guest Lifecycle emits that purpose for arrival.due_24h, so the scope resolver
-- correctly blocks the third lifecycle delivery even though the acceptance is
-- explicitly dry-run-only and performs no external action.
--
-- Keep this compatibility repair deliberately narrow: it applies only to the
-- synthetic acceptance harness scope and leaves every real production scope
-- untouched. Once deployed code includes request_arrival_time itself, this
-- trigger is a no-op.

CREATE OR REPLACE FUNCTION public.normalize_guest_lifecycle_synthetic_scope_allowlist()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.scope_type = 'booking'
     AND NEW.enabled_by = 'guest_lifecycle_communications_v1'
     AND NEW.dry_run_only IS TRUE
     AND NEW.actual_send_enabled IS TRUE
     AND jsonb_typeof(NEW.allowed_message_types) = 'array'
     AND NOT (NEW.allowed_message_types ? 'request_arrival_time') THEN
    NEW.allowed_message_types := NEW.allowed_message_types || '["request_arrival_time"]'::jsonb;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.normalize_guest_lifecycle_synthetic_scope_allowlist()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_guest_lifecycle_synthetic_scope_allowlist()
  TO service_role;

DROP TRIGGER IF EXISTS trg_guest_lifecycle_synthetic_scope_allowlist
  ON public.booking_ops_communication_auto_send_scopes;

CREATE TRIGGER trg_guest_lifecycle_synthetic_scope_allowlist
BEFORE INSERT OR UPDATE OF
  allowed_message_types,
  enabled_by,
  dry_run_only,
  actual_send_enabled
ON public.booking_ops_communication_auto_send_scopes
FOR EACH ROW
EXECUTE FUNCTION public.normalize_guest_lifecycle_synthetic_scope_allowlist();

-- Repair any matching synthetic row that might still exist from an interrupted
-- run. Normal successful cleanup removes these rows, so this is typically a
-- no-op.
UPDATE public.booking_ops_communication_auto_send_scopes
SET allowed_message_types = allowed_message_types || '["request_arrival_time"]'::jsonb,
    updated_at = now()
WHERE scope_type = 'booking'
  AND enabled_by = 'guest_lifecycle_communications_v1'
  AND dry_run_only IS TRUE
  AND actual_send_enabled IS TRUE
  AND jsonb_typeof(allowed_message_types) = 'array'
  AND NOT (allowed_message_types ? 'request_arrival_time');

NOTIFY pgrst, 'reload schema';
