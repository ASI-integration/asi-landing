-- SOURCE-ONLY rollback; DOES NOT RECREATE the old FOUR-argument overload.
-- Restore previous function definition and ACL from private pre-migration
-- backup if rollback must fully restore the old API. DO NOT APPLY to shared DB.
BEGIN;
DO $rollback_gate$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('asi.acceptance_fixture_migration_authorized', true)
        IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'FIXTURE_ROLLBACK_NOT_AUTHORIZED';
  END IF;
END $rollback_gate$;
REVOKE ALL ON FUNCTION public.asi_mark_acceptance_fixture(uuid,text,text,text,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.asi_mark_acceptance_fixture(uuid,text,text,text,uuid,uuid,uuid);
COMMIT;
