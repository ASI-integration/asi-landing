-- Executed after candidate DDL inside the SAME outer transaction; never COMMIT.
-- Distinct synthetic UUIDs, tenants, properties, roles, tasks, financial rows.
INSERT INTO public.accounts(id,name) VALUES
 ('00000000-0000-4000-8000-000000006741','RLS674 A'),
 ('00000000-0000-4000-8000-000000006742','RLS674 B');
INSERT INTO public.users(id,email,password_hash) VALUES
 ('00000000-0000-4000-8000-000000006746','rls674-owner@example.invalid','!'),
 ('00000000-0000-4000-8000-000000006747','rls674-manager@example.invalid','!'),
 ('00000000-0000-4000-8000-000000006748','rls674-operator@example.invalid','!'),
 ('00000000-0000-4000-8000-000000006749','rls674-other@example.invalid','!');
INSERT INTO public.account_members(account_id,user_id,role) VALUES
 ('00000000-0000-4000-8000-000000006741','00000000-0000-4000-8000-000000006746','owner'),
 ('00000000-0000-4000-8000-000000006741','00000000-0000-4000-8000-000000006747','manager'),
 ('00000000-0000-4000-8000-000000006741','00000000-0000-4000-8000-000000006748','operator'),
 ('00000000-0000-4000-8000-000000006742','00000000-0000-4000-8000-000000006749','owner');
INSERT INTO public.properties(id,account_id,name) VALUES
 ('00000000-0000-4000-8000-000000006751','00000000-0000-4000-8000-000000006741','RLS A1'),
 ('00000000-0000-4000-8000-000000006752','00000000-0000-4000-8000-000000006741','RLS A2'),
 ('00000000-0000-4000-8000-000000006753','00000000-0000-4000-8000-000000006742','RLS B1');
INSERT INTO public.property_access_grants(account_id,property_id,user_id,role) VALUES
 ('00000000-0000-4000-8000-000000006741','00000000-0000-4000-8000-000000006751','00000000-0000-4000-8000-000000006746','owner'),
 ('00000000-0000-4000-8000-000000006741','00000000-0000-4000-8000-000000006751','00000000-0000-4000-8000-000000006747','manager'),
 ('00000000-0000-4000-8000-000000006741','00000000-0000-4000-8000-000000006751','00000000-0000-4000-8000-000000006748','operator'),
 ('00000000-0000-4000-8000-000000006742','00000000-0000-4000-8000-000000006753','00000000-0000-4000-8000-000000006749','owner');
INSERT INTO public.ops_tasks(id,property_id,task_type,work_kind,title,assigned_to) VALUES
 ('00000000-0000-4000-8000-000000006781','00000000-0000-4000-8000-000000006751','turnover','cleaning','RLS cleaning','00000000-0000-4000-8000-000000006748'),
 ('00000000-0000-4000-8000-000000006782','00000000-0000-4000-8000-000000006751','turnover','linen','RLS linen','00000000-0000-4000-8000-000000006748'),
 ('00000000-0000-4000-8000-000000006783','00000000-0000-4000-8000-000000006751','turnover','supplies','RLS supplies','00000000-0000-4000-8000-000000006748'),
 ('00000000-0000-4000-8000-000000006784','00000000-0000-4000-8000-000000006751','turnover','inspection','RLS inspection','00000000-0000-4000-8000-000000006748'),
 ('00000000-0000-4000-8000-000000006785','00000000-0000-4000-8000-000000006751','guest_issue',NULL,'RLS forbidden type','00000000-0000-4000-8000-000000006748'),
 ('00000000-0000-4000-8000-000000006786','00000000-0000-4000-8000-000000006751','turnover','cleaning','RLS not assigned','00000000-0000-4000-8000-000000006747'),
 ('00000000-0000-4000-8000-000000006787','00000000-0000-4000-8000-000000006752','turnover','cleaning','RLS other property','00000000-0000-4000-8000-000000006748'),
 ('00000000-0000-4000-8000-000000006788','00000000-0000-4000-8000-000000006753','turnover','cleaning','RLS other tenant','00000000-0000-4000-8000-000000006749');
INSERT INTO public.booking_ops_records(id,account_id,property_id,booking_id,asi_reference) VALUES
 ('00000000-0000-4000-8000-000000006761','00000000-0000-4000-8000-000000006741','00000000-0000-4000-8000-000000006751','RLS674-A1','RLS674-A1'),
 ('00000000-0000-4000-8000-000000006762','00000000-0000-4000-8000-000000006742','00000000-0000-4000-8000-000000006753','RLS674-B1','RLS674-B1');
INSERT INTO public.owner_payout_reports(
 booking_id,account_id,property_id,currency,gross_revenue_cents,deposit_hold_cents,
 deposit_retained_cents,management_commission_cents,operational_expenses_cents,owner_payout_cents)
VALUES
 ('00000000-0000-4000-8000-000000006761','00000000-0000-4000-8000-000000006741','00000000-0000-4000-8000-000000006751','RUB',10000,0,0,1000,0,9000),
 ('00000000-0000-4000-8000-000000006762','00000000-0000-4000-8000-000000006742','00000000-0000-4000-8000-000000006753','RUB',10000,0,0,1000,0,9000);

