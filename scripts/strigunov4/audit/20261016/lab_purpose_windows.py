"""Separately reviewed optional-purpose repair and predicate probe, rollback only."""
import hashlib
import json
from pathlib import Path
import sys
from lab_login_windows import BASE, OPENSSL, command, rpc
from lab_rehearsal_windows import EXTRA as REHEARSAL_EXTRA

FIXTURE_HASH='b67e464cdd6003127534fe3e20e770d3a7215b38bdd69c24d982f04c794115e5'
HELPERS=r'''
    fixture=payload['fixture']
    if hashlib.sha256(fixture.encode()).hexdigest()!='b67e464cdd6003127534fe3e20e770d3a7215b38bdd69c24d982f04c794115e5': raise Block('FIXTURE_HASH')
    if re.search(r'^\s*(COMMIT|ROLLBACK|BEGIN)\s*;',fixture,re.M|re.I): raise Block('FIXTURE_TRANSACTION')
    repair=payload['repair']
    if hashlib.sha256(repair.encode()).hexdigest()!='9e2c2516d07041fa29feab60abb010443d66bf7c0337bb89ab73c191e0d69f7f': raise Block('REPAIR_HASH')
    if re.search(r'^\s*(COMMIT|ROLLBACK|BEGIN)\s*;',repair,re.M|re.I): raise Block('REPAIR_TRANSACTION')
    result.update(optional_repair=True,repair_sha256=hashlib.sha256(repair.encode()).hexdigest(),predicate_fixture_sha256=hashlib.sha256(fixture.encode()).hexdigest(),purpose_scope='actual repaired CHECK applied unchanged to temporary one-column table; not full application workflow')
    fixture=repair+'\n'+fixture
    marker="DO $$ BEGIN\n IF NOT EXISTS (SELECT 1 FROM information_schema.columns"
    if rehearsal.count(marker)!=1: raise Block('FIXTURE_INSERTION_POINT')
    rehearsal=rehearsal.replace(marker,fixture+'\n'+marker,1)
    def data_snapshot():
        env=clean_env({'PGPASSWORD':password})
        launcher='unset PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS PGHOST PGPORT PGDATABASE PGUSER; export PGPASSFILE=/nonexistent; exec "$@"'
        p=command(['podman','exec','--env','PGPASSWORD',CONTAINER,'/bin/sh','-c',launcher,'private-data',BIN+'/pg_dump','--data-only','-h',m['socket'],'-p',str(m['port']),'-U','supabase_admin','-d','postgres'],env=env)
        if p.returncode: raise Block('DATA_SNAPSHOT')
        ident=r'(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z_0-9$]*)'
        header=re.compile(r'^COPY ('+ident+r'\.'+ident+r') \((.*)\) FROM stdin;$')
        blocks={}; active=None; seq=[]
        for line in p.stdout.decode().split('\n'):
            if active is not None:
                if line==r'\.': active=None
                else: blocks[active]['rows'].append(line)
            else:
                hit=header.fullmatch(line)
                if hit:
                    if hit[1] in blocks: raise Block('DUPLICATE_COPY')
                    active=hit[1]; blocks[active]={'header':line,'rows':[]}
                elif line.startswith('COPY '): raise Block('UNPARSED_COPY')
                elif line.startswith('SELECT pg_catalog.setval('): seq.append(line)
        if active is not None or not blocks: raise Block('COPY_INCOMPLETE')
        canonical={k:{'header':v['header'],'rows':sorted(v['rows'])} for k,v in blocks.items()}
        return {'copy_tables':len(blocks),'rows':sum(len(v['rows']) for v in blocks.values()),'data_sha256':hashlib.sha256(json.dumps(canonical,sort_keys=True).encode()).hexdigest(),'sequence_count':len(seq),'sequences_sha256':hashlib.sha256(json.dumps(sorted(seq)).encode()).hexdigest()}
    private_map=Path('/root/strigunov4-restore-private/logs-2a7f58e4a68d4732816d4809b4207294-b/per-table-counts.private.json')
    archive_tables=set(json.loads(private_map.read_text())['source'])
    catalog=query(m,"SELECT json_agg(json_build_object('table',format('%I.%I',n.nspname,c.relname),'extension',e.extname,'extension_config_table',CASE WHEN e.oid IS NULL THEN NULL ELSE c.oid=ANY(coalesce(e.extconfig,'{}'::oid[])) END) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' LEFT JOIN pg_extension e ON e.oid=d.refobjid WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%';",password)
    missing=[r for r in catalog if r['table'] not in archive_tables]
    result['archive_coverage']={'catalog_tables':len(catalog),'archive_copy_tables':len(archive_tables),'catalog_without_copy':missing,'copy_without_catalog':sorted(archive_tables-set(r['table'] for r in catalog))}
    before_data=data_snapshot(); result['data_before']=before_data
'''
EXTRA=REHEARSAL_EXTRA.replace('    def schema():',HELPERS+'\n    def schema():')
EXTRA=EXTRA.replace("    result['rehearsal_exit_code']=p.returncode", "    result['fixture_marker_present']='PURPOSE_CONSTRAINT_42_ACCEPTED_UNKNOWN_REJECTED' in p.stdout.decode()\n    result['rehearsal_exit_code']=p.returncode")
EXTRA=EXTRA.replace('    after_schema=schema(); after_history=history(); identity(m)',"    after_schema=schema(); after_history=history(); after_data=data_snapshot(); identity(m)\n    result.update(data_after=after_data,data_and_sequences_unchanged=before_data==after_data,fixture_sha256=hashlib.sha256(fixture.encode()).hexdigest(),authorization_method='CHECK predicate test; not application workflow or LOGIN proof')")
EXTRA=EXTRA.replace("and result['history_unchanged'] else 'BLOCK'","and result['history_unchanged'] and result['data_and_sequences_unchanged'] and result['fixture_marker_present'] else 'BLOCK'")
# Only generic diagnostics: no row values, SQL text, passwords, or arbitrary server messages.
EXTRA=EXTRA.replace("result['failure_category']=next", "result['sqlstate']=next(iter(re.findall(r'ERROR:\\s+([0-9A-Z]{5}):',p.stderr.decode())),None)\n        result['failure_category']=next")


