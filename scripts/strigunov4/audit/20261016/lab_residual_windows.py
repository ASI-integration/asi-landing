"""Read-only isolated restore residual diagnosis via existing in-memory credential bridge."""
import json,hashlib,sys
from pathlib import Path
from lab_login_windows import BASE,OPENSSL,command,rpc
EXTRA=r'''
payload=json.load(sys.stdin); result={'status':'BLOCK'}
try:
 m=payload['manifest']; password=payload['password']; identity(m)
 result['missing_copy_metadata']=query(m,"SELECT json_build_object('relkind',c.relkind,'is_partition',c.relispartition,'children',(SELECT count(*) FROM pg_inherits WHERE inhparent=c.oid),'row_count',(SELECT count(*) FROM realtime.messages)) FROM pg_class c WHERE c.oid='realtime.messages'::regclass;",password)
 source=Path('/root/strigunov4-restore-private/logs-2a7f58e4a68d4732816d4809b4207294-b/archive_data_render_v2.stdout').read_text()
 original=[x for x in source.splitlines() if x.startswith('SELECT pg_catalog.setval(')]
 seq=[]
 for s in original:
  hit=re.fullmatch(r"SELECT pg_catalog.setval\('([a-zA-Z0-9_.]+)', ([0-9]+), (true|false)\);",s)
  if not hit: raise Block('SEQUENCE_PARSE')
  name=hit[1]; actual=query(m,"SELECT json_build_object('last_value',last_value,'is_called',is_called) FROM "+name+';',password)
  seq.append({'name':name,'source_value':int(hit[2]),'source_is_called':hit[3]=='true','current_value':actual['last_value'],'current_is_called':actual['is_called']})
 result['sequences']=seq
 result['fixture_trigger_metadata']=query(m,"SELECT json_agg(json_build_object('table',t.tgrelid::regclass::text,'trigger',t.tgname,'function',t.tgfoid::regprocedure::text,'definition',pg_get_functiondef(t.tgfoid))) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.users'::regclass,'public.accounts'::regclass,'public.account_members'::regclass,'public.properties'::regclass,'public.booking_ops_records'::regclass,'public.booking_ops_alerts'::regclass);",password)
 # Report only function/trigger names and sequence references, never arbitrary function SQL.
 for t in result['fixture_trigger_metadata'] or []:
  body=t.pop('definition'); t['nextval_references']=re.findall(r"nextval\([^)]*\)",body); t['insert_targets']=re.findall(r'INSERT\s+INTO\s+([a-zA-Z_.]+)',body,re.I)
 result['status']='READ_ONLY_DIAGNOSIS'
except Block as e: result['reason']=str(e)
except Exception: result['reason']='PRIVATE_DIAGNOSIS_FAILED'
print(json.dumps(result,sort_keys=True))
'''
def main():
 root=Path(__file__).parent
 report=json.loads((BASE/'strigunov4-recovery-issued-login-38942690625.json').read_text(encoding='utf-8-sig'))
 cipher=Path(report['encrypted_bundle']).read_bytes()
 if hashlib.sha256(cipher).hexdigest()!=report['encrypted_bundle_sha256']: raise RuntimeError('CREDENTIAL_BUNDLE_HASH')
 bundle=json.loads(command([OPENSSL,'cms','-decrypt','-binary','-inform','DER','-inkey',str(BASE/'private.key'),'-recip',str(BASE/'recipient.crt')],cipher))
 manifest=json.loads((root/'lab_login_manifest.json').read_text(encoding='utf-8-sig'))
 if bundle['target']!=manifest: raise RuntimeError('CREDENTIAL_TARGET_MISMATCH')
 code="__name__='private'\n"+(root/'lab_login_receiver.py').read_text(encoding='utf-8-sig')+'\n'+EXTRA
 result=rpc(code,{'manifest':manifest,'password':bundle['credentials']['supabase_admin']})
 (BASE/'strigunov4-residual-diagnosis-38942690625.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
 print(json.dumps(result,sort_keys=True))
 return 0 if result.get('status')=='READ_ONLY_DIAGNOSIS' else 2
if __name__=='__main__':
 try: sys.exit(main())
 except Exception:
  print('{"status":"BLOCK","reason":"PRIVATE_DIAGNOSIS_BRIDGE_FAILED"}'); sys.exit(2)
