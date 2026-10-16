"""Private WSL receiver. All input/output is structured; never outputs SQL/passwords.
Requires root-reviewed exact runtime identity in manifest, not arbitrary targets.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import time

CONTAINER = 'asi-strigunov4-restore-2a7f58e4a68d-b'
NONCE = '2a7f58e4a68d4732816d4809b4207294'
BIN = '/nix/var/nix/profiles/default/bin'
IMAGE = 'sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b'
ROLE_SQL = """SELECT json_build_object('roles',(SELECT json_agg(row_to_json(r) ORDER BY rolname) FROM (SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,md5(coalesce(rolconfig::text,'')) AS config_fingerprint FROM pg_roles) r),'memberships',(SELECT md5(coalesce(string_agg(format('%s:%s:%s:%s:%s:%s',pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor),admin_option,inherit_option,set_option),'|' ORDER BY roleid,member,grantor),'')) FROM pg_auth_members));"""


class Block(Exception):
    pass


def clean_env(extra=None):
    env = {k: os.environ[k] for k in ('PATH','HOME','XDG_RUNTIME_DIR') if k in os.environ}
    env.update(LC_ALL='C', LANG='C')
    if extra:
        env.update(extra)
    return env


def command(args, data=None, env=None, timeout=40):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, env=env or clean_env(), timeout=timeout)


def identity(m):
    if os.getuid() != 0 or m.get('nonce') != NONCE or m.get('container_name') != CONTAINER:
        raise Block('TARGET_IDENTITY')
    p = command(['podman','inspect',CONTAINER])
    if p.returncode:
        raise Block('CONTAINER_INSPECT')
    i = json.loads(p.stdout)[0]
    if i.get('Id') != m.get('container_id') or not i.get('State',{}).get('Running'):
        raise Block('CONTAINER_ID_OR_STATE')
    if i.get('Config',{}).get('Labels') != m.get('labels') or i.get('Config',{}).get('Labels',{}).get('asi.task') != NONCE:
        raise Block('CONTAINER_LABELS')
    if i.get('HostConfig',{}).get('NetworkMode') != 'none' or i.get('NetworkSettings',{}).get('Ports'):
        raise Block('NETWORK_NOT_ISOLATED')
    if i.get('Mounts') != m.get('mounts'):
        raise Block('MOUNTS_CHANGED')
    # Require digest identity from inspected RepoDigests, never just a tag.
    q=command(['podman','image','inspect',i['Image']])
    if q.returncode or not any(x.endswith('@'+IMAGE) for x in json.loads(q.stdout)[0].get('RepoDigests',[])):
        raise Block('IMAGE_DIGEST')
    return i


def psql(m, role, sql, password=None):
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]*', role):
        raise Block('ROLE_IDENTIFIER')
    env=clean_env({'PGPASSWORD':password}) if password is not None else clean_env()
    args=['podman','exec','-i','--env','LC_ALL=C']
    if password is not None:
        args += ['--env','PGPASSWORD']
    launcher='unset PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS PGHOST PGPORT PGDATABASE PGUSER; export PGPASSFILE=/nonexistent PGSSLMODE=disable; '
    if password is None:
        launcher+='unset PGPASSWORD; '
    launcher+='exec "$@"'
    args += [CONTAINER,'/bin/sh','-c',launcher,'private-psql',BIN+'/psql','-X','-w','-A','-t','-h',m['socket'],
             '-p',str(m['port']),'-U',role,'-d','postgres','--set','ON_ERROR_STOP=1']
    return command(args,sql.encode(),env)


def query(m, sql, password=None):
    p=psql(m,'supabase_admin',sql,password)
    if p.returncode:
        if b'service' in p.stderr.lower(): raise Block('PRIVATE_QUERY_SERVICE_ENV_FAILED')
        if b'hostaddr' in p.stderr.lower(): raise Block('PRIVATE_QUERY_HOSTADDR_ENV_FAILED')
        if b'function' in p.stderr.lower(): raise Block('PRIVATE_QUERY_FUNCTION_FAILED')
        if b'column' in p.stderr.lower(): raise Block('PRIVATE_QUERY_COLUMN_FAILED')
        raise Block('PRIVATE_QUERY_FAILED')
    return json.loads(p.stdout)


def inventory(m):
    identity(m)
    probe=command(['podman','exec','-i','--env','ASI_LOGIN_PROBE',CONTAINER,
        BIN+'/psql','-X','-w','-A','-t','-h',m['socket'],'-p',str(m['port']),
        '-U','supabase_admin','-d','postgres','--set','ON_ERROR_STOP=1'],
        b'\\getenv probe ASI_LOGIN_PROBE\n\\echo :probe\n',
        clean_env({'ASI_LOGIN_PROBE':'nonsecret-forwarding-check'}))
    if probe.returncode or probe.stdout.strip()!=b'nonsecret-forwarding-check':
        raise Block('NAME_ONLY_ENV_FORWARDING')
    baseline=query(m,ROLE_SQL)
    settings=query(m,"SELECT json_object_agg(name,setting) FROM pg_settings WHERE name IN ('log_statement','log_min_duration_statement','log_min_duration_sample','log_transaction_sample_rate','log_statement_sample_rate','log_duration','shared_preload_libraries','session_preload_libraries','local_preload_libraries','hba_file','data_directory','unix_socket_directories','port');")
    if settings.get('log_statement')!='none' or settings.get('log_min_duration_statement')!='-1' or settings.get('log_min_duration_sample')!='-1' or settings.get('log_transaction_sample_rate') not in ('0','0.0') or settings.get('log_duration')!='off':
        raise Block('SERVER_STATEMENT_LOGGING')
    if set(x.strip() for x in settings.get('shared_preload_libraries','').split(',') if x.strip()) - {'pg_stat_statements'} or settings.get('session_preload_libraries') or settings.get('local_preload_libraries'):
        raise Block('UNEXPECTED_AUDIT_PRELOAD')
    if settings.get('hba_file')!=m['hba_container'] or settings.get('data_directory')!=m['data_container'] or settings.get('port')!=str(m['port']) or settings.get('unix_socket_directories')!=m['socket']:
        raise Block('DATABASE_PATH_MISMATCH')
    return {'baseline':baseline,'settings':settings,'status':'INVENTORY_VERIFIED'}


def mutate_and_verify(m, payload):
    before=inventory(m)
    if before['baseline'] != payload['baseline']:
        raise Block('ROLE_BASELINE_CHANGED')
    creds=payload['credentials']
    roles=sorted(r['rolname'] for r in before['baseline']['roles'] if r['rolcanlogin'])
    if sorted(creds)!=roles or any(not re.fullmatch(r'[A-Za-z0-9_-]{40,100}',v) for v in creds.values()):
        raise Block('CREDENTIAL_ROLE_SET')
    hba=Path(m['hba_host'])
    if hba.resolve()!=hba or not hba.is_file() or hba.name!='pg_hba.conf':
        raise Block('HBA_HOST_PATH')
    # hba_host comes from the already admitted exact owned mount; ensure mapping.
    matching=[x for x in m['mounts'] if m['hba_container'].startswith(x['Destination'].rstrip('/')+'/')]
    if len(matching)!=1 or str(Path(matching[0]['Source']) / m['hba_container'][len(matching[0]['Destination'].rstrip('/'))+1:]) != str(hba):
        raise Block('HBA_MOUNT_MAPPING')
    original=hba.read_bytes(); oldstat=hba.stat()
    if hashlib.sha256(original).hexdigest()!=m['hba_sha256']:
        raise Block('HBA_CHANGED')
    backup=hba.with_name('pg_hba.pre-login-'+NONCE)
    temp=hba.with_name('pg_hba.scram-'+NONCE)
    if backup.exists() or backup.is_symlink() or temp.exists() or temp.is_symlink():
        raise Block('HBA_OPERATION_ALREADY_EXISTS')
    sql="BEGIN; SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic'; SET LOCAL log_min_duration_statement=-1; SET LOCAL log_min_duration_sample=-1; SET LOCAL log_transaction_sample_rate=0; SET LOCAL log_duration=off; SET LOCAL log_parameter_max_length=0; SET LOCAL log_parameter_max_length_on_error=0; SET LOCAL pg_stat_statements.track='none'; SET LOCAL password_encryption='scram-sha-256';\n"
    for role in roles:
        sql += 'ALTER ROLE "'+role.replace('"','""')+'" PASSWORD \''+creds[role]+"';\n"
    sql+='COMMIT;'
    p=psql(m,'supabase_admin',sql)
    if p.returncode:
        raise Block('PASSWORD_TRANSACTION_FAILED')
    result={'passwords_changed':True,'credential_purpose':'recovery-issued lab credentials','source_original_password_recovery':'NOT_PROVEN','full_restore_acceptance':'NOT_PROVEN'}
    if query(m,ROLE_SQL)!=before['baseline']:
        result.update(status='BLOCK',reason='NONPASSWORD_ROLE_DRIFT'); return result
    new=b'local all all scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n'
    with backup.open('xb') as f:
        os.chmod(backup,0o600); f.write(original)
    with temp.open('xb') as f:
        os.chmod(temp,stat.S_IMODE(oldstat.st_mode)); os.chown(temp,oldstat.st_uid,oldstat.st_gid); f.write(new)
    os.replace(temp,hba)
    reload=command(['podman','exec',CONTAINER,BIN+'/pg_ctl','-D',m['data_container'],'reload'])
    if reload.returncode:
        result.update(status='BLOCK',reason='HBA_RELOAD_FAILED',hba_file_changed=True,active_hba='NOT_PROVEN'); return result
    try:
        # Reload is asynchronous. A correct login under old trust proves nothing.
        active_scram=False
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            rejected=psql(m,'supabase_admin','SELECT 1;',secrets.token_urlsafe(32))
            if rejected.returncode!=0 and b'password authentication failed for user' in rejected.stderr:
                active_scram=True; break
            if rejected.returncode!=0:
                raise Block('SCRAM_ACTIVATION_UNEXPECTED_ERROR')
            time.sleep(0.25)
        if not active_scram:
            raise Block('SCRAM_ACTIVATION_NOT_PROVEN')
        rules=query(m,"SELECT json_build_object('errors',count(*) FILTER (WHERE error IS NOT NULL),'rules',count(*)) FROM pg_hba_file_rules;",creds['supabase_admin'])
        if rules!={'errors':0,'rules':3}:
            raise Block('HBA_RULES')
    except Exception:
        # Restore only our original HBA to recover this disposable cluster.
        hba.write_bytes(original)
        command(['podman','exec',CONTAINER,BIN+'/pg_ctl','-D',m['data_container'],'reload'])
        result.update(status='BLOCK',reason='SCRAM_ADMIN_VERIFICATION_FAILED',hba_rollback_requested=True,active_hba='NOT_PROVEN'); return result
    outcomes=[]
    for role in roles:
        good=psql(m,role,'SELECT current_user, session_user;',creds[role])
        goodok=good.returncode==0 and good.stdout.decode().strip()==role+'|'+role
        bad=psql(m,role,'SELECT 1;',secrets.token_urlsafe(32))
        badok=bad.returncode!=0 and b'password authentication failed for user' in bad.stderr
        outcomes.append({'role':role,'correct_login':goodok,'wrong_password_rejected':badok})
    parity=query(m,ROLE_SQL,creds['supabase_admin'])==before['baseline']
    identity(m)
    result.update(status='LOGIN_CHECKS_RECORDED',role_metadata_memberships_unchanged=parity,
        hba_sha256=hashlib.sha256(hba.read_bytes()).hexdigest(),hba_original_sha256=m['hba_sha256'],
        hba_parse_errors=0,roles=outcomes,all_logins_pass=all(x['correct_login'] and x['wrong_password_rejected'] for x in outcomes) and parity)
    result['active_scram_wrong_admin_denial_before_positive_checks']=True
    return result


if __name__=='__main__':
    try:
        p=json.load(sys.stdin)
        result=inventory(p['manifest']) if p['action']=='inventory' else mutate_and_verify(p['manifest'],p)
    except Block as exc:
        result={'status':'BLOCK','reason':str(exc),'mutation_state':'UNKNOWN_IF_MUTATE_ACTION','full_restore_acceptance':'NOT_PROVEN'}
    except Exception:
        result={'status':'BLOCK','reason':'PRIVATE_LOGIN_VALIDATION_FAILED','mutation_state':'UNKNOWN_IF_MUTATE_ACTION','full_restore_acceptance':'NOT_PROVEN'}
    print(json.dumps(result,sort_keys=True))
