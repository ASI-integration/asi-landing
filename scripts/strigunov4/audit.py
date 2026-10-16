"""Protected read-only audit; exit97 when invoked with run_smoke_test=true."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlparse, unquote
from preflight import PROJECT, target_valid

WORKFLOW = 'ASI-integration/asi-landing/.github/workflows/deploy-staging.yml@refs/heads/main'

def connection_env(source, url):
    if not target_valid(url):
        raise ValueError('invalid target')
    u = urlparse(url)
    env = {k: source[k] for k in ('PATH',) if k in source}
    env.update(LANG='C', LC_ALL='C', PGHOST=u.hostname,
               PGPORT=str(u.port or 5432), PGUSER=unquote(u.username),
               PGPASSWORD=unquote(u.password or ''), PGDATABASE='postgres',
               PGPASSFILE='/dev/null', PGCONNECT_TIMEOUT='15',
               PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000',
               PGSSLMODE='verify-full', PGSSLROOTCERT='/etc/ssl/certs/ca-certificates.crt')
    return env

def error_code(stderr):
    # Only fixed labels and a five-character SQLSTATE may leave the process.
    state = re.search(r'(?:ERROR|FATAL|PANIC):\s+([0-9A-Z]{5}):', stderr)
    code = state.group(1) if state else None
    lower = stderr.lower()
    if any(s in lower for s in ('certificate verify failed','root certificate','server certificate','ssl error','tls error')):
        category = 'TLS'
    elif code == '42501': category = 'PERMISSION'
    elif code == '57014' or 'timeout' in lower or 'timed out' in lower: category = 'TIMEOUT'
    elif code and code.startswith('28') or 'authentication failed' in lower: category = 'AUTHENTICATION'
    elif 'could not translate host name' in lower: category = 'DNS'
    elif 'socket' in lower and 'no such file' in lower: category = 'LOCAL_SOCKET_UNAVAILABLE'
    elif code: category = 'SQL'
    elif any(s in lower for s in ('connection','could not connect','network is unreachable')): category = 'CONNECTION'
    else: category = 'CLIENT_OR_UNKNOWN'
    return {'category':category,'sqlstate':code}

def query(env, sql):
    wrapped = "BEGIN READ ONLY; SET LOCAL statement_timeout='30s';\n" + sql + '\nROLLBACK;'
    try:
        r = subprocess.run(['psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1',
                            '-v','VERBOSITY=verbose'], input=wrapped,
                           env=env, capture_output=True, text=True, timeout=50)
    except subprocess.TimeoutExpired:
        return {'status':'BLOCK','category':'TIMEOUT','sqlstate':None}
    except OSError:
        return {'status':'BLOCK','category':'CLIENT_UNAVAILABLE','sqlstate':None}
    if r.returncode:
        return {'status':'BLOCK',**error_code(r.stderr)}
    try:
        return {'status':'PASS','data':json.loads(r.stdout)}
    except (ValueError,TypeError):
        return {'status':'BLOCK','category':'INVALID_RESULT','sqlstate':None}

def sections():
    # Reviewed catalog format: one named metadata expression per line.
    result = {}
    for line in Path(__file__).with_name('catalog.sql').read_text().splitlines():
        match = re.fullmatch(r" '([a-z_]+)',(.+?)(?:,)?", line)
        if match:
            name, expr = match.groups()
            result[name] = "SELECT jsonb_build_object('" + name + "'," + expr + ');'
    if len(result) != 16:
        raise ValueError('catalog section count mismatch')
    return result

def main():
    source = os.environ
    url = source.get('STAGING_DATABASE_URL','')
    if (source.get('GITHUB_REF') != 'refs/heads/main'
        or source.get('GITHUB_WORKFLOW_REF') != WORKFLOW
        or source.get('STAGING_SUPABASE_PROJECT_REF') != PROJECT or not target_valid(url)):
        print('BLOCK: protected staging identity check failed')
        return 97
    env = connection_env(source,url)
    probe = query(env,"SELECT jsonb_build_object('server_version',current_setting('server_version'),'read_only',current_setting('transaction_read_only'));")
    print(json.dumps({'section':'connection',**probe}))
    if probe['status']=='PASS' and probe['data'].get('read_only')=='on' and probe['data'].get('server_version','').startswith('17.'):
        try:
            for name, sql in sections().items():
                print(json.dumps({'section':name,**query(env,sql)}))
        except ValueError:
            print('BLOCK: catalog section contract invalid')
    else:
        print('BLOCK: connection/read-only/server-version gate')
    print('AUDIT ONLY: intentional exit 97; deployment steps must remain skipped')
    return 97

if __name__ == '__main__': sys.exit(main())
