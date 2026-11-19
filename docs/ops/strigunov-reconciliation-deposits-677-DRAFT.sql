-- P0 #677: review-only isolated financial DDL. NEVER apply to shared Supabase
-- or production; no charges/refunds, outbound messages or bank-provider calls.
BEGIN;
CREATE TABLE public.asi_contract_rules_677 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 property_id uuid NOT NULL REFERENCES public.properties(id),
 version text NOT NULL CHECK(length(version) BETWEEN 1 AND 80),
 valid_from date NOT NULL,valid_until date,
 commission_bps integer NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000),
 tax_bps integer NOT NULL CHECK(tax_bps BETWEEN 0 AND 10000),
 owner_share_bps integer NOT NULL CHECK(owner_share_bps BETWEEN 0 AND 10000),
 currency char(3) NOT NULL CHECK(currency='RUB'),
 payment_model text NOT NULL CHECK(payment_model IN ('OTA_COLLECT','DIRECT_COLLECT')),
 evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,property_id,version),
 CHECK(valid_until IS NULL OR valid_until>valid_from)
);
CREATE TABLE public.asi_contract_drafts_677 (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 property_id uuid NOT NULL REFERENCES public.properties(id),
 booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id),
 contract_rule_id bigint NOT NULL REFERENCES public.asi_contract_rules_677(id),
 terms_hash text NOT NULL CHECK(terms_hash ~ '^[a-f0-9]{64}$'),
 evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','sent_no_send','signed_verified','expired','blocked')),
 signed_evidence_hash text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(state<>'signed_verified' OR signed_evidence_hash ~ '^[a-f0-9]{64}$')
);
CREATE TABLE public.asi_deposit_events_677 (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 property_id uuid NOT NULL REFERENCES public.properties(id),
 booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id),
 event_state text NOT NULL CHECK(event_state IN ('requested_no_charge','received_bank_verified',
 'retained_partially','retained_fully','refunded_bank_verified','disputed')),
 amount_minor bigint NOT NULL CHECK(amount_minor>=0),
 bank_reference text,
 bank_evidence_hash text,
 journal_id uuid,
 reversal_of uuid REFERENCES public.asi_deposit_events_677(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(event_state NOT IN ('received_bank_verified','retained_partially','retained_fully','refunded_bank_verified')
   OR (journal_id IS NOT NULL AND length(bank_reference)>0 AND bank_evidence_hash ~ '^[a-f0-9]{64}$'))
);
CREATE TABLE public.asi_bank_statement_lines_677 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 property_id uuid NOT NULL REFERENCES public.properties(id),
 booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id),
 provider_id text NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 80),
 statement_id text NOT NULL CHECK(length(statement_id) BETWEEN 1 AND 120),
 transaction_id text NOT NULL CHECK(length(transaction_id) BETWEEN 1 AND 160),
 posted_at timestamptz NOT NULL,
 amount_minor bigint NOT NULL,
 currency char(3) NOT NULL CHECK(currency='RUB'),
 status text NOT NULL CHECK(status IN ('posted','pending','reversed')),
 evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,provider_id,statement_id,transaction_id)
);
CREATE TABLE public.asi_journals_677 (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 property_id uuid NOT NULL REFERENCES public.properties(id),
 booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id),
 currency char(3) NOT NULL CHECK(currency='RUB'),
 accounting_period date NOT NULL CHECK(EXTRACT(DAY FROM accounting_period)=1),
 source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 190),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 reversal_of uuid REFERENCES public.asi_journals_677(id),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,source_key),
 UNIQUE(reversal_of)
);
ALTER TABLE public.asi_deposit_events_677 ADD CONSTRAINT asi_deposit_journal_fk_677
 FOREIGN KEY(journal_id) REFERENCES public.asi_journals_677(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.asi_journal_lines_677 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 journal_id uuid NOT NULL REFERENCES public.asi_journals_677(id),
 ledger_account text NOT NULL CHECK(ledger_account IN ('bank_clearing','guest_receivable',
 'provider_fee_expense','owner_payable','owner_paid','deposit_liability',
 'deposit_retained_revenue','payout_clearing','reconciliation_suspense')),
 debit_minor bigint NOT NULL DEFAULT 0 CHECK(debit_minor>=0),
 credit_minor bigint NOT NULL DEFAULT 0 CHECK(credit_minor>=0),
 evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 CHECK((debit_minor=0)<> (credit_minor=0))
);
CREATE TABLE public.asi_finance_period_closures_677 (
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 period_start date NOT NULL CHECK(EXTRACT(DAY FROM period_start)=1),
 snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),
 reviewed_by uuid NOT NULL REFERENCES public.users(id),
 closed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,period_start)
);
CREATE TABLE public.asi_finance_manual_queue_677 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 property_id uuid NOT NULL REFERENCES public.properties(id),
 booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id),
 reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z0-9_]{3,80}$'),
 expected_minor bigint NOT NULL,
 observed_minor bigint NOT NULL,
 evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 resolution text NOT NULL DEFAULT 'open' CHECK(resolution IN ('open','investigating','resolved_manual')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,booking_id,reason_code,evidence_hash)
);
CREATE OR REPLACE FUNCTION public.asi_contract_version_guard_677()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.account_id::text||':'||NEW.property_id::text,677));
 IF EXISTS(SELECT 1 FROM public.asi_contract_rules_677 r
 WHERE r.account_id=NEW.account_id AND r.property_id=NEW.property_id
 AND daterange(r.valid_from,r.valid_until,'[)') && daterange(NEW.valid_from,NEW.valid_until,'[)'))
 THEN RAISE EXCEPTION 'overlapping_contract_versions' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.asi_finance_no_mutation_677()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'append_only_finance_no_update_delete' USING ERRCODE='42501';
