"""Existing protected deploy workflow audit-only hook. Stops continuation when invoked (requires run_smoke_test=true)."""
import os
from pathlib import Path
import subprocess
import sys
from preflight import PROJECT, target_valid

def main():
    source = os.environ
    env = {k: source[k] for k in ('PATH', 'LANG', 'LC_ALL') if k in source}
    url = source.get('STAGING_DATABASE_URL', '')
    if (source.get('GITHUB_REF') != 'refs/heads/main'
        or source.get('GITHUB_WORKFLOW_REF') != 'ASI-integration/asi-landing/.github/workflows/deploy-staging.yml@refs/heads/main'
        or source.get('STAGING_SUPABASE_PROJECT_REF') != PROJECT or not target_valid(url)):
        print('BLOCK: protected staging identity check failed')
        return 97
    # libpq environment avoids URL in command line or process error text.
    env['PGDATABASE'] = url
    env['PGPASSFILE'] = '/dev/null'
    env['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=30000'
    env['PGSSLMODE'] = 'verify-full'
    env['PGSSLROOTCERT'] = '/etc/ssl/certs/ca-certificates.crt'
    try:
        r = subprocess.run(['psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                            '-f', str(Path(__file__).with_name('catalog.sql'))],
                           env=env, capture_output=True, text=True, timeout=90)
        if r.returncode:
            print('BLOCK: catalog query failed; connection details suppressed')
        else:
            # SQL contains only metadata, hashes and version history, never table data.
            print(r.stdout)
    except (OSError, subprocess.TimeoutExpired):
        print('BLOCK: catalog client unavailable or timed out')
    print('AUDIT ONLY: intentional exit 97; all deployment steps must remain skipped')
    return 97

if __name__ == '__main__':
    sys.exit(main())
