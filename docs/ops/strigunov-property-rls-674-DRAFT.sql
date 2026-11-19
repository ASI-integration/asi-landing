-- #674 DRAFT ONLY: not a deployed Supabase migration.
-- Preconditions before any apply:
--  1. Map iron-session public.users IDs to verified auth.uid() JWT IDs;
--  2. Backfill explicitly approved per-property grants (no default grants);
--  3. Test existing RLS policies and service_role bypass using a disposable DB;
--  4. Review/update server API gates; require exact-SHA release authorization.
-- No production/shared Supabase DDL or data access is authorized by this file.

BEGIN;

CREATE TABLE IF NOT EXISTS public.property_access_grants (
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  property_id uuid NOT NULL REFERENCES public.properties(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  role text NOT NULL CHECK (role IN ('owner','manager','operator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, property_id, user_id)
);
CREATE INDEX IF NOT EXISTS property_access_grants_actor_idx
  ON public.property_access_grants(user_id, account_id);

-- Enforce both the property/account relationship and current membership
-- at the *database* boundary, including against service_role writes.
CREATE OR REPLACE FUNCTION public.property_grant_scope_guard_674()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.properties p
    WHERE p.id = NEW.property_id AND p.account_id = NEW.account_id)
    OR NOT EXISTS (SELECT 1 FROM public.account_members m
      WHERE m.user_id = NEW.user_id AND m.account_id = NEW.account_id
        AND (m.role = NEW.role
          OR (m.role = 'owner' AND NEW.role IN ('manager','operator'))
          OR (m.role = 'manager' AND NEW.role = 'operator')))
  THEN
    RAISE EXCEPTION 'property_grant_scope_mismatch' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.property_grant_scope_guard_674() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS property_grant_scope_guard_674 ON public.property_access_grants;
CREATE TRIGGER property_grant_scope_guard_674
  BEFORE INSERT OR UPDATE ON public.property_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.property_grant_scope_guard_674();

-- This helper is valid only if the upstream PostgREST gateway verifies JWTs.
-- It does NOT protect server calls made with the Supabase service_role key.
CREATE OR REPLACE FUNCTION public.property_scoped_access_674(
  p_account text, p_property text, p_finance boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.property_access_grants g
    JOIN public.account_members m ON m.user_id = g.user_id AND m.account_id = g.account_id
    JOIN public.properties p ON p.id = g.property_id AND p.account_id = g.account_id
    WHERE g.user_id = auth.uid() AND auth.uid() IS NOT NULL
      AND g.account_id::text = p_account AND g.property_id::text = p_property
      AND (m.role = g.role
        OR (m.role = 'owner' AND g.role IN ('manager','operator'))
        OR (m.role = 'manager' AND g.role = 'operator'))
      AND ((p_finance AND g.role = 'owner')
        OR (NOT p_finance AND g.role IN ('owner','manager')))
  )
$$;
REVOKE ALL ON FUNCTION public.property_scoped_access_674(text,text,boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.property_scoped_access_674(text,text,boolean)
  TO authenticated;

ALTER TABLE public.property_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_ops_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_payout_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger_entries ENABLE ROW LEVEL SECURITY;

-- Add restrictive fences so other permissive policies cannot broaden access.
DROP POLICY IF EXISTS property_grants_self_674 ON public.property_access_grants;
CREATE POLICY property_grants_self_674 ON public.property_access_grants
  AS RESTRICTIVE FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS property_grants_allow_674 ON public.property_access_grants;
CREATE POLICY property_grants_allow_674 ON public.property_access_grants
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS properties_scope_restrict_674 ON public.properties;
CREATE POLICY properties_scope_restrict_674 ON public.properties
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.property_scoped_access_674(account_id::text,id::text,false));
DROP POLICY IF EXISTS properties_scope_allow_674 ON public.properties;
CREATE POLICY properties_scope_allow_674 ON public.properties
  FOR SELECT TO authenticated
  USING (public.property_scoped_access_674(account_id::text,id::text,false));

DROP POLICY IF EXISTS bookings_scope_restrict_674 ON public.booking_ops_records;
CREATE POLICY bookings_scope_restrict_674 ON public.booking_ops_records
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.property_scoped_access_674(account_id,property_id,false));
DROP POLICY IF EXISTS bookings_scope_allow_674 ON public.booking_ops_records;
CREATE POLICY bookings_scope_allow_674 ON public.booking_ops_records
  FOR SELECT TO authenticated
  USING (public.property_scoped_access_674(account_id,property_id,false));

DROP POLICY IF EXISTS owner_finance_scope_restrict_674 ON public.owner_payout_reports;
CREATE POLICY owner_finance_scope_restrict_674 ON public.owner_payout_reports
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.property_scoped_access_674(account_id::text,property_id::text,true));
DROP POLICY IF EXISTS owner_finance_scope_allow_674 ON public.owner_payout_reports;
CREATE POLICY owner_finance_scope_allow_674 ON public.owner_payout_reports
  FOR SELECT TO authenticated
  USING (public.property_scoped_access_674(account_id::text,property_id::text,true));

