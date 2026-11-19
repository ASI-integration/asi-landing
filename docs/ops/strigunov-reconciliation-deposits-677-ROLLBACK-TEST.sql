-- #677 synthetic chain only. Run with DRAFT DDL inside one OUTER transaction.
-- Runner MUST append ROLLBACK; no actual bank statement/provider or signature.
INSERT INTO public.accounts(id,name)
VALUES ('00000000-0000-4000-8000-000000006771','E2E677 synthetic tenant');
INSERT INTO public.users(id,email,password_hash)
VALUES ('00000000-0000-4000-8000-000000006772','e2e677-reviewer@example.invalid','!synthetic');
INSERT INTO public.account_members(account_id,user_id,role)
VALUES ('00000000-0000-4000-8000-000000006771','00000000-0000-4000-8000-000000006772','owner');
INSERT INTO public.properties(id,account_id,name)
VALUES ('00000000-0000-4000-8000-000000006773','00000000-0000-4000-8000-000000006771','E2E677 synthetic property');
INSERT INTO public.booking_ops_records(id,account_id,property_id,booking_id,asi_reference)
VALUES ('00000000-0000-4000-8000-000000006774','00000000-0000-4000-8000-000000006771','00000000-0000-4000-8000-000000006773','E2E677-BOOKING','E2E677-BOOKING');
SET LOCAL ROLE service_role;
INSERT INTO public.asi_contract_rules_677(account_id,property_id,version,valid_from,valid_until,commission_bps,tax_bps,owner_share_bps,currency,payment_model,evidence_hash)
VALUES ('00000000-0000-4000-8000-000000006771','00000000-0000-4000-8000-000000006773','v1','2026-01-01','2026-11-19',1000,500,7000,'RUB','OTA_COLLECT',repeat('a',64)),
 ('00000000-0000-4000-8000-000000006771','00000000-0000-4000-8000-000000006773','v2','2026-11-19',NULL,1000,500,7000,'RUB','OTA_COLLECT',repeat('b',64));
INSERT INTO public.asi_contract_drafts_677(id,account_id,property_id,booking_id,contract_rule_id,terms_hash,evidence_hash,state)
SELECT '00000000-0000-4000-8000-000000006775','00000000-0000-4000-8000-000000006771',
 '00000000-0000-4000-8000-000000006773','00000000-0000-4000-8000-000000006774',
 id,repeat('c',64),repeat('d',64),'draft' FROM public.asi_contract_rules_677 WHERE version='v2';
INSERT INTO public.asi_deposit_events_677(id,account_id,property_id,booking_id,event_state,amount_minor)
VALUES ('00000000-0000-4000-8000-000000006776','00000000-0000-4000-8000-000000006771',
 '00000000-0000-4000-8000-000000006773','00000000-0000-4000-8000-000000006774','requested_no_charge',3000);
INSERT INTO public.asi_deposit_events_677(id,account_id,property_id,booking_id,event_state,amount_minor,bank_reference,bank_evidence_hash,journal_id)
VALUES ('00000000-0000-4000-8000-000000006777','00000000-0000-4000-8000-000000006771',
 '00000000-0000-4000-8000-000000006773','00000000-0000-4000-8000-000000006774','received_bank_verified',3000,'SYNTHETIC-BANK-77',repeat('e',64),'00000000-0000-4000-8000-000000006782'),
 ('00000000-0000-4000-8000-000000006778','00000000-0000-4000-8000-000000006771',
 '00000000-0000-4000-8000-000000006773','00000000-0000-4000-8000-000000006774','retained_partially',900,'SYNTHETIC-BANK-78',repeat('f',64),'00000000-0000-4000-8000-000000006783'),
 ('00000000-0000-4000-8000-000000006779','00000000-0000-4000-8000-000000006771',
 '00000000-0000-4000-8000-000000006773','00000000-0000-4000-8000-000000006774','refunded_bank_verified',2100,'SYNTHETIC-BANK-79',repeat('0',64),'00000000-0000-4000-8000-000000006784');
