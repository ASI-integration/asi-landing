import contextlib
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import preflight as p
import audit

class SafetyTests(unittest.TestCase):
    def setUp(self):
        # TLS has dedicated real trust/hostname tests; these cases isolate SQL guards.
        for name,value in [('tls_guard.bundle',contextlib.nullcontext('/tmp/test-trusted-roots.pem')),('tls_guard.diagnose',{'status':'PASS'})]:
            mocked=patch(name,return_value=value);mocked.start();self.addCleanup(mocked.stop)
    def fixture(self):
        return {'project_ref': p.PROJECT, 'workflow_ref': 'refs/heads/main',
                'reviewer_approval': True,
                'backup': dict.fromkeys(('cipher_sha256_verified','durable_private_copy','key_recoverable','pg_restore_list_pass','full_restore_pass','roles_restored','acl_verified','owners_verified','extensions_verified'), True) | {'project_ref':p.PROJECT,'postgres_major':17},
                'catalog': {'live':True,'read_only':'on','migration_history':[{'version':x} for x in p.PRESERVE], 'columns':[{'table':t,'column':c} for t,cs in p.REQUIRED.items() for c in cs]},
                **dict.fromkeys(('constraints_reviewed','indexes_reviewed','rls_grants_reviewed','functions_reviewed','data_backfills_reviewed','independent_sql_review'),True),
                'host':{'baseline_sha':p.BASELINE,'service':'asi-landing-staging','user':'asi-runtime','environment_file':'/var/www/asi-staging/shared/.env.staging.local','listen':'127.0.0.1:3001','effective_flags':p.FLAGS.copy(),'rollback_rehearsed':True}}
    def test_empty_blocks(self):
        self.assertEqual(p.assess({})['status'],'BLOCK')
    def test_even_complete_evidence_is_not_authority(self):
        r=p.assess(self.fixture()); self.assertEqual(r['status'],'REVIEW_REQUIRED'); self.assertFalse(r['authorization'])
    def test_backup_each_gate_fails_closed(self):
        for k in self.fixture()['backup']:
            e=self.fixture(); del e['backup'][k]
            with self.subTest(k=k): self.assertEqual(p.assess(e)['status'],'BLOCK')
    def test_partial_restore_not_accepted(self):
        e=self.fixture(); e['backup']['full_restore_pass']=False
        self.assertIn('backup: full_restore_pass',p.assess(e)['blockers'])
    def test_missing_acl_not_accepted(self):
        e=self.fixture(); e['backup']['acl_verified']=False
        self.assertIn('backup: acl_verified',p.assess(e)['blockers'])
    def test_snapshot_cannot_stand_for_live_catalog(self):
        e=self.fixture(); e['catalog']['live']=False
        self.assertEqual(p.assess(e)['status'],'BLOCK')
    def test_preserve_each_remote_only_history(self):
        for v in p.PRESERVE:
            e=self.fixture(); e['catalog']['migration_history']=[{'version':x} for x in p.PRESERVE-{v}]
            with self.subTest(v=v): self.assertEqual(p.assess(e)['status'],'BLOCK')
    def test_missing_g0_dependency_reported(self):
        e=self.fixture(); e['catalog']['columns']=[]
        self.assertIn('booking_inbound_intake_events.account_id',p.assess(e)['missing_columns'])
    def test_flags_exact_not_truthy(self):
        for k in p.FLAGS:
            e=self.fixture(); e['host']['effective_flags'][k]='TRUE'
            with self.subTest(k=k): self.assertEqual(p.assess(e)['status'],'BLOCK')
    def test_main_only_and_reviewer(self):
        for k,v in [('workflow_ref','refs/heads/feature'),('reviewer_approval',False)]:
            e=self.fixture(); e[k]=v
            self.assertEqual(p.assess(e)['status'],'BLOCK')
    def test_direct_and_pooler_targets(self):
        self.assertTrue(p.target_valid(f'postgresql://postgres:secret@db.{p.PROJECT}.supabase.co:5432/postgres'))
        self.assertTrue(p.target_valid(f'postgres://postgres.{p.PROJECT}:secret@aws-1-eu-west-1.pooler.supabase.com:6543/postgres'))
    def test_target_lookalikes_rejected(self):
        for url in [f'postgres://postgres@db.{p.PROJECT}.supabase.co.evil/postgres', 'postgres://postgres.other@aws-1-eu-west-1.pooler.supabase.com/postgres', f'postgres://postgres@db.{p.PROJECT}.supabase.co/production', f'postgres://postgres@db.{p.PROJECT}.supabase.co:bad/postgres', f'postgres://postgres@db.{p.PROJECT}.supabase.co/postgres?host=other', f'postgres://postgres@db.{p.PROJECT}.supabase.co/postgres?sslmode=disable']:
            with self.subTest(url=url): self.assertFalse(p.target_valid(url))
    def test_bad_environment_never_starts_client(self):
        with patch.dict('os.environ',{},clear=True),patch('subprocess.run') as run:
            self.assertEqual(audit.main(),97); run.assert_not_called()
    def test_success_audit_still_stops_deployment(self):
        env={'GITHUB_REF':'refs/heads/main','GITHUB_WORKFLOW_REF':'ASI-integration/asi-landing/.github/workflows/deploy-staging.yml@refs/heads/main','STAGING_SUPABASE_PROJECT_REF':p.PROJECT,'STAGING_DATABASE_URL':f'postgres://postgres:secret@db.{p.PROJECT}.supabase.co/postgres','PGHOSTADDR':'192.0.2.1','PGSERVICE':'other','PGSERVICEFILE':'/tmp/other','PGUSER':'other'}
        with patch.dict('os.environ',env,clear=True),patch('subprocess.run') as run:
            run.return_value.returncode=0; run.return_value.stdout='{}'
            self.assertEqual(audit.main(),97)
            self.assertNotIn('secret',' '.join(run.call_args.args[0]))
            for key in ('PGHOSTADDR','PGSERVICE','PGSERVICEFILE'):
                self.assertNotIn(key,run.call_args.kwargs['env'])
            self.assertEqual(run.call_args.kwargs['env']['PGUSER'],'postgres')
            self.assertEqual(run.call_args.kwargs['env']['PGDATABASE'],'postgres')
            self.assertIn('default_transaction_read_only=on',run.call_args.kwargs['env']['PGOPTIONS'])
            self.assertEqual(run.call_args.kwargs['env']['PGSSLMODE'],'verify-full')
    def test_audit_errors_suppressed_and_fail_closed(self):
        env={'GITHUB_REF':'refs/heads/main','GITHUB_WORKFLOW_REF':'ASI-integration/asi-landing/.github/workflows/deploy-staging.yml@refs/heads/main','STAGING_SUPABASE_PROJECT_REF':p.PROJECT,'STAGING_DATABASE_URL':f'postgres://postgres@db.{p.PROJECT}.supabase.co/postgres'}
        with patch.dict('os.environ',env,clear=True),patch('subprocess.run',side_effect=OSError('sensitive')):
            self.assertEqual(audit.main(),97)

if __name__=='__main__': unittest.main()