SELECT 'EXPLICIT_ACL',
 has_table_privilege('authenticated','public.ops_tasks','SELECT'),
 has_column_privilege('authenticated','public.ops_tasks','task_status','UPDATE'),
 has_column_privilege('authenticated','public.ops_tasks','assigned_to','UPDATE'),
 has_table_privilege('authenticated','public.owner_payout_reports','SELECT');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
 '{"iss":"asi-shadow-iron-session-674","role":"authenticated","sub":"00000000-0000-4000-8000-000000006746","account_id":"00000000-0000-4000-8000-000000006741","property_id":"00000000-0000-4000-8000-000000006751","app_role":"owner"}',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.properties WHERE name LIKE 'RLS %')<>1 THEN RAISE EXCEPTION 'OWNER_PROPERTY_SCOPE'; END IF;
 IF (SELECT count(*) FROM public.ops_tasks WHERE title LIKE 'RLS %')<>6 THEN RAISE EXCEPTION 'OWNER_TASK_SCOPE'; END IF;
 IF (SELECT count(*) FROM public.owner_payout_reports WHERE gross_revenue_cents=10000)<>1 THEN RAISE EXCEPTION 'OWNER_FINANCE_SCOPE'; END IF;
 RAISE NOTICE 'PASS OWNER A (1 property, 6 tasks, 1 finance)';
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
 '{"iss":"asi-shadow-iron-session-674","role":"authenticated","sub":"00000000-0000-4000-8000-000000006747","account_id":"00000000-0000-4000-8000-000000006741","property_id":"00000000-0000-4000-8000-000000006751","app_role":"manager"}',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.properties WHERE name LIKE 'RLS %')<>1 THEN RAISE EXCEPTION 'MANAGER_PROPERTY_SCOPE'; END IF;
 IF (SELECT count(*) FROM public.ops_tasks WHERE title LIKE 'RLS %')<>6 THEN RAISE EXCEPTION 'MANAGER_TASK_SCOPE'; END IF;
 IF (SELECT count(*) FROM public.owner_payout_reports WHERE gross_revenue_cents=10000)<>0 THEN RAISE EXCEPTION 'MANAGER_FINANCE_LEAK'; END IF;
 RAISE NOTICE 'PASS MANAGER A (1 property, 6 tasks, 0 finance)';
END $$;
INSERT INTO public.ops_tasks(property_id,task_type,work_kind,title,assigned_to)
VALUES ('00000000-0000-4000-8000-000000006751','turnover','cleaning','RLS manager-created','00000000-0000-4000-8000-000000006748');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
 '{"iss":"asi-shadow-iron-session-674","role":"authenticated","sub":"00000000-0000-4000-8000-000000006748","account_id":"00000000-0000-4000-8000-000000006741","property_id":"00000000-0000-4000-8000-000000006751","app_role":"operator"}',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.properties WHERE name LIKE 'RLS %')<>0 THEN RAISE EXCEPTION 'OPERATOR_PROPERTY_LEAK'; END IF;
 IF (SELECT count(*) FROM public.ops_tasks WHERE title LIKE 'RLS %')<>5 THEN RAISE EXCEPTION 'OPERATOR_ASSIGNED_SCOPE'; END IF;
 IF (SELECT count(*) FROM public.owner_payout_reports WHERE gross_revenue_cents=10000)<>0 THEN RAISE EXCEPTION 'OPERATOR_FINANCE_LEAK'; END IF;
 RAISE NOTICE 'PASS OPERATOR (5 assigned allowed tasks, 0 property, 0 finance)';
END $$;
UPDATE public.ops_tasks SET task_status='resolved',resolved_at=now(),updated_at=now()
WHERE id='00000000-0000-4000-8000-000000006781';
DO $$ BEGIN
 IF (SELECT task_status FROM public.ops_tasks WHERE id='00000000-0000-4000-8000-000000006781')<>'resolved' THEN
 RAISE EXCEPTION 'OPERATOR_CANNOT_CLOSE';END IF;
 RAISE NOTICE 'PASS OPERATOR CLOSES OWN TASK';
END $$;
UPDATE public.ops_tasks SET task_status='resolved'
WHERE id='00000000-0000-4000-8000-000000006786';
DO $$ BEGIN
 IF FOUND THEN RAISE EXCEPTION 'OPERATOR_CLOSED_FOREIGN_TASK';END IF;
 RAISE NOTICE 'PASS OPERATOR CANNOT CLOSE SOMEONE ELSE TASK';
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
 '{"iss":"asi-shadow-iron-session-674","role":"authenticated","sub":"00000000-0000-4000-8000-000000006749","account_id":"00000000-0000-4000-8000-000000006742","property_id":"00000000-0000-4000-8000-000000006753","app_role":"owner"}',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ops_tasks WHERE title LIKE 'RLS %')<>1 THEN RAISE EXCEPTION 'CROSS_TENANT_TASK_LEAK';END IF;
 IF (SELECT count(*) FROM public.owner_payout_reports WHERE gross_revenue_cents=10000)<>1 THEN RAISE EXCEPTION 'OTHER_OWNER_FINANCE'; END IF;
 RAISE NOTICE 'PASS OWNER B cross-tenant isolated';
END $$;
RESET ROLE;

-- Reject forged app role without a matching property grant, even if 'sub' is valid.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
 '{"iss":"asi-shadow-iron-session-674","role":"authenticated","sub":"00000000-0000-4000-8000-000000006748","account_id":"00000000-0000-4000-8000-000000006741","property_id":"00000000-0000-4000-8000-000000006751","app_role":"owner"}',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ops_tasks WHERE title LIKE 'RLS %')<>0 THEN RAISE EXCEPTION 'ROLE_FORGERY';END IF;
 RAISE NOTICE 'PASS forged role rejected';
END $$;
RESET ROLE;
-- Do not commit; runner appends ROLLBACK and verifies cleanliness afterward.
