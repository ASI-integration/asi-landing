"""Supported sacrificial reconstruction of three extension ACL baselines."""
import json,pathlib,re,subprocess,collections
NONCE='2a7f58e4a68d4732816d4809b4207294'
NAME='asi-strigunov4-restore-2a7f58e4a68d-b'
PROBE='asi-strigunov4-aclprobe-2a7f58e4a68d'
IMAGE='docker.io/supabase/postgres@sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b'
BASE=pathlib.Path('/root/strigunov4-restore-private')
LOGS=BASE/('logs-'+NONCE+'-b')
PREP=BASE/('prepared-'+NONCE+'-b')
def run(phase,args,text=None):
 r=subprocess.run(args,input=text,text=True,capture_output=True)
 (LOGS/(phase+'.stdout')).write_text(r.stdout);(LOGS/(phase+'.stderr')).write_text(r.stderr)
 if r.returncode: print(json.dumps({'phase':phase,'exit':r.returncode}));raise SystemExit(r.returncode)
 return r.stdout
manifest=json.loads((LOGS/'extension-owner-manifest.private.json').read_text())
selected=[r for r in manifest if r['key'].startswith('FUNCTION pg_stat_statements_reset(') or r['key'] in ['TABLE pg_stat_statements','TABLE pg_stat_statements_info']]
assert len(selected)==3
ids={r['acl_toc_id'] for r in selected}
lines=[l for l in (LOGS/'archive_toc.stdout').read_text().splitlines() if l.split(';')[0].isdigit() and int(l.split(';')[0]) in ids]
assert len(lines)==3
run('three_acl_list',['podman','exec','-i',NAME,'/bin/sh','-c','umask 077; cat > /lab/three-acl.list'],'\n'.join(lines)+'\n')
acl=run('three_acl_source_render',['podman','exec',NAME,'pg_restore','--schema-only','--use-list','/lab/three-acl.list','--file=-','/input/db.dump'])
path=PREP/'three-acl.sql';path.write_text(acl);path.chmod(0o600)
import os
os.chown(path,100,101)
query='''SELECT json_agg(x ORDER BY kind,name,grantor,grantee,privilege_type,is_grantable) FROM (
SELECT 'function' AS kind,p.proname AS name,pg_get_userbyid(p.proowner) AS owner,pg_get_userbyid(a.grantor) AS grantor,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
WHERE n.nspname='extensions' AND p.proname='pg_stat_statements_reset'
UNION ALL
SELECT 'view',c.relname,pg_get_userbyid(c.relowner),pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
WHERE n.nspname='extensions' AND c.relname IN ('pg_stat_statements','pg_stat_statements_info')) x;'''
qp=PREP/'three-acl-query.sql';qp.write_text(query);qp.chmod(0o600);os.chown(qp,100,101)
assert subprocess.run(['podman','volume','exists',PROBE],capture_output=True).returncode==1
run('aclprobe_volume_create',['podman','volume','create','--label','asi.task='+NONCE+'-aclprobe',PROBE])
script='''set -eu
umask 077
initdb -D /lab/data -U postgres --auth=trust --encoding=UTF8 --locale-provider=icu --locale=en_US.UTF-8 --icu-locale=en-US >/lab/initdb.log 2>&1
pg_ctl -D /lab/data -l /lab/server.log -o "-k /lab -c listen_addresses='' -c shared_preload_libraries=pg_stat_statements -c max_logical_replication_workers=0 -c shared_buffers=32MB" -w start >/lab/start.log 2>&1
trap 'pg_ctl -D /lab/data -m fast -w stop >/lab/stop.log 2>&1' EXIT
psql -X -h /lab -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE ROLE dashboard_user; CREATE SCHEMA extensions; CREATE EXTENSION pg_stat_statements WITH SCHEMA extensions VERSION '1.11';" >/lab/create.log 2>&1
psql -X -h /lab -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f /prepared/three-acl.sql >/lab/acl.log 2>&1
psql -X -h /lab -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq -f /prepared/three-acl-query.sql
'''
expected=json.loads(run('aclprobe_reconstruction',['podman','run','--rm','--name',PROBE,'--label','asi.task='+NONCE+'-aclprobe','--network=none','--read-only','--image-volume=ignore','--user','100:101','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=512m','--pids-limit=128','--volume',PROBE+':/lab:U','--volume',str(PREP)+':/prepared:ro','--entrypoint','/bin/sh',IMAGE,'-c',script]))
actual=json.loads(run('three_actual_acl_tuples',['podman','exec','-i',NAME,'psql','-X','-h','/lab','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],query))
assert expected==actual
v=json.loads(run('aclprobe_cleanup_identity',['podman','volume','inspect',PROBE]))[0]
assert v['Labels']['asi.task']==NONCE+'-aclprobe'
run('aclprobe_cleanup',['podman','volume','rm',PROBE])

source=(LOGS/'source_schema.stdout').read_text();target=(LOGS/'target_schema.stdout').read_text()
def blocks(s):
 out={};key='PREAMBLE';lines=[]
 for line in s.split('\n'):
  if line.startswith('-- Name: '): out[key]=lines;key=line;lines=[]
  if not line.startswith(('\\restrict ','\\unrestrict ','-- Dumped from database version ','-- Dumped by pg_dump version ')): lines.append(line)
 out[key]=lines;return out
a,b=blocks(source),blocks(target)
assert list(a)==list(b)
equivalent_default=[];exception_headers=[];unexpected=[]
three_names={r['key'] for r in selected}
for key in a:
 if a[key]==b[key]: continue
 if '; Type: DEFAULT ACL;' in key:
  # Only adjacent complete GRANT statements within the same object block may reorder.
  pattern=re.compile(r'^ALTER DEFAULT PRIVILEGES FOR ROLE (\w+) IN SCHEMA (\w+) GRANT .+ ON (TABLES|SEQUENCES|FUNCTIONS) TO .+;$')
  ax=[line for line in a[key] if pattern.fullmatch(line)]
  bx=[line for line in b[key] if pattern.fullmatch(line)]
  ar=[line for line in a[key] if not pattern.fullmatch(line)]
  br=[line for line in b[key] if not pattern.fullmatch(line)]
  owner_schema_kind={pattern.fullmatch(line).groups() for line in ax+bx}
  if ar==br and collections.Counter(ax)==collections.Counter(bx) and len(owner_schema_kind)==1:
   # Reject interleaved REVOKE: grants must form one contiguous run.
   apos=[i for i,line in enumerate(a[key]) if pattern.fullmatch(line)]
   bpos=[i for i,line in enumerate(b[key]) if pattern.fullmatch(line)]
   if apos==list(range(min(apos),max(apos)+1)) and bpos==list(range(min(bpos),max(bpos)+1)):
    equivalent_default.append(key);continue
 if any(key.startswith('-- Name: '+name+'; Type: ACL;') for name in three_names): exception_headers.append(key);continue
 unexpected.append(key)
assert len(equivalent_default)==15 and len(exception_headers)==3 and not unexpected
report={'schema_semantic_comparison_pass':True,'strict_text_schema_equal':False,
 'exact_other_schema_blocks':len(a)-18,'default_acl_blocks_exact_grant_multisets':15,
 'default_acl_revoke_order_preserved':True,'extension_acl_representation_exceptions':3,
 'three_actual_acl_tuples_match_reconstruction':True,'acl_tuple_count':len(actual),
 'expectation_basis':'Fresh same-version pg_stat_statements1.11 installed as archive-member-owner postgres; unchanged original three ACL TOC entries replayed; expected installation context reconstructed, not source extension-owner evidence',
 'pg_init_privs_modified':False,'sacrificial_cluster_cleaned':True,'full_security_restore_pass':False}
(LOGS/'sanitized-schema-semantic-comparison.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