def main():
    root=Path(__file__).parent
    report=json.loads((BASE/'strigunov4-recovery-issued-login-38942690625.json').read_text(encoding='utf-8-sig'))
    cipher=Path(report['encrypted_bundle']).read_bytes()
    if hashlib.sha256(cipher).hexdigest()!=report['encrypted_bundle_sha256']: raise RuntimeError('CREDENTIAL_BUNDLE_HASH')
    bundle=json.loads(command([OPENSSL,'cms','-decrypt','-binary','-inform','DER','-inkey',str(BASE/'private.key'),'-recip',str(BASE/'recipient.crt')],cipher))
    manifest=json.loads((root/'lab_login_manifest.json').read_text(encoding='utf-8-sig'))
    if bundle['target']!=manifest: raise RuntimeError('CREDENTIAL_TARGET_MISMATCH')
    code="__name__='private'\n"+(root/'lab_login_receiver.py').read_text(encoding='utf-8-sig')+'\n'+EXTRA
    result=rpc(code,{'manifest':manifest,'password':bundle['credentials']['supabase_admin'],'data_preflight':(root/'data_preflight.sql').read_text(encoding='utf-8'),'rehearsal':(root/'rehearse.sql').read_text(encoding='utf-8'),'fixture':(root/'purpose_constraint_fixtures.sql').read_text(encoding='utf-8'),'repair':(root/'purpose_constraint_repair.sql').read_text(encoding='utf-8')})
    (BASE/'strigunov4-purpose-rehearsal-38942690625.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,sort_keys=True))
    return 0 if result.get('status')=='ROLLBACK_REHEARSAL_PASS' else 2

if __name__=='__main__':
    try: sys.exit(main())
    except Exception:
        print('{"status":"BLOCK","reason":"PRIVATE_PURPOSE_BRIDGE_FAILED"}')
        sys.exit(2)
