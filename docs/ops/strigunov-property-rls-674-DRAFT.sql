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
-- Financial SELECT grants intentionally NOT enabled in this candidate.
-- Granting them changes a live security contract and needs separate approval.
COMMIT;