END $$;
CREATE OR REPLACE FUNCTION public.asi_finance_scope_677()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.properties p
   JOIN public.booking_ops_records b ON b.id=NEW.booking_id
   WHERE p.id=NEW.property_id AND p.account_id=NEW.account_id
    AND b.account_id=NEW.account_id::text AND b.property_id=NEW.property_id::text)
 THEN RAISE EXCEPTION 'finance_tenant_booking_scope_denied' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.asi_finance_journal_open_677()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.asi_finance_period_closures_677 p
  WHERE p.account_id=NEW.account_id AND p.period_start=NEW.accounting_period)
 THEN RAISE EXCEPTION 'closed_period_immutable_use_next_period_reversal' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.asi_finance_balanced_677()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE j uuid; deb bigint; cred bigint; count_lines bigint;
BEGIN
 IF TG_TABLE_NAME='asi_journals_677' THEN j=NEW.id;
 ELSE j=NEW.journal_id; END IF;
 SELECT COALESCE(SUM(debit_minor),0),COALESCE(SUM(credit_minor),0),COUNT(*)
 INTO deb,cred,count_lines FROM public.asi_journal_lines_677 WHERE journal_id=j;
 IF count_lines<2 OR deb<>cred THEN RAISE EXCEPTION 'finance_journal_unbalanced' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER asi_contract_rule_overlap_677 BEFORE INSERT ON public.asi_contract_rules_677 FOR EACH ROW EXECUTE FUNCTION public.asi_contract_version_guard_677();
CREATE TRIGGER asi_contract_rules_immutable_677 BEFORE UPDATE OR DELETE ON public.asi_contract_rules_677 FOR EACH ROW EXECUTE FUNCTION public.asi_finance_no_mutation_677();
CREATE TRIGGER asi_contract_drafts_immutable_677 BEFORE UPDATE OR DELETE ON public.asi_contract_drafts_677 FOR EACH ROW EXECUTE FUNCTION public.asi_finance_no_mutation_677();
CREATE TRIGGER asi_deposit_events_immutable_677 BEFORE UPDATE OR DELETE ON public.asi_deposit_events_677 FOR EACH ROW EXECUTE FUNCTION public.asi_finance_no_mutation_677();
CREATE TRIGGER asi_statement_lines_immutable_677 BEFORE UPDATE OR DELETE ON public.asi_bank_statement_lines_677 FOR EACH ROW EXECUTE FUNCTION public.asi_finance_no_mutation_677();
CREATE TRIGGER asi_journals_immutable_677 BEFORE UPDATE OR DELETE ON public.asi_journals_677 FOR EACH ROW EXECUTE FUNCTION public.asi_finance_no_mutation_677();
CREATE TRIGGER asi_journal_lines_immutable_677 BEFORE UPDATE OR DELETE ON public.asi_journal_lines_677 FOR EACH ROW EXECUTE FUNCTION public.asi_finance_no_mutation_677();
CREATE TRIGGER asi_period_closures_immutable_677 BEFORE UPDATE OR DELETE ON public.asi_finance_period_closures_677 FOR EACH ROW EXECUTE FUNCTION public.asi_finance_no_mutation_677();
CREATE TRIGGER asi_draft_scope_677 BEFORE INSERT ON public.asi_contract_drafts_677 FOR EACH ROW EXECUTE FUNCTION public.asi_finance_scope_677();
CREATE TRIGGER asi_deposit_scope_677 BEFORE INSERT ON public.asi_deposit_events_677 FOR EACH ROW EXECUTE FUNCTION public.asi_finance_scope_677();
CREATE TRIGGER asi_bank_scope_677 BEFORE INSERT ON public.asi_bank_statement_lines_677 FOR EACH ROW EXECUTE FUNCTION public.asi_finance_scope_677();
CREATE TRIGGER asi_journal_scope_677 BEFORE INSERT ON public.asi_journals_677 FOR EACH ROW EXECUTE FUNCTION public.asi_finance_scope_677();
CREATE TRIGGER asi_manual_queue_scope_677 BEFORE INSERT ON public.asi_finance_manual_queue_677 FOR EACH ROW EXECUTE FUNCTION public.asi_finance_scope_677();
CREATE TRIGGER asi_journal_period_677 BEFORE INSERT ON public.asi_journals_677 FOR EACH ROW EXECUTE FUNCTION public.asi_finance_journal_open_677();
CREATE CONSTRAINT TRIGGER asi_deferred_header_balance_677 AFTER INSERT ON public.asi_journals_677
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.asi_finance_balanced_677();
CREATE CONSTRAINT TRIGGER asi_deferred_balance_677 AFTER INSERT ON public.asi_journal_lines_677
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.asi_finance_balanced_677();
-- Server role can only append records. Existing finance remains owner-only.
DO $rls$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['asi_contract_rules_677','asi_contract_drafts_677','asi_deposit_events_677',
  'asi_bank_statement_lines_677','asi_journals_677','asi_journal_lines_677',
  'asi_finance_period_closures_677','asi_finance_manual_queue_677']
 LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role',t);
  EXECUTE format('GRANT SELECT, INSERT ON public.%I TO service_role',t);
 END LOOP;
END $rls$;
GRANT USAGE,SELECT ON SEQUENCE public.asi_contract_rules_677_id_seq,public.asi_bank_statement_lines_677_id_seq,
 public.asi_journal_lines_677_id_seq,public.asi_finance_manual_queue_677_id_seq TO service_role;
COMMIT;