INSERT INTO public.asi_bank_statement_lines_677(account_id,property_id,booking_id,provider_id,statement_id,transaction_id,posted_at,amount_minor,currency,status,evidence_hash)
VALUES ('00000000-0000-4000-8000-000000006771','00000000-0000-4000-8000-000000006773',
 '00000000-0000-4000-8000-000000006774','SYNTHETIC-OTA','SYNTHETIC-ST1','SYNTHETIC-TX1',
 '2026-11-20T12:00:00Z',8501,'RUB','posted',repeat('1',64))
ON CONFLICT(account_id,provider_id,statement_id,transaction_id) DO NOTHING;
INSERT INTO public.asi_bank_statement_lines_677(account_id,property_id,booking_id,provider_id,statement_id,transaction_id,posted_at,amount_minor,currency,status,evidence_hash)
VALUES ('00000000-0000-4000-8000-000000006771','00000000-0000-4000-8000-000000006773',
 '00000000-0000-4000-8000-000000006774','SYNTHETIC-OTA','SYNTHETIC-ST1','SYNTHETIC-TX1',
 '2026-11-20T12:00:00Z',8501,'RUB','posted',repeat('1',64))
ON CONFLICT(account_id,provider_id,statement_id,transaction_id) DO NOTHING;
INSERT INTO public.asi_journals_677(id,account_id,property_id,booking_id,currency,accounting_period,source_key,source_hash)
VALUES ('00000000-0000-4000-8000-000000006780','00000000-0000-4000-8000-000000006771',
 '00000000-0000-4000-8000-000000006773','00000000-0000-4000-8000-000000006774',
 'RUB','2026-11-01','SYNTHETIC-OTA:SYNTHETIC-ST1:SYNTHETIC-TX1',repeat('1',64));
INSERT INTO public.asi_journal_lines_677(journal_id,ledger_account,debit_minor,credit_minor,evidence_hash)
VALUES ('00000000-0000-4000-8000-000000006780','bank_clearing',8501,0,repeat('1',64)),
 ('00000000-0000-4000-8000-000000006780','guest_receivable',0,8501,repeat('1',64));
-- Append-only balanced evidence journals for each synthetic deposit cash event.
INSERT INTO public.asi_journals_677(id,account_id,property_id,booking_id,currency,accounting_period,source_key,source_hash)
VALUES
 ('00000000-0000-4000-8000-000000006782','00000000-0000-4000-8000-000000006771','00000000-0000-4000-8000-000000006773','00000000-0000-4000-8000-000000006774','RUB','2026-11-01','DEPOSIT_RECEIVED:ST77',repeat('e',64)),
 ('00000000-0000-4000-8000-000000006783','00000000-0000-4000-8000-000000006771','00000000-0000-4000-8000-000000006773','00000000-0000-4000-8000-000000006774','RUB','2026-11-01','DEPOSIT_RETAINED:ST78',repeat('f',64)),
 ('00000000-0000-4000-8000-000000006784','00000000-0000-4000-8000-000000006771','00000000-0000-4000-8000-000000006773','00000000-0000-4000-8000-000000006774','RUB','2026-11-01','DEPOSIT_REFUNDED:ST79',repeat('0',64));
INSERT INTO public.asi_journal_lines_677(journal_id,ledger_account,debit_minor,credit_minor,evidence_hash)
VALUES
 ('00000000-0000-4000-8000-000000006782','bank_clearing',3000,0,repeat('e',64)),
 ('00000000-0000-4000-8000-000000006782','deposit_liability',0,3000,repeat('e',64)),
 ('00000000-0000-4000-8000-000000006783','deposit_liability',900,0,repeat('f',64)),
 ('00000000-0000-4000-8000-000000006783','deposit_retained_revenue',0,900,repeat('f',64)),
 ('00000000-0000-4000-8000-000000006784','deposit_liability',2100,0,repeat('0',64)),
 ('00000000-0000-4000-8000-000000006784','bank_clearing',0,2100,repeat('0',64));
