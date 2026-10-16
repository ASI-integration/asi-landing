import contextlib
import io
import json
import subprocess
import unittest
from unittest.mock import patch
import audit

class AuditRegression(unittest.TestCase):
    def setUp(self):
        # TLS has dedicated real trust/hostname tests; these cases isolate SQL guards.
        for name,value in [('tls_guard.bundle',contextlib.nullcontext('/tmp/test-trusted-roots.pem')),('tls_guard.diagnose',{'status':'PASS'})]:
            mocked=patch(name,return_value=value);mocked.start();self.addCleanup(mocked.stop)
    def env(self):
        return {'PATH':'/usr/bin','GITHUB_REF':'refs/heads/main','GITHUB_WORKFLOW_REF':audit.WORKFLOW,'STAGING_SUPABASE_PROJECT_REF':audit.PROJECT,'STAGING_DATABASE_URL':f'postgres://postgres:PRIVATE_PASSWORD@db.{audit.PROJECT}.supabase.co:5432/postgres','PGHOSTADDR':'evil','PGSERVICE':'evil'}
    def test_explicit_libpq_components(self):
        e=audit.connection_env(self.env(),self.env()['STAGING_DATABASE_URL'])
        self.assertEqual(e['PGDATABASE'],'postgres');self.assertEqual(e['PGHOST'],f'db.{audit.PROJECT}.supabase.co')
        self.assertEqual(e['PGPASSWORD'],'PRIVATE_PASSWORD');self.assertNotIn('PGHOSTADDR',e);self.assertNotIn('PGSERVICE',e)
        self.assertEqual(e['PGSSLMODE'],'verify-full')
    def test_sqlstate_without_sensitive_message(self):
        self.assertEqual(audit.error_code('ERROR:  42501: SECRET_TABLE PRIVATE_PASSWORD'),{'category':'PERMISSION','sqlstate':'42501'})
    def test_categories(self):
        for msg,cat in [('SSL error: certificate verify failed PRIVATE_PASSWORD','TLS'),('connection refused SECRET_HOST','CONNECTION'),('could not translate host name SECRET_HOST','DNS'),('ERROR:  42601: bad SECRET_SQL','SQL'),('timeout expired SECRET_HOST','TIMEOUT'),('password authentication failed SECRET_USER','AUTHENTICATION')]:
            with self.subTest(cat=cat): self.assertEqual(audit.error_code(msg)['category'],cat)
    def test_error_output_never_echoes_connection(self):
        r=subprocess.CompletedProcess([],2,'','SSL error: certificate verify failed PRIVATE_PASSWORD')
        output=io.StringIO()
        with patch.dict('os.environ',self.env(),clear=True),patch('subprocess.run',return_value=r),contextlib.redirect_stdout(output):
            self.assertEqual(audit.main(),97)
        self.assertNotIn('PRIVATE_PASSWORD',output.getvalue());self.assertIn('TLS',output.getvalue())
    def test_one_section_failure_does_not_abort_other_sections(self):
        good=subprocess.CompletedProcess([],0,json.dumps({'server_version':'17.6','read_only':'on'}),'')
        bad=subprocess.CompletedProcess([],3,'','ERROR:  42501: SECRET')
        other=subprocess.CompletedProcess([],0,'{}','')
        with patch.dict('os.environ',self.env(),clear=True),patch('subprocess.run',side_effect=[good,bad]+[other]*15) as run,contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(audit.main(),97);self.assertEqual(run.call_count,17)
    def test_probe_must_confirm_readonly(self):
        r=subprocess.CompletedProcess([],0,'{"server_version":"17.6","read_only":"off"}','')
        with patch.dict('os.environ',self.env(),clear=True),patch('subprocess.run',return_value=r) as run,contextlib.redirect_stdout(io.StringIO()):
            audit.main();self.assertEqual(run.call_count,1)
    def test_split_catalog_has_expected_sections(self):
        sections=audit.sections()
        self.assertEqual(len(sections),16);self.assertIn('role_membership',sections)
        for sql in sections.values():self.assertTrue(sql.startswith('SELECT jsonb_build_object('))
    def test_query_is_readonly_and_timeout_is_redacted(self):
        with patch('subprocess.run',side_effect=subprocess.TimeoutExpired('secret',50)) as run:
            self.assertEqual(audit.query({},'SELECT 1')['category'],'TIMEOUT')
            self.assertTrue(run.call_args.kwargs['input'].startswith('BEGIN READ ONLY;'))
    def test_no_server_error_detail_returned(self):
        r=subprocess.CompletedProcess([],3,'SECRET','ERROR:  42601: SECRET')
        with patch('subprocess.run',return_value=r):self.assertNotIn('SECRET',str(audit.query({},'SELECT 1')))

if __name__=='__main__':unittest.main()
