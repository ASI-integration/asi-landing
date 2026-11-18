-- Isolated-account financial settlement for a closed booking.
-- All amounts are integer minor units. Never infer missing expenses as zero.
CREATE TABLE IF NOT EXISTS public.owner_payout_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  property_id uuid NOT NULL REFERENCES public.properties(id),
  currency text NOT NULL,
  gross_revenue_cents bigint NOT NULL CHECK (gross_revenue_cents >= 0),
  deposit_hold_cents bigint NOT NULL CHECK (deposit_hold_cents >= 0),
  deposit_retained_cents bigint NOT NULL CHECK (deposit_retained_cents >= 0),
  management_commission_cents bigint NOT NULL CHECK (management_commission_cents >= 0),
  operational_expenses_cents bigint NOT NULL CHECK (operational_expenses_cents >= 0),
  owner_payout_cents bigint NOT NULL CHECK (owner_payout_cents >= 0),
  balance_difference_cents bigint NOT NULL DEFAULT 0 CHECK (balance_difference_cents = 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (deposit_retained_cents <= deposit_hold_cents),
  CHECK (owner_payout_cents = gross_revenue_cents - management_commission_cents - operational_expenses_cents + deposit_retained_cents)
);
CREATE TABLE IF NOT EXISTS public.financial_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  property_id uuid NOT NULL REFERENCES public.properties(id),
  entry_type text NOT NULL CHECK (entry_type IN
   ('booking_revenue','deposit_hold','deposit_deduction','cleaning_expense','management_commission','owner_payout')),
  account_code text NOT NULL,
  debit_cents bigint NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents bigint NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(booking_id,entry_type,account_code),
  CHECK ((debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0))
);
CREATE INDEX IF NOT EXISTS financial_ledger_account_booking_idx ON public.financial_ledger_entries(account_id,booking_id);
ALTER TABLE public.financial_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_payout_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_ledger_entries, public.owner_payout_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.financial_ledger_entries, public.owner_payout_reports TO service_role;

-- A single database transaction validates inputs, writes all balanced double-entry
-- pairs, and stores the immutable payout report. Replays return the same result.
CREATE OR REPLACE FUNCTION public.settle_closed_booking_finance(p_booking_id uuid, p_account_id uuid, p_property_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b record; old_report record;
  gross bigint; hold_amt bigint; retained bigint; commission bigint; cleaning bigint;
  payout bigint; delta bigint; cur text;
BEGIN
  IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
     AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.booking_ops_records
   WHERE id=p_booking_id AND account_id=p_account_id AND property_id=p_property_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_scope_mismatch' USING ERRCODE='42501'; END IF;
  SELECT * INTO old_report FROM public.owner_payout_reports WHERE booking_id=p_booking_id;
  IF FOUND THEN RETURN jsonb_build_object('status','PASS','idempotent',true,'ownerPayoutCents',old_report.owner_payout_cents,'balanceDifferenceCents',old_report.balance_difference_cents); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.booking_ops_lifecycle_states WHERE booking_id=p_booking_id AND current_stage='closed')
  THEN RAISE EXCEPTION 'booking_lifecycle_not_closed'; END IF;
  IF NOT (b.reservation_metadata @> '{"finance_inputs_verified":true}'::jsonb)
  THEN RAISE EXCEPTION 'verified_finance_inputs_required'; END IF;
  IF b.amount IS NULL OR b.deposit_amount IS NULL OR b.currency IS NULL
     OR NOT (b.reservation_metadata ?& ARRAY['management_commission_cents','cleaning_expense_cents','deposit_retained_cents'])
  THEN RAISE EXCEPTION 'finance_amounts_missing'; END IF;
  IF b.amount < 0 OR b.deposit_amount < 0 OR b.amount*100 <> trunc(b.amount*100)
     OR b.deposit_amount*100 <> trunc(b.deposit_amount*100)
  THEN RAISE EXCEPTION 'finance_invalid_precision'; END IF;
  gross := (b.amount*100)::bigint; hold_amt := (b.deposit_amount*100)::bigint; cur := b.currency;
  IF cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'finance_currency_invalid'; END IF;
  IF (b.reservation_metadata->>'management_commission_cents') !~ '^[0-9]+$'
  OR (b.reservation_metadata->>'cleaning_expense_cents') !~ '^[0-9]+$'
  OR (b.reservation_metadata->>'deposit_retained_cents') !~ '^[0-9]+$'
  THEN RAISE EXCEPTION 'finance_inputs_invalid'; END IF;
  commission := (b.reservation_metadata->>'management_commission_cents')::bigint;
  cleaning := (b.reservation_metadata->>'cleaning_expense_cents')::bigint;
  retained := (b.reservation_metadata->>'deposit_retained_cents')::bigint;
  IF retained > hold_amt THEN RAISE EXCEPTION 'deposit_retained_exceeds_hold'; END IF;
  payout := gross - commission - cleaning + retained;
  IF payout < 0 THEN RAISE EXCEPTION 'owner_payout_negative'; END IF;
  INSERT INTO public.financial_ledger_entries
    (booking_id,account_id,property_id,entry_type,account_code,debit_cents,credit_cents,currency)
  SELECT p_booking_id,p_account_id,p_property_id,v.kind,v.code,v.dr,v.cr,cur
  FROM (VALUES
   ('booking_revenue','receivable',gross,0::bigint),('booking_revenue','revenue',0::bigint,gross),
   ('deposit_hold','deposit_clearing',hold_amt,0::bigint),('deposit_hold','deposit_liability',0::bigint,hold_amt),
   ('deposit_deduction','deposit_liability',retained,0::bigint),('deposit_deduction','retained_income',0::bigint,retained),
   ('cleaning_expense','operating_expense',cleaning,0::bigint),('cleaning_expense','expense_payable',0::bigint,cleaning),
   ('management_commission','commission_expense',commission,0::bigint),('management_commission','management_payable',0::bigint,commission),
   ('owner_payout','owner_settlement',payout,0::bigint),('owner_payout','owner_payable',0::bigint,payout)
  ) AS v(kind,code,dr,cr) WHERE v.dr>0 OR v.cr>0;
  SELECT coalesce(sum(debit_cents-credit_cents),0) INTO delta
    FROM public.financial_ledger_entries WHERE booking_id=p_booking_id;
  IF delta <> 0 THEN RAISE EXCEPTION 'financial_ledger_unbalanced'; END IF;
  INSERT INTO public.owner_payout_reports
   (booking_id,account_id,property_id,currency,gross_revenue_cents,deposit_hold_cents,deposit_retained_cents,management_commission_cents,operational_expenses_cents,owner_payout_cents,balance_difference_cents)
  VALUES(p_booking_id,p_account_id,p_property_id,cur,gross,hold_amt,retained,commission,cleaning,payout,delta);
  RETURN jsonb_build_object('status','PASS','idempotent',false,'grossRevenueCents',gross,'depositHoldCents',hold_amt,'depositRetainedCents',retained,'managementCommissionCents',commission,'operationalExpensesCents',cleaning,'ownerPayoutCents',payout,'balanceDifferenceCents',delta);
END $$;
REVOKE ALL ON FUNCTION public.settle_closed_booking_finance(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_closed_booking_finance(uuid,uuid,uuid) TO service_role;
