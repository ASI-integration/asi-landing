"""Synthetic PG17 contract check. Requires an isolated disposable CI service."""
import json
import os
from pathlib import Path
import subprocess

def sql(text):
    env = {k: os.environ[k] for k in ('PATH','LANG','LC_ALL') if k in os.environ}
    env.update(PGHOST='127.0.0.1', PGPORT='5432', PGUSER='postgres', PGDATABASE='synthetic', PGPASSWORD='synthetic-only', PGPASSFILE='/dev/null', PGSSLMODE='disable')
    return subprocess.run(['psql','-X','-A','-t','-v','ON_ERROR_STOP=1'],input=text,
                          text=True,capture_output=True,check=True,env=env).stdout

def main():
    required = {'GITHUB_ACTIONS':'true', 'ASI_CATALOG_SYNTHETIC':'YES', 'PGHOST':'127.0.0.1', 'PGDATABASE':'synthetic', 'PGUSER':'postgres', 'PGPORT':'5432'}
    if any(os.environ.get(k) != v for k,v in required.items()):
        raise SystemExit('BLOCK: disposable CI fixture identity required')
    sql("""
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text,name text,statements text[]);
    INSERT INTO supabase_migrations.schema_migrations VALUES ('20260729040307','synthetic',ARRAY['synthetic marker']);
    CREATE SCHEMA runtime_bridge;
    CREATE TABLE public.synthetic_secret(id integer PRIMARY KEY, secret text);
    INSERT INTO public.synthetic_secret VALUES (1,'MUST_NOT_APPEAR_IN_CATALOG');
    ALTER TABLE public.synthetic_secret ENABLE ROW LEVEL SECURITY;
    CREATE POLICY synthetic_policy ON public.synthetic_secret FOR SELECT USING (false);
    CREATE FUNCTION runtime_bridge.synthetic_guard() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    """)
    result=sql(Path(__file__).with_name('catalog.sql').read_text())
    assert 'MUST_NOT_APPEAR_IN_CATALOG' not in result
    payload=json.loads(next(x for x in result.splitlines() if x.startswith('{')))
    assert payload['read_only']=='on'
    assert payload['server_version'].startswith('17.')
    assert any(t['name']=='synthetic_secret' and t['rls'] for t in payload['tables'])
    assert any(f['schema']=='runtime_bridge' and f['name']=='synthetic_guard' for f in payload['functions'])
    assert payload['migration_history'][0]['version']=='20260729040307'
    assert 'statements' not in payload['migration_history'][0]
    assert sql('SELECT count(*) FROM public.synthetic_secret').strip()=='1'
    print('PASS: PG17 catalog contract, metadata coverage, read-only transaction, user data excluded')

if __name__ == '__main__':
    main()
