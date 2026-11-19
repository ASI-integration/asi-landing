-- #680 shadow-only least-privilege follow-up for #678.
-- The new grants table requires explicit SELECT permission for the server-side
-- role used by requirePropertyPermission. BYPASSRLS alone does not confer ACLs.
-- Does not grant UPDATE/INSERT/DELETE to service_role or access to anon.
-- Apply only to the confirmed isolated asi_shadow_migrations_test database
-- until an independently reviewed production migration is authorized.
BEGIN;
GRANT SELECT ON TABLE public.property_access_grants TO service_role;
COMMIT;
