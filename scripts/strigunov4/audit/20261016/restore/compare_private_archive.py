"""Compare immutable archive COPY counts/schema; bounded rollback-only denial checks."""
import difflib
import json
import pathlib
import re
import subprocess

NAME = 'asi-strigunov4-restore-2a7f58e4a68d-b'
LOGS = pathlib.Path('/root/strigunov4-restore-private/logs-2a7f58e4a68d4732816d4809b4207294-b')
PSQL = ['podman','exec','-i',NAME,'psql','-X','-h','/lab','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-Atq']

def run(phase,args,text=None,check=True):
    r=subprocess.run(args,input=text,text=True,capture_output=True)
    (LOGS/(phase+'.stdout')).write_text(r.stdout)
    (LOGS/(phase+'.stderr')).write_text(r.stderr)
    if check and r.returncode:
        print(json.dumps({'phase':phase,'exit':r.returncode}))
        raise SystemExit(r.returncode)
    return r

data=run('archive_data_render_v2',['podman','exec',NAME,'pg_restore','--data-only','--file=-','/input/db.dump']).stdout
ident=r'(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z_0-9$]*)'
header=re.compile(r'^COPY ('+ident+r'\.'+ident+r') \((.*)\) FROM stdin;$')
counts={}
active=None
for line in data.split('\n'):
    if active is not None:
        if line==r'\.':
            active=None
        else:
            counts[active]+=1
    else:
        m=header.fullmatch(line)
        if m:
            assert m[1] not in counts
            active=m[1]
            counts[active]=0
assert active is None and counts
parts=[]
for table in counts:
    label=table.replace("'","''")
    parts.append("SELECT '"+label+"' AS table_name,count(*) AS rows FROM ONLY "+table)
query='BEGIN READ ONLY; SELECT json_object_agg(table_name,rows) FROM ('+' UNION ALL '.join(parts)+') x; COMMIT;'
actual=json.loads(run('restored_table_counts',PSQL,query).stdout)
mismatches=[table for table in counts if counts[table]!=actual.get(table)]
table_report={'archive_copy_tables':len(counts),'restored_tables_checked':len(actual),'per_table_counts_equal':not mismatches,'mismatched_tables':mismatches,'source_total_rows':sum(counts.values()),'restored_total_rows':sum(actual.values()),'row_value_equality_verified':False}
(LOGS/'per-table-counts.private.json').write_text(json.dumps({'source':counts,'restored':actual}))
target_data=run('target_data_export',['podman','exec',NAME,'pg_dump','-h','/lab','-U','supabase_admin','-d','postgres','--data-only']).stdout
def copy_blocks(text):
    blocks={}; current=None; sequence_statements=[]
    for line in text.split('\n'):
        if current is not None:
            if line==r'\.': current=None
            else: blocks[current]['rows'].append(line.encode('utf-8'))
        else:
            match=header.fullmatch(line)
            if match:
                assert match[1] not in blocks
                current=match[1]; blocks[current]={'header':line,'rows':[]}
            elif line.startswith('COPY '): raise AssertionError('Unrecognized COPY header')
            elif line.startswith('SELECT pg_catalog.setval('): sequence_statements.append(line)
    assert current is None
    return blocks,sorted(sequence_statements)
source_blocks,source_sequences=copy_blocks(data)
target_blocks,target_sequences=copy_blocks(target_data)
header_equal=set(source_blocks)==set(target_blocks) and all(source_blocks[k]['header']==target_blocks[k]['header'] for k in source_blocks)
value_mismatches=[k for k in source_blocks if k not in target_blocks or sorted(source_blocks[k]['rows'])!=sorted(target_blocks[k]['rows'])]
table_report.update({'copy_headers_equal':header_equal,'row_value_equality_verified':header_equal and not value_mismatches,'row_value_mismatched_tables':value_mismatches,'comparison':'per-table sorted COPY row UTF8 bytes; physical row order only ignored','sequence_setval_statements_equal':source_sequences==target_sequences,'source_sequence_setval_count':len(source_sequences),'restored_sequence_setval_count':len(target_sequences)})

source_schema=run('source_schema',['podman','exec',NAME,'pg_restore','--schema-only','--create','--file=-','/input/db.dump']).stdout
target_schema=run('target_schema',['podman','exec',NAME,'pg_dump','-h','/lab','-U','supabase_admin','-d','postgres','--schema-only','--create']).stdout
def normalize(s):
    return '\n'.join(line for line in s.splitlines() if not line.startswith(('\\restrict ','\\unrestrict ','-- Dumped from database version ','-- Dumped by pg_dump version ')))
a,b=normalize(source_schema),normalize(target_schema)
diff=list(difflib.unified_diff(a.splitlines(),b.splitlines(),fromfile='archive',tofile='restored',lineterm=''))
(LOGS/'schema.private.diff').write_text('\n'.join(diff))
schema_report={'normalized_schema_equal':a==b,'normalization':['random restrict/unrestrict tokens','dump/database version comment headers'],'diff_lines':len(diff),'source_lines':len(a.splitlines()),'restored_lines':len(b.splitlines())}

denials=[]
for phase,table in [('anon_auth_users','auth.users'),('anon_vault_secrets','vault.secrets')]:
    q='BEGIN; SET LOCAL ROLE anon; SELECT 1 FROM '+table+' LIMIT 1; ROLLBACK;'
    r=run(phase,PSQL,q,check=False)
    states=re.findall(r'ERROR:\s+([0-9A-Z]{5}):',r.stderr)
    denials.append({'case':phase,'table':table,'denied_expected_42501':r.returncode!=0 and states==['42501'],'exit':r.returncode,'sqlstates':states,'connection_method':'admin connection SET LOCAL ROLE, not LOGIN proof','data_returned':False})
report={'table_data_counts':table_report,'schema_comparison':schema_report,'negative_authorization_cases':denials,'full_security_restore_pass':False}
(LOGS/'sanitized-archive-comparison.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