INSERT INTO public.asi_finance_manual_queue_677(account_id,property_id,booking_id,reason_code,expected_minor,observed_minor,evidence_hash)
VALUES ('00000000-0000-4000-8000-000000006771','00000000-0000-4000-8000-000000006773',
 '00000000-0000-4000-8000-000000006774','OWNER_PAYOUT_OUTSTANDING',5951,0,repeat('2',64));
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.asi_contract_rules_677)<>2 THEN RAISE EXCEPTION 'CONTRACT_VERSIONS';END IF;
 IF (SELECT count(*) FROM public.asi_contract_drafts_677 WHERE state='draft')<>1 THEN RAISE EXCEPTION 'CONTRACT_DRAFT_NO_SEND';END IF;
 IF (SELECT sum(amount_minor) FROM public.asi_deposit_events_677 WHERE event_state='received_bank_verified')<>3000 THEN RAISE EXCEPTION 'DEPOSIT_RECEIVED';END IF;
 IF (SELECT sum(amount_minor) FROM public.asi_deposit_events_677 WHERE event_state='refunded_bank_verified')<>2100 THEN RAISE EXCEPTION 'DEPOSIT_REFUNDED';END IF;
 IF (SELECT count(*) FROM public.asi_bank_statement_lines_677)<>1 THEN RAISE EXCEPTION 'BANK_REPLAY';END IF;
 IF (SELECT count(*) FROM public.asi_deposit_events_677 WHERE event_state<>'requested_no_charge' AND journal_id IS NOT NULL)<>3 THEN RAISE EXCEPTION 'DEPOSIT_LEDGER_LINK_MISSING';END IF;
 IF (SELECT count(*) FROM public.asi_journals_677)<>4 THEN RAISE EXCEPTION 'DEPOSIT_LEDGER_JOURNALS_MISSING';END IF;
 IF (SELECT sum(debit_minor)-sum(credit_minor) FROM public.asi_journal_lines_677)<>0 THEN RAISE EXCEPTION 'LEDGER_UNBALANCED';END IF;
 IF (SELECT count(*) FROM public.asi_finance_manual_queue_677 WHERE resolution='open')<>1 THEN RAISE EXCEPTION 'MANUAL_QUEUE_MISSING';END IF;
 RAISE NOTICE 'PASS_677_CONTRACT_DEPOSIT_BANK_LEDGER_IDEMPOTENCY_QUEUE';
END $test$;
INSERT INTO public.asi_finance_period_closures_677(account_id,period_start,snapshot_hash,reviewed_by)
VALUES ('00000000-0000-4000-8000-000000006771','2026-11-01',repeat('3',64),'00000000-0000-4000-8000-000000006772');
DO $test$
BEGIN
 BEGIN
 INSERT INTO public.asi_journals_677(id,account_id,property_id,booking_id,currency,accounting_period,source_key,source_hash)
 VALUES ('00000000-0000-4000-8000-000000006781','00000000-0000-4000-8000-000000006771',
 '00000000-0000-4000-8000-000000006773','00000000-0000-4000-8000-000000006774',
 'RUB','2026-11-01','SHOULD-BE-BLOCKED',repeat('4',64));
 RAISE EXCEPTION 'CLOSED_MONTH_ACCEPTED_WRONGLY';
 EXCEPTION WHEN SQLSTATE '42501' THEN
  RAISE NOTICE 'PASS_677_CLOSED_MONTH_IMMUTABLE';
 END;
 BEGIN
 UPDATE public.asi_journals_677 SET source_key='MUTATION' WHERE id='00000000-0000-4000-8000-000000006780';
 RAISE EXCEPTION 'LEDGER_MUTATED_WRONGLY';
 EXCEPTION WHEN SQLSTATE '42501' THEN
  RAISE NOTICE 'PASS_677_APPEND_ONLY_UPDATE_DENIED';
 END;
 BEGIN
 DELETE FROM public.asi_bank_statement_lines_677;
 RAISE EXCEPTION 'BANK_DELETED_WRONGLY';
 EXCEPTION WHEN SQLSTATE '42501' THEN
  RAISE NOTICE 'PASS_677_APPEND_ONLY_DELETE_DENIED';
 END;
END $test$;
-- Caller appends ROLLBACK; any fixture rows must disappear.
