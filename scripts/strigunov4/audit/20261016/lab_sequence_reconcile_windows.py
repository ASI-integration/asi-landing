"""Exact single lab sequence reconciliation after rollback-only fixture side effect."""
from lab_residual_windows import *
import lab_residual_windows as bridge
RECONCILE=r'''
 result['sequence_defaults']=query(m,"SELECT json_agg(json_build_object('table',d.adrelid::regclass::text,'column',a.attname,'expression',pg_get_expr(d.adbin,d.adrelid))) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE pg_get_expr(d.adbin,d.adrelid) LIKE '%asi_reservation_reference_seq%';",password)
 source_hash=hashlib.sha256(json.dumps(sorted(original)).encode()).hexdigest()
 if source_hash!='f878966fb013026a43dd8fd44c6e93e1e9ad09859d7ba8c2e9e6d744dc205444': raise Block('PREFIXTURE_SEQUENCE_BASELINE')
 changed=[x for x in seq if x['source_value']!=x['current_value'] or x['source_is_called']!=x['current_is_called']]
 if changed!=[{'name':'public.asi_reservation_reference_seq','source_value':100007,'source_is_called':True,'current_value':100010,'current_is_called':True}]: raise Block('UNEXPECTED_SEQUENCE_DIFF')
 identity(m)
 sql="""SET log_statement='none'; SET log_min_error_statement='panic'; SET pg_stat_statements.track='none';
 DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()) THEN RAISE EXCEPTION 'other_client'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.asi_reservation_reference_seq WHERE last_value=100010 AND is_called) THEN RAISE EXCEPTION 'sequence_changed'; END IF;
 PERFORM pg_catalog.setval('public.asi_reservation_reference_seq',100007,true);
 END $$;"""
 p=psql(m,'supabase_admin',sql,password)
 if p.returncode: raise Block('EXACT_SEQUENCE_RECONCILIATION_FAILED')
 post=[]
 for x in seq:
  actual=query(m,"SELECT json_build_object('last_value',last_value,'is_called',is_called) FROM "+x['name']+';',password)
  if actual['last_value']!=x['source_value'] or actual['is_called']!=x['source_is_called']: raise Block('POST_SEQUENCE_MISMATCH')
  post.append("SELECT pg_catalog.setval('%s', %d, %s);"%(x['name'],actual['last_value'],'true' if actual['is_called'] else 'false'))
 result['post_sequences_sha256']=hashlib.sha256(json.dumps(sorted(post)).encode()).hexdigest()
 result['all_four_sequences_match_prefixture']=result['post_sequences_sha256']==source_hash
 if result['post_sequences_sha256']!=source_hash: raise Block('POST_SEQUENCE_HASH_MISMATCH')
 result['correction']='only public.asi_reservation_reference_seq setval(100007,true); explicit local reconciliation, not transactional rollback'
 result['status']='SEQUENCE_RECONCILIATION_PASS'
'''
bridge.EXTRA=EXTRA.replace(" result['status']='READ_ONLY_DIAGNOSIS'",RECONCILE)
# Keep separate diagnosis and correction receipts.
source=__import__('inspect').getsource(bridge.main).replace("strigunov4-residual-diagnosis-38942690625.json","strigunov4-sequence-reconciliation-38942690625.json").replace("'READ_ONLY_DIAGNOSIS'","'SEQUENCE_RECONCILIATION_PASS'")
exec(source,bridge.__dict__)
if __name__=='__main__':
 try: sys.exit(bridge.main())
 except Exception:
  print('{"status":"BLOCK","reason":"PRIVATE_SEQUENCE_BRIDGE_FAILED"}'); sys.exit(2)