DROP POLICY IF EXISTS ledger_scope_restrict_674 ON public.financial_ledger_entries;
CREATE POLICY ledger_scope_restrict_674 ON public.financial_ledger_entries
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.property_scoped_access_674(account_id::text,property_id::text,true));
DROP POLICY IF EXISTS ledger_scope_allow_674 ON public.financial_ledger_entries;
CREATE POLICY ledger_scope_allow_674 ON public.financial_ledger_entries
  FOR SELECT TO authenticated
  USING (public.property_scoped_access_674(account_id::text,property_id::text,true));

-- No authenticated writes to finance or grants; service writes need server checks.
REVOKE ALL ON public.property_access_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.property_access_grants TO authenticated;
-- Authenticate every RLS user against PostgREST's *verified* JWT context.
-- The browser cannot set these PostgreSQL settings directly. The Next server
-- signs a 60-second JWT only after verifying iron-session and DB membership.
-- These claims are NOT trusted when supplied as client input or session fields.
CREATE OR REPLACE FUNCTION public.shadow_claims_674()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN coalesce(current_setting('request.jwt.claims', true), '') <> ''
    THEN current_setting('request.jwt.claims', true)::jsonb ELSE '{}'::jsonb END
$$;
REVOKE ALL ON FUNCTION public.shadow_claims_674() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shadow_claims_674() TO authenticated;

CREATE OR REPLACE FUNCTION public.shadow_user_id_674()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN
    public.shadow_claims_674()->>'iss' = 'asi-shadow-iron-session-674'
    AND public.shadow_claims_674()->>'role' = 'authenticated'
    AND public.shadow_claims_674()->>'sub'
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (public.shadow_claims_674()->>'sub')::uuid ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.shadow_user_id_674() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shadow_user_id_674() TO authenticated;

-- SECURITY DEFINER is required only to look up grants without recursive RLS.
-- Fixed search_path, verified claims and explicit EXECUTE grants are mandatory.
CREATE OR REPLACE FUNCTION public.property_scoped_access_674(
  p_account text, p_property text, p_finance boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.property_access_grants g
    JOIN public.account_members m ON m.account_id = g.account_id AND m.user_id = g.user_id
    JOIN public.properties p ON p.id = g.property_id AND p.account_id = g.account_id
    WHERE g.user_id = public.shadow_user_id_674()
      AND g.account_id::text = p_account AND g.property_id::text = p_property
      AND public.shadow_claims_674()->>'account_id' = p_account
      AND public.shadow_claims_674()->>'property_id' = p_property
      AND public.shadow_claims_674()->>'app_role' = g.role
      AND (m.role = g.role
        OR (m.role = 'owner' AND g.role IN ('manager','operator'))
        OR (m.role = 'manager' AND g.role = 'operator'))
      AND ((p_finance AND g.role = 'owner')
        OR (NOT p_finance AND g.role IN ('owner','manager')))
  )
$$;
REVOKE ALL ON FUNCTION public.property_scoped_access_674(text,text,boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.property_scoped_access_674(text,text,boolean) TO authenticated;

-- Tasks have no account_id; resolve it through the property and verify the JWT
-- account/property/grant. Operators can see only assigned, approved task types.
CREATE OR REPLACE FUNCTION public.property_task_access_674(
  p_property text, p_assignee text, p_task_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.properties p
    JOIN public.property_access_grants g ON g.property_id = p.id AND g.account_id = p.account_id
    JOIN public.account_members m ON m.account_id = g.account_id AND m.user_id = g.user_id
    WHERE p.id::text = p_property
      AND g.user_id = public.shadow_user_id_674()
      AND public.shadow_claims_674()->>'account_id' = p.account_id::text
      AND public.shadow_claims_674()->>'property_id' = p_property
      AND public.shadow_claims_674()->>'app_role' = g.role
      AND (m.role = g.role
        OR (m.role = 'owner' AND g.role IN ('manager','operator'))
        OR (m.role = 'manager' AND g.role = 'operator'))
      AND (g.role IN ('owner','manager')
        OR (g.role = 'operator' AND p_assignee = g.user_id::text
          AND p_task_type IN ('turnover:cleaning','turnover:linen','turnover:supplies','turnover:inspection')))
  )
$$;
REVOKE ALL ON FUNCTION public.property_task_access_674(text,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.property_task_access_674(text,text,text) TO authenticated;

-- Previously auth.uid() required Supabase Auth; use the same PostgREST JWT
-- claim for grants instead. This policy is read-only for authenticated users.
DROP POLICY IF EXISTS property_grants_self_674 ON public.property_access_grants;
CREATE POLICY property_grants_self_674 ON public.property_access_grants
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id = public.shadow_user_id_674()
    AND account_id::text = public.shadow_claims_674()->>'account_id'
    AND property_id::text = public.shadow_claims_674()->>'property_id');
DROP POLICY IF EXISTS property_grants_allow_674 ON public.property_access_grants;
CREATE POLICY property_grants_allow_674 ON public.property_access_grants
  FOR SELECT TO authenticated USING (user_id = public.shadow_user_id_674()
    AND account_id::text = public.shadow_claims_674()->>'account_id'
    AND property_id::text = public.shadow_claims_674()->>'property_id');

ALTER TABLE public.ops_tasks ADD COLUMN IF NOT EXISTS work_kind text CHECK (work_kind IN ('cleaning','linen','supplies','inspection'));
ALTER TABLE public.ops_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ops_tasks_scope_restrict_674 ON public.ops_tasks;
CREATE POLICY ops_tasks_scope_restrict_674 ON public.ops_tasks AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.property_task_access_674(property_id,assigned_to,task_type || ':' || coalesce(work_kind,'')));
DROP POLICY IF EXISTS ops_tasks_scope_allow_674 ON public.ops_tasks;
CREATE POLICY ops_tasks_scope_allow_674 ON public.ops_tasks
  FOR SELECT TO authenticated
  USING (public.property_task_access_674(property_id,assigned_to,task_type || ':' || coalesce(work_kind,'')));

