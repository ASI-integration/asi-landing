"""Read-only metadata validation of the admitted isolated restore; no row data output."""
import json
import pathlib
import re
import subprocess

NONCE = '2a7f58e4a68d4732816d4809b4207294'
NAME = 'asi-strigunov4-restore-2a7f58e4a68d-b'
BASE = pathlib.Path('/root/strigunov4-restore-private')
LOGS = BASE / ('logs-' + NONCE + '-b')
source = (BASE / ('input-' + NONCE) / 'globals.sql').read_text()

def run(phase, args, text=None):
    result = subprocess.run(args, input=text, text=True, capture_output=True)
    (LOGS / (phase + '.stdout')).write_text(result.stdout)
    (LOGS / (phase + '.stderr')).write_text(result.stderr)
    if result.returncode:
        print(json.dumps({'phase': phase, 'exit': result.returncode}))
        raise SystemExit(result.returncode)
    return result.stdout

restored = run('redump_roles', ['podman', 'exec', NAME, 'pg_dumpall', '-h', '/lab',
    '-U', 'supabase_admin', '--roles-only', '--no-role-passwords'])
role_report = {}
for prefix, key in [('CREATE ROLE ', 'role_names'), ('ALTER ROLE ', 'role_attributes_and_settings'), ('GRANT ', 'memberships_and_grantors')]:
    original_lines = sorted(x for x in source.splitlines() if x.startswith(prefix))
    restored_lines = sorted(x for x in restored.splitlines() if x.startswith(prefix))
    role_report[key] = {'equal': original_lines == restored_lines,
                        'source_count': len(original_lines), 'restored_count': len(restored_lines)}
    if original_lines != restored_lines:
        (LOGS / (key + '.diff.private.json')).write_text(json.dumps({'source': original_lines, 'restored': restored_lines}))

sql = '''
BEGIN READ ONLY;
SELECT json_build_object(
 'database',(SELECT json_build_object('name',datname,'owner',pg_get_userbyid(datdba),'encoding',pg_encoding_to_char(encoding),'locale_provider',datlocprovider,'collate',datcollate,'ctype',datctype,'locale',datlocale,'acl_entries',cardinality(datacl)) FROM pg_database WHERE datname='postgres'),
 'extensions',(SELECT json_agg(json_build_object('name',extname,'version',extversion,'owner',pg_get_userbyid(extowner)) ORDER BY extname) FROM pg_extension),
 'schemas',(SELECT json_agg(json_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl_entries',cardinality(nspacl)) ORDER BY nspname) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'),
 'tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
 'relations_with_acl',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relacl IS NOT NULL AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
 'default_acl_rows',(SELECT count(*) FROM pg_default_acl),
 'column_acl_rows',(SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE a.attacl IS NOT NULL AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
 'rls_enabled',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relrowsecurity AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
 'rls_forced',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relforcerowsecurity AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
 'policies',(SELECT count(*) FROM pg_policy),
 'migration_count',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'seven_extra_versions_present',(SELECT count(*)=7 FROM supabase_migrations.schema_migrations WHERE version IN ('20260729040307','20260729040309','20260729040332','20260913120838','20260913120856','20260913120921','20260913120945')),
 'vault_rows',(SELECT count(*) FROM vault.secrets),
 'unexpected_probe_roles',(SELECT count(*) FROM pg_roles WHERE rolname LIKE 'asi_restore_%' OR rolname LIKE 'asi_emptyprobe_%'),
 'table_owners',(SELECT json_agg(x) FROM (SELECT pg_get_userbyid(c.relowner) AS owner,count(*) AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' GROUP BY c.relowner ORDER BY 1) x)
);
COMMIT;
'''
output = run('metadata', ['podman', 'exec', '-i', NAME, 'psql', '-X', '-h', '/lab', '-U',
    'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'], sql)
metadata = json.loads(output)
inspection = json.loads(run('final_identity', ['podman', 'inspect', NAME]))[0]
assert inspection['Config']['Labels']['asi.task'] == NONCE
assert inspection['Config']['User'] == '100:101'
assert inspection['HostConfig']['NetworkMode'] == 'none'
assert inspection['HostConfig']['Memory'] == 512*1024*1024
assert inspection['HostConfig']['ReadonlyRootfs']
assert not inspection['HostConfig'].get('PortBindings')
mount_report = [{'destination': m['Destination'], 'type': m['Type'], 'read_write': m['RW']} for m in inspection['Mounts']]
assert sorted(x['destination'] for x in mount_report) == ['/input', '/lab', '/prepared']
assert all(not x['read_write'] for x in mount_report if x['destination'] in ['/input', '/prepared'])
report = {'archive_import_exit_zero': True, 'full_security_restore_pass': False,
    'roles_comparison_to_immutable_globals': role_report, 'metadata': metadata,
    'isolation_verified': True, 'mounts': mount_report,
    'bootstrap_exception': json.loads((LOGS/'bootstrap-exception.json').read_text()),
    'limitations': ['No original LOGIN credential recovery or password tests',
                    'No negative authorization suite yet',
                    'No complete dump-time source data/catalog parity proof',
                    'Built-in plpgsql ownership outside dump needs independent evidence',
                    'Vault empty-row result is not source-root-key decrypt proof']}
(LOGS/'sanitized-restore-result.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
