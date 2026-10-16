"""Offline render only. Never connects, applies SQL, or authorizes execution."""
import argparse,hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent
G0='334d93fc39d2ea51ba283dd0314bbc239ff49707'
PRESERVE=['20260729040307','20260729040309','20260729040332','20260913120838','20260913120856','20260913120921','20260913120945']
ORDER=['20261003124500','20261003141500','20261003150000','20261005090000','20261015103000','20261016090000']
REQ={'booking_inbound_intake_events':['account_id','account_scope_key'],'booking_ops_communication_auto_send_scopes':['account_id','account_scope_key'],'booking_ops_communication_auto_send_runs':['account_id'],'booking_ops_communication_deliveries':['account_id'],'booking_overbooking_conflict_checks':['account_id'],'booking_ops_records':['automation_paused'],'booking_ops_alerts':['revision'],'tg_property_knowledge':['check_in_instructions','key_instructions','parking_instructions','check_out_instructions','emergency_contacts']}
def build(include_purpose_repair=False, purpose_rationale=None):
 if include_purpose_repair and not (purpose_rationale and purpose_rationale.strip()):
  raise ValueError("Purpose repair requires explicit reviewed rationale")
 baseline=json.loads((ROOT/'catalog-baseline.json').read_text())
 assert baseline['source_run']==38933240140 and baseline['source_job']==117082215804
 assert all(s=='PASS' for s in baseline['section_status'].values())
 assert len(baseline['section_status'])==18
 expected={(t,c) for t,cs in REQ.items() for c in cs}
 membership=baseline['required_column_membership']
 assert len(membership)==len(expected) and {(r['table'],r['column']) for r in membership}==expected
 assert all(type(r['present']) is bool for r in membership)
 columns={(r['table'],r['column']) for r in membership if r['present']}
 missing=[f'{t}.{c}' for t,cs in REQ.items() for c in cs if (t,c) not in columns]
 assert len(missing)==14, 'Catalog does not match reviewed missing-column baseline'
 order=(["20260810280000"] if include_purpose_repair else [])+ORDER
 files=[next((ROOT/'sql').glob(p+'_*')) for p in order]
 values=','.join("('"+v+"')" for v in PRESERVE)
 sql="""-- CANDIDATE FOR DISPOSABLE RESTORE REHEARSAL; NOT LIVE AUTHORIZATION.
-- Entire rehearsal rolls back. Do not change final ROLLBACK without reviewed apply backend.
\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(7411, 20261016);
CREATE TEMP TABLE preserved_history ON COMMIT DROP AS
SELECT version,name,statements FROM supabase_migrations.schema_migrations
WHERE version IN (SELECT column1 FROM (VALUES %s) AS ids);
DO $$ BEGIN
 IF (SELECT count(*) FROM preserved_history) <> 7 THEN RAISE EXCEPTION 'preserved_history_missing'; END IF;
 IF current_setting('server_version_num')::int / 10000 <> 17 THEN RAISE EXCEPTION 'postgres17_required'; END IF;
 IF to_regclass('public.booking_ops_automation_executions') IS NOT NULL
 OR to_regprocedure('public.g0_begin_automation(uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public.g0_end_automation(uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public.g0_alert_revision()') IS NOT NULL
 OR to_regprocedure('public.g0_acknowledge_operator_alert(uuid,uuid,uuid,bigint)') IS NOT NULL
 THEN RAISE EXCEPTION 'partial_g0_requires_reconciliation'; END IF;
END $$;
CREATE TEMP TABLE preserved_functions ON COMMIT DROP AS
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,
 pg_get_functiondef(p.oid) definition,p.proacl,p.proowner,p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='runtime_bridge' OR p.proname LIKE '%%asi_runtime_bridge%%';
""" % values
 for f in files:
  text=f.read_text();text=re.sub(r'^BEGIN;\s*$','',text,flags=re.M);text=re.sub(r'^COMMIT;\s*$','',text,flags=re.M)
  sql+='\n-- SOURCE '+f.name+' SHA256 '+hashlib.sha256(f.read_bytes()).hexdigest()+'\n'+text
 sql+='\nDO $$ BEGIN\n'
 for t,cs in REQ.items():
  for c in cs:
   sql+=f" IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='{t}' AND column_name='{c}') THEN RAISE EXCEPTION 'missing_{t}_{c}'; END IF;\n"
 sql+=""" IF EXISTS(SELECT version,name,statements FROM preserved_history EXCEPT SELECT version,name,statements FROM supabase_migrations.schema_migrations) THEN RAISE EXCEPTION 'history_changed'; END IF;
 IF EXISTS (SELECT * FROM preserved_functions EXCEPT
 SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proacl,p.proowner,p.proconfig
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='runtime_bridge' OR p.proname LIKE '%asi_runtime_bridge%') THEN RAISE EXCEPTION 'runtime_bridge_changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_ops_communication_auto_send_scopes WHERE scope_type<>'global' AND (actual_send_enabled IS DISTINCT FROM false OR dry_run_only IS DISTINCT FROM true)) THEN RAISE EXCEPTION 'send_scope_not_disabled'; END IF;
 IF has_function_privilege('anon','public.g0_begin_automation(uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.g0_acknowledge_operator_alert(uuid,uuid,uuid,bigint)','EXECUTE') THEN RAISE EXCEPTION 'client_execute_exposed'; END IF;
END $$;
ROLLBACK;
"""
 (ROOT/'rehearse.sql').write_text(sql)
 plan={'status':'CANDIDATE_NOT_APPROVED','source_sha':G0,'catalog_run':38933240140,'target':'meeravcldnmocjtlqoeu','missing_columns':missing,'preserve_history':PRESERVE,'sql_sha256':hashlib.sha256(sql.encode()).hexdigest(),'files':[{'file':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in files],'live_execution_allowed':False,'purpose_repair_included':include_purpose_repair,'purpose_repair_rationale':purpose_rationale if include_purpose_repair else None,'unresolved':['RESTORE_PASS with security/owner/extension parity required','Data backfill and scope disable counts must be obtained on restored database','Purpose constraint body unavailable: catalog supplies hash only; compare on restore before deciding replacement','Verify SQL rehearsal under restored real schema and real row counts','Independent SQL approval and protected staging backend integration required','Effective process safety flags were previously unreadable','Migration history recording for selectively applied files needs reviewed backend; do not mark all 49 applied'],'redundant_file':'20261005095000 revocations already included byte-for-byte in 20261005090000','excluded':'No blanket db push, no unknown migration deletion, no optional provider/billing/channel migrations'}
 (ROOT/'plan.json').write_text(json.dumps(plan,indent=2)+'\n')
 return plan
if __name__=='__main__':
 parser=argparse.ArgumentParser()
 parser.add_argument('--include-purpose-repair',action='store_true')
 parser.add_argument('--purpose-rationale')
 args=parser.parse_args()
 print(json.dumps(build(args.include_purpose_repair,args.purpose_rationale),indent=2))