-- Only task completion fields are writable by a worker; no assignment,
-- property, booking, type or finance fields can be modified by JWT clients.
DROP POLICY IF EXISTS ops_tasks_complete_674 ON public.ops_tasks;
CREATE POLICY ops_tasks_complete_674 ON public.ops_tasks
  FOR UPDATE TO authenticated
  USING (public.property_task_access_674(property_id,assigned_to,task_type || ':' || coalesce(work_kind,''))
    AND task_status IN ('open','in_progress'))
  WITH CHECK (public.property_task_access_674(property_id,assigned_to,task_type || ':' || coalesce(work_kind,''))
    AND task_status = 'resolved');

-- Assignment validation must bypass the SELECT policy for grants: a manager
-- has no right to list a worker's grant, but may assign a task to that worker.
CREATE OR REPLACE FUNCTION public.property_task_assignee_674(
  p_property text, p_assignee text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.property_access_grants g
    JOIN public.properties p ON p.id = g.property_id AND p.account_id = g.account_id
    JOIN public.account_members m ON m.account_id = g.account_id AND m.user_id = g.user_id
    JOIN public.property_access_grants actor
      ON actor.property_id = p.id AND actor.account_id = p.account_id
    JOIN public.account_members actor_member
      ON actor_member.account_id = actor.account_id AND actor_member.user_id = actor.user_id
    WHERE p.id::text = p_property AND g.user_id::text = p_assignee
      AND m.role IN ('owner','manager','operator')
      AND g.role IN ('owner','manager','operator')
      AND actor.user_id = public.shadow_user_id_674()
      AND actor.role IN ('owner','manager')
      AND actor_member.role = actor.role
      AND public.shadow_claims_674()->>'app_role' = actor.role
      AND public.shadow_claims_674()->>'account_id' = p.account_id::text
      AND public.shadow_claims_674()->>'property_id' = p_property
  )
$$;
REVOKE ALL ON FUNCTION public.property_task_assignee_674(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.property_task_assignee_674(text,text) TO authenticated;

-- Owner/manager may create explicitly assigned operational tasks. Operators
-- cannot create tasks, escalate their own assignment, or write finance.
DROP POLICY IF EXISTS ops_tasks_create_674 ON public.ops_tasks;
CREATE POLICY ops_tasks_create_674 ON public.ops_tasks FOR INSERT TO authenticated
  WITH CHECK (
    public.shadow_claims_674()->>'app_role' IN ('owner','manager')
    AND public.property_task_access_674(property_id,assigned_to,task_type || ':' || coalesce(work_kind,''))
    AND task_type = 'turnover'
    AND work_kind IN ('cleaning','linen','supplies','inspection')
    AND assigned_to IS NOT NULL
    AND public.property_task_assignee_674(property_id,assigned_to)
  );

-- PostgreSQL ACLs and RLS are separate. No direct authenticated access to
-- users/members, or any financial/booking write, is granted here.
REVOKE ALL ON public.ops_tasks FROM anon, authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.properties, public.booking_ops_records,
  public.owner_payout_reports, public.financial_ledger_entries, public.ops_tasks
  TO authenticated;
GRANT SELECT ON public.property_access_grants TO authenticated;
GRANT INSERT (property_id,task_type,work_kind,title,description,due_at,priority,assigned_to)
  ON public.ops_tasks TO authenticated;
GRANT UPDATE (task_status,resolved_at,updated_at) ON public.ops_tasks TO authenticated;
COMMIT;
