"""Reviewed exact 51-object archive ownership reconciliation, isolated restore only."""
import hashlib
import json
import pathlib
import re
import subprocess

NAME='asi-strigunov4-restore-2a7f58e4a68d-b'
NONCE='2a7f58e4a68d4732816d4809b4207294'
LOGS=pathlib.Path('/root/strigunov4-restore-private/logs-'+NONCE+'-b')
PSQL=['podman','exec','-i',NAME,'psql','-X','-h','/lab','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-Atq']
def run(phase,args,text=None):
    r=subprocess.run(args,input=text,text=True,capture_output=True)
    (LOGS/(phase+'.stdout')).write_text(r.stdout)
    (LOGS/(phase+'.stderr')).write_text(r.stderr)
    if r.returncode:
        print(json.dumps({'phase':phase,'exit':r.returncode}));raise SystemExit(r.returncode)
    return r.stdout

source=(LOGS/'source_schema.stdout').read_text()
target=(LOGS/'target_schema.stdout').read_text()
pattern=r'^-- Name: ((?:FUNCTION|TABLE) .+); Type: ACL; Schema: extensions; Owner: '
expected=set(re.findall(pattern+r'postgres$',source,re.M))
actual_headers=set(re.findall(pattern+r'supabase_admin$',target,re.M))
selected=expected & actual_headers
assert len(selected)==51 and len(expected)==51
toc=(LOGS/'archive_toc.stdout').read_text().splitlines()
tocmap={}
for line in toc:
    m=re.match(r'^(\d+); \d+ \d+ ACL extensions ((?:FUNCTION|TABLE) .+) postgres$',line)
    if m and m[2] in selected: tocmap[m[2]]=(int(m[1]),line)
assert set(tocmap)==selected
q='''SELECT json_agg(x) FROM (
SELECT 'FUNCTION '||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS key,
 p.oid,'pg_proc' AS catalog,'FUNCTION' AS alter_kind,
 quote_ident(n.nspname)||'.'||quote_ident(p.proname)||'('||pg_get_function_identity_arguments(p.oid)||')' AS identity,
 pg_get_userbyid(p.proowner) AS owner,e.extname AS extension
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'
JOIN pg_extension e ON e.oid=d.refobjid WHERE n.nspname='extensions'
UNION ALL
SELECT 'TABLE '||c.relname,c.oid,'pg_class',CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
quote_ident(n.nspname)||'.'||quote_ident(c.relname),pg_get_userbyid(c.relowner),e.extname
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'
JOIN pg_extension e ON e.oid=d.refobjid WHERE n.nspname='extensions') x;'''
members={x['key']:x for x in json.loads(run('extension_member_inventory',PSQL,q))}
assert selected.issubset(members), 'Archive signatures absent from target extension members'
manifest=[]
for key in sorted(selected):
    row=members[key]
    assert row['owner']=='supabase_admin'
    assert row['extension'] in ('pg_stat_statements','pgcrypto','uuid-ossp')
    row.update({'expected_owner':'postgres','acl_toc_id':tocmap[key][0],
                'acl_toc_line_sha256':hashlib.sha256(tocmap[key][1].encode()).hexdigest()})
    manifest.append(row)
assert len(manifest)==51
(LOGS/'extension-owner-manifest.private.json').write_text(json.dumps(manifest,indent=2))
(LOGS/'extension-owner-manifest.sanitized.json').write_text(json.dumps(manifest,indent=2))
sql=['BEGIN;']
for row in manifest:
    ownercolumn='proowner' if row['catalog']=='pg_proc' else 'relowner'
    condition=f"SELECT 1 FROM {row['catalog']} o JOIN pg_depend d ON d.classid='{row['catalog']}'::regclass AND d.objid=o.oid AND d.deptype='e' JOIN pg_extension e ON e.oid=d.refobjid WHERE o.oid={row['oid']} AND {ownercolumn}=(SELECT oid FROM pg_roles WHERE rolname='supabase_admin') AND e.extname='{row['extension']}'"
    sql.append("DO $guard$ BEGIN IF NOT EXISTS ("+condition+") THEN RAISE EXCEPTION 'Exact extension ownership invariant failed'; END IF; END $guard$;")
    sql.append('ALTER '+row['alter_kind']+' '+row['identity']+' OWNER TO postgres;')
sql.append('COMMIT;')
body='\n'.join(sql)
(LOGS/'extension-owner-fix.private.sql').write_text(body)
run('extension_owner_fix_transaction',PSQL,body)
run('schema_after_owner_fix',['podman','exec',NAME,'pg_dump','-h','/lab','-U','supabase_admin','-d','postgres','--schema-only','--create'])
print(json.dumps({'exact_archive_owner_reconciliation':True,'objects':len(manifest),'transaction_exit':0,'extension_counts':{e:sum(x['extension']==e for x in manifest) for e in ('pg_stat_statements','pgcrypto','uuid-ossp')},'source_acl_toc_ids':sorted(x['acl_toc_id'] for x in manifest),'original_acl_replay_done':False}))
