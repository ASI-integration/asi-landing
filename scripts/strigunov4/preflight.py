"""Offline admission assessment. Output is NOT authorization to mutate staging.
No network, subprocess, database writes or deployment side effects.
"""
import argparse
import json
import re
from urllib.parse import urlparse, unquote

PROJECT = 'meeravcldnmocjtlqoeu'
APP_SHA = '334d93fc39d2ea51ba283dd0314bbc239ff49707'
BASELINE = '5c91b27bcde395f01cc078d1fbe454dd7436e1c6'
PRESERVE = {'20260729040307', '20260729040309', '20260729040332',
            '20260913120838', '20260913120856', '20260913120921', '20260913120945'}
FLAGS = {'EMAIL_AUTO_SEND': 'false', 'EMAIL_DRAFT_ONLY': 'true',
         'DRY_RUN_TELEGRAM_OUTBOUND': 'true', 'ALLOW_REAL_TELEGRAM_SYNTHETIC': 'false',
         'YOOKASSA_ENABLED': 'false'}
REQUIRED = {'booking_inbound_intake_events': {'account_id', 'account_scope_key'},
            'booking_ops_communication_auto_send_scopes': {'account_id', 'account_scope_key'},
            'booking_ops_communication_auto_send_runs': {'account_id'},
            'booking_ops_communication_deliveries': {'account_id'},
            'booking_overbooking_conflict_checks': {'account_id'},
            'booking_ops_records': {'automation_paused'},
            'booking_ops_alerts': {'revision'},
            'tg_property_knowledge': {'check_in_instructions', 'key_instructions',
                'parking_instructions', 'check_out_instructions', 'emergency_contacts'}}

def target_valid(url):
    """Reject lookalikes and project mismatches; never return credentials."""
    try:
        if any(ord(c) < 33 or ord(c) == 127 for c in url):
            return False
        u = urlparse(url)
        if u.scheme not in ('postgres', 'postgresql') or u.fragment or u.query:
            return False
        host, user = u.hostname or '', unquote(u.username or '')
        direct = host == f'db.{PROJECT}.supabase.co' and user == 'postgres'
        pooler = bool(re.fullmatch(r'aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com', host)) and user == f'postgres.{PROJECT}'
        return bool((direct or pooler) and u.port in (None, 5432, 6543) and u.path == '/postgres')
    except ValueError:
        return False

def assess(e):
    blocked = []
    def need(ok, reason):
        if not ok:
            blocked.append(reason)
    need(e.get('project_ref') == PROJECT, 'wrong or missing staging identity')
    need(e.get('workflow_ref') == 'refs/heads/main', 'protected workflow must run from main')
    need(e.get('reviewer_approval') is True, 'required environment reviewer approval absent')
    b = e.get('backup', {})
    for key in ('cipher_sha256_verified', 'durable_private_copy', 'key_recoverable',
                'pg_restore_list_pass', 'full_restore_pass', 'roles_restored',
                'acl_verified', 'owners_verified', 'extensions_verified'):
        need(b.get(key) is True, 'backup: ' + key)
    need(b.get('project_ref') == PROJECT, 'backup target mismatch')
    need(b.get('postgres_major') == 17, 'restore must use PostgreSQL17')
    c = e.get('catalog', {})
    need(c.get('live') is True, 'live catalog required; snapshot is not live')
    need(c.get('read_only') == 'on', 'catalog transaction must be read-only')
    versions = {str(x.get('version')) for x in c.get('migration_history', [])}
    need(PRESERVE <= versions, 'staging-only hardening history incomplete')
    for key in ('constraints_reviewed', 'indexes_reviewed', 'rls_grants_reviewed',
                'functions_reviewed', 'data_backfills_reviewed', 'independent_sql_review'):
        need(e.get(key) is True, key)
    columns = {(x.get('table'), x.get('column')) for x in c.get('columns', [])}
    missing = sorted(f'{table}.{col}' for table, cols in REQUIRED.items() for col in cols if (table, col) not in columns)
    host = e.get('host', {})
    need(host.get('baseline_sha') == BASELINE, 'rollback baseline mismatch')
    need(host.get('service') == 'asi-landing-staging', 'wrong systemd service')
    need(host.get('user') == 'asi-runtime', 'runtime UID isolation mismatch')
    need(host.get('environment_file') == '/var/www/asi-staging/shared/.env.staging.local', 'environment file mismatch')
    need(host.get('listen') == '127.0.0.1:3001', 'staging loopback port mismatch')
    for k, v in FLAGS.items():
        need(host.get('effective_flags', {}).get(k) == v, 'unsafe effective flag: ' + k)
    need(host.get('rollback_rehearsed') is True, 'rollback rehearsal absent')
    return {'status': 'BLOCK' if blocked or missing else 'REVIEW_REQUIRED',
            'authorization': False, 'app_sha': APP_SHA, 'blockers': blocked,
            'missing_columns': missing,
            'notice': 'Evidence assertions are untrusted inputs, not an execution permit. No SQL or deployment executed.'}

def main():
    p = argparse.ArgumentParser()
    p.add_argument('evidence')
    args = p.parse_args()
    try:
        with open(args.evidence, encoding='utf-8') as f:
            result = assess(json.load(f))
    except (OSError, ValueError, TypeError, AttributeError):
        print('{"status":"BLOCK","authorization":false,"error":"invalid evidence"}')
        return 2
    print(json.dumps(result, indent=2))
    return 2 if result['status'] == 'BLOCK' else 0

if __name__ == '__main__':
    raise SystemExit(main())
