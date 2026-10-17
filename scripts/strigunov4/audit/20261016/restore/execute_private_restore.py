"""Run only inside the admitted dedicated WSL distro after transfer-ready signal.
No secrets embedded; all subprocess output goes to owner-only files.
"""
import json
import hashlib
import os
import pathlib
import re
import stat
import subprocess
import time

NONCE = '2a7f58e4a68d4732816d4809b4207294'
BASE = pathlib.Path('/root/strigunov4-restore-private')
INPUT = BASE / ('input-' + NONCE)
LOGS = BASE / ('logs-' + NONCE + '-b')
PREPARED = BASE / ('prepared-' + NONCE + '-b')
NAME = 'asi-strigunov4-restore-' + NONCE[:12] + '-b'
VOLUME = NAME + '-data'
ADMIN = 'supabase_admin'
IMAGE = 'docker.io/supabase/postgres@sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b'
os.umask(0o077)
LOGS.mkdir(mode=0o700, exist_ok=False)

def run(phase, args, *, stdin=None, check=True):
    result = subprocess.run(args, input=stdin, capture_output=True)
    (LOGS / (phase + '.stdout')).write_bytes(result.stdout)
    (LOGS / (phase + '.stderr')).write_bytes(result.stderr)
    print(json.dumps({'phase': phase, 'exit': result.returncode}), flush=True)
    if check and result.returncode:
        print(json.dumps({'status': 'STOPPED_ON_ERROR', 'phase': phase,
                          'private_log_directory': str(LOGS)}), flush=True)
        raise SystemExit(result.returncode)
    return result

def sql(phase, text, database='postgres'):
    return run(phase, ['podman', 'exec', '-i', NAME, 'psql', '-X', '-h', '/lab',
                      '-U', ADMIN, '-d', database, '-v', 'ON_ERROR_STOP=1',
                      '-v', 'VERBOSITY=verbose', '-A', '-t'], stdin=text.encode())

for filename in ('db.dump', 'globals.sql'):
    path = INPUT / filename
    info = path.lstat()
    assert stat.S_ISREG(info.st_mode) and info.st_uid == 100 and info.st_gid == 101
    assert stat.S_IMODE(info.st_mode) == 0o600
expected_hashes = {'db.dump': 'c53aac07cfe623a0f0f1306a9144c319cbaaa679ad1c8a52beb07f63cf336c92',
                   'globals.sql': 'f708fb1cdccf47d0675e80b8b550edebb32b41ecad1a51337b4b8c5a9948b27c'}
for filename, expected in expected_hashes.items():
    assert hashlib.sha256((INPUT / filename).read_bytes()).hexdigest() == expected
assert (INPUT / 'db.dump').read_bytes()[:5] == b'PGDMP'
original_globals = (INPUT / 'globals.sql').read_bytes()
bootstrap_create = b'CREATE ROLE supabase_admin;'
matches = list(re.finditer(rb'(?m)^CREATE ROLE supabase_admin;(?=\r?$)', original_globals))
assert len(matches) == 1
bootstrap_assertion = b'''DO $asi_bootstrap$ BEGIN
IF current_user <> 'supabase_admin' OR NOT EXISTS
(SELECT 1 FROM pg_roles WHERE rolname='supabase_admin' AND oid=10 AND rolsuper)
THEN RAISE EXCEPTION 'Bootstrap role invariant failed'; END IF;
END $asi_bootstrap$;'''
match = matches[0]
derived_globals = original_globals[:match.start()] + bootstrap_assertion + original_globals[match.end():]
assert derived_globals.replace(bootstrap_assertion, bootstrap_create, 1) == original_globals
assert derived_globals.count(bootstrap_assertion) == 1
PREPARED.mkdir(mode=0o700, exist_ok=False)
os.chown(PREPARED, 100, 101)
execution_globals = PREPARED / 'globals.exec.sql'
execution_globals.write_bytes(derived_globals)
os.chmod(execution_globals, 0o600)
os.chown(execution_globals, 100, 101)
(LOGS / 'bootstrap-exception.json').write_text(json.dumps({
    'original_sha256': hashlib.sha256(original_globals).hexdigest(),
    'derived_sha256': hashlib.sha256(derived_globals).hexdigest(),
    'replacements': 1, 'replacement': 'CREATE ROLE supabase_admin -> OID10/current_user/superuser assertion',
    'all_other_bytes_unchanged': True, 'parent_review_authorized': True}))
