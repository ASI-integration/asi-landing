"""Fresh authenticator LOGIN followed by restricted role CRUD denial checks."""
import json,hashlib,sys,inspect
from pathlib import Path
import lab_residual_windows as bridge
from lab_tenant_windows import HELPERS
from lab_rehearsal_windows import EXTRA as REHEARSAL
snapshot=HELPERS[HELPERS.index('    def data_snapshot():'):HELPERS.index('    private_map=')]
schema=REHEARSAL[REHEARSAL.index('    def schema():'):REHEARSAL.index('    prefix=')]
EXTRA=r'''
payload=json.load(sys.stdin); result={'status':'BLOCK','source_access':'NONE','committed_migrations':False}
try:
    m=payload['manifest']; password=payload['password']; identity(m)
'''+snapshot+schema+r'''
    before={'schema':schema(),'history':history(),'data':data_snapshot()}
    result['before']=before
    result['optional_repair_history_present']=query(m,"SELECT to_json(EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260810280000')); ",password)
    account_a='2a7f58e4-0000-4000-8000-000000000011'; account_b='2a7f58e4-0000-4000-8000-000000000012'
    inserts={
      'account_members':"(id,account_id,user_id,role) VALUES('2a7f58e4-0000-4000-8000-000000000021','%s','2a7f58e4-0000-4000-8000-000000000001','owner')"%account_a,
      'properties':"(id,account_id,name) VALUES('2a7f58e4-0000-4000-8000-000000000031','%s','Synthetic rolechain fixture')"%account_a,
      'booking_ops_records':"(id,account_id,property_id,asi_reference) VALUES('2a7f58e4-0000-4000-8000-000000000041','%s','2a7f58e4-0000-4000-8000-000000000031','ASI-RESTORE-ROLECHAIN')"%account_a,
      'booking_ops_alerts':"(id,account_id,booking_id,property_id,alert_code,source_gate,severity,status,title,description,dedupe_key) VALUES('2a7f58e4-0000-4000-8000-000000000051','%s','2a7f58e4-0000-4000-8000-000000000041','2a7f58e4-0000-4000-8000-000000000031','g0_uncertain','provider_uncertain','critical','open','Synthetic','Synthetic','rolechain')"%account_a}
    cases=[]
    for role in ['anon','authenticated']:
      for table in inserts:
        statements={'SELECT':"SELECT 1 FROM public.%s WHERE account_id='%s' LIMIT 1;"%(table,account_a),'INSERT':'INSERT INTO public.'+table+inserts[table]+';','UPDATE':"UPDATE public.%s SET account_id='%s' WHERE account_id='%s';"%(table,account_b,account_a),'DELETE':"DELETE FROM public.%s WHERE account_id='%s';"%(table,account_a)}
        for scope in ['A','B']:
          for op,statement in statements.items():
            statement=statement.replace(account_a, '__SCOPE_A__').replace(account_b, account_a if scope=='B' else account_b).replace('__SCOPE_A__',account_b if scope=='B' else account_a)
            sql="\\set VERBOSITY verbose\nBEGIN; SET LOCAL ROLE "+role+"; SELECT json_build_object('session_user',session_user,'current_user',current_user);\n"+statement+'\nROLLBACK;'
            p=psql(m,'authenticator',sql,payload['authenticator_password'])
            identities=[json.loads(x) for x in p.stdout.decode().splitlines() if x.startswith('{')]
            states=re.findall(r'ERROR:\s+([0-9A-Z]{5}):',p.stderr.decode())
            expected={'session_user':'authenticator','current_user':role}
            cases.append({'role':role,'account_scope':scope,'table':table,'operation':op,'fresh_login_identity_verified':identities==[expected],'sqlstates':states,'denied':p.returncode!=0 and states==['42501'] and identities==[expected]})
    after={'schema':schema(),'history':history(),'data':data_snapshot()}; identity(m)
    result.update(cases=cases,after=after,state_unchanged=before==after,connection_method='64 separate recovered authenticator LOGIN sessions; SET LOCAL ROLE anon/authenticated; each transaction ends rollback or connection-close rollback',original_password_recovery='NOT_PROVEN')
    result['status']='ROLECHAIN_DENIALS_PASS' if len(cases)==64 and all(c['denied'] for c in cases) and before==after else 'BLOCK'
except Block as e: result['reason']=str(e)
except Exception: result['reason']='PRIVATE_ROLECHAIN_FAILED'
print(json.dumps(result,sort_keys=True))
'''
bridge.EXTRA=EXTRA
source=inspect.getsource(bridge.main).replace("'password':bundle['credentials']['supabase_admin']", "'password':bundle['credentials']['supabase_admin'],'authenticator_password':bundle['credentials']['authenticator']").replace('strigunov4-residual-diagnosis-38942690625.json','strigunov4-rolechain-38942690625.json').replace("'READ_ONLY_DIAGNOSIS'","'ROLECHAIN_DENIALS_PASS'")
exec(source,bridge.__dict__)
if __name__=='__main__':
 try: sys.exit(bridge.main())
 except Exception:
  print('{"status":"BLOCK","reason":"PRIVATE_ROLECHAIN_BRIDGE_FAILED"}'); sys.exit(2)