previous_name = 'asi-strigunov4-restore-' + NONCE[:12]
previous = json.loads(run('previous_identity', ['podman', 'inspect', previous_name]).stdout)[0]
assert previous['Config']['Labels']['asi.task'] == NONCE and not previous['State']['Running']
previous_volume = previous_name + '-data'
pv = json.loads(run('previous_volume_identity', ['podman', 'volume', 'inspect', previous_volume]).stdout)[0]
assert pv['Labels']['asi.task'] == NONCE
run('remove_failed_container', ['podman', 'rm', previous_name])
run('remove_failed_volume', ['podman', 'volume', 'rm', previous_volume])
assert subprocess.run(['podman', 'container', 'exists', NAME], capture_output=True).returncode == 1
assert subprocess.run(['podman', 'volume', 'exists', VOLUME], capture_output=True).returncode == 1
run('create_volume', ['podman', 'volume', 'create', '--label', 'asi.task=' + NONCE, VOLUME])
boot = '''set -eu
umask 077
initdb -D /lab/data -U "$1" --auth=trust --encoding=UTF8 --locale-provider=icu --locale=en_US.UTF-8 --icu-locale=en-US > /lab/initdb.log 2>&1
exec postgres -D /lab/data -k /lab -c listen_addresses= -c shared_preload_libraries=pg_stat_statements -c max_logical_replication_workers=0 -c shared_buffers=32MB >> /lab/server.log 2>&1
'''
run('start_container', ['podman', 'run', '-d', '--name', NAME, '--label', 'asi.task=' + NONCE,
    '--network=none', '--read-only', '--image-volume=ignore', '--user', '100:101', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--memory=512m', '--pids-limit=128',
    '--volume', VOLUME + ':/lab:U', '--volume', str(INPUT) + ':/input:ro',
    '--volume', str(PREPARED) + ':/prepared:ro',
    '--entrypoint', '/bin/sh', IMAGE, '-c', boot, 'bootstrap', ADMIN])
for attempt in range(40):
    ready = subprocess.run(['podman', 'exec', NAME, 'pg_isready', '-h', '/lab', '-U', ADMIN],
                           capture_output=True)
    if ready.returncode == 0:
        break
    time.sleep(0.5)
else:
    print(json.dumps({'status': 'STOPPED_ON_STARTUP', 'container': NAME}), flush=True)
    raise SystemExit(1)
inspection = json.loads(run('identity_guard', ['podman', 'inspect', NAME]).stdout)[0]
assert inspection['Config']['Labels']['asi.task'] == NONCE
assert inspection['Config']['User'] == '100:101'
assert inspection['HostConfig']['NetworkMode'] == 'none'
assert inspection['HostConfig']['Memory'] == 512 * 1024 * 1024
assert inspection['HostConfig']['ReadonlyRootfs'] is True
guard = sql('bootstrap_identity', 'SELECT current_user; SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=\'postgres\';')
assert guard.stdout.decode().strip().splitlines() == [ADMIN, ADMIN]
run('globals', ['podman', 'exec', NAME, 'psql', '-X', '-h', '/lab', '-U', ADMIN,
    '-d', 'template1', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    '--single-transaction', '-f', '/prepared/globals.exec.sql'])
toc = run('archive_toc', ['podman', 'exec', NAME, 'pg_restore', '--list', '--create', '/input/db.dump']).stdout
selected = [line for line in toc.splitlines() if re.match(rb'^(7282|7283|7284|7285);', line)]
assert len(selected) == 4
run('database_list_write', ['podman', 'exec', '-i', NAME, '/bin/sh', '-c', 'umask 077; cat > /lab/database.list'],
    stdin=b'\n'.join(selected) + b'\n')
run('database_render', ['podman', 'exec', NAME, 'pg_restore', '--schema-only', '--create',
    '--use-list', '/lab/database.list', '--file', '/lab/database.sql', '/input/db.dump'])
sql('drop_owned_bootstrap_database', 'DROP DATABASE postgres;', database='template1')
run('create_archive_database', ['podman', 'exec', NAME, 'psql', '-X', '-h', '/lab',
    '-U', ADMIN, '-d', 'template1', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    '-f', '/lab/database.sql'])
run('full_archive_restore', ['podman', 'exec', NAME, 'pg_restore', '-h', '/lab', '-U', ADMIN,
    '--dbname', 'postgres', '--exit-on-error', '--single-transaction', '/input/db.dump'])
print(json.dumps({'status': 'ARCHIVE_IMPORT_EXIT_ZERO', 'full_security_restore_pass': False,
                  'container': NAME, 'volume': VOLUME, 'private_logs': str(LOGS)}), flush=True)
