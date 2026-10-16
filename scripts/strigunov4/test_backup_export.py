"""Offline admission regression only; no staging database or SSH access."""
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import backup_export as b

class AdmissionTests(unittest.TestCase):
    def good(self):
        return {
            "GITHUB_REPOSITORY": "ASI-integration/asi-landing",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_WORKFLOW_REF": b.WORKFLOW,
            "STAGING_SUPABASE_PROJECT_REF": b.PROJECT,
            "STAGING_DATABASE_URL": "postgresql://postgres.meeravcldnmocjtlqoeu:synthetic-only@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
            "STAGING_APP_PATH": "/var/www/asi-staging",
            "STAGING_PORT": "3001",
            "STAGING_SSH_HOST": "example.org",
            "STAGING_SSH_USER": "tester",
            "STAGING_SSH_PRIVATE_KEY": "synthetic-value",
            "STAGING_SSH_PORT": "22",
        }

    def test_main_only(self):
        e=self.good()
        e["GITHUB_REF"]="refs/heads/feature"
        with self.assertRaises(b.GateError): b.guard(e)

    def test_wrong_project(self):
        e=self.good()
        e["STAGING_SUPABASE_PROJECT_REF"]="jwinifeienvzejofmbua"
        with self.assertRaises(b.GateError): b.guard(e)

    def test_wrong_database(self):
        e=self.good()
        e["STAGING_DATABASE_URL"]=e["STAGING_DATABASE_URL"].replace(b.PROJECT,"jwinifeienvzejofmbua")
        with self.assertRaises(b.GateError): b.guard(e)

    def test_no_production_app_path(self):
        e=self.good()
        e["STAGING_APP_PATH"]="/var/www/asi"
        with self.assertRaises(b.GateError): b.guard(e)

    def test_shell_metacharacters_rejected(self):
        e=self.good()
        e["STAGING_SSH_HOST"]="example.org;rm -rf /"
        with self.assertRaises(b.GateError): b.guard(e)

    def test_missing_ssh_key(self):
        e=self.good()
        e.pop("STAGING_SSH_PRIVATE_KEY")
        with self.assertRaises(b.GateError): b.guard(e)

    def test_ssh_option_host_rejected(self):
        e = self.good()
        e['STAGING_SSH_HOST'] = '-example.org'
        with self.assertRaises(b.GateError): b.guard(e)

    def test_remote_setup_shell_guards(self):
        name = 'strigunov4-staging-123-1.tar.gz.cms'
        for case in ('fresh', 'directory_link', 'file_link', 'part_link', 'existing_part'):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as td:
                home = Path(td)
                outside = home / 'unrelated'
                outside.mkdir(mode=0o755)
                folder = home / '.strigunov4-staging-backups'
                if case == 'directory_link':
                    folder.symlink_to(outside, target_is_directory=True)
                else:
                    folder.mkdir()
                    if case in ('file_link', 'part_link'):
                        target = folder / (name if case == 'file_link' else '.' + name + '.part')
                        target.symlink_to(home / 'absent')
                    elif case == 'existing_part':
                        (folder / ('.' + name + '.part')).write_text('keep')
                result = subprocess.run(['sh', '-c', b.remote_setup_command(name)],
                                        env={'PATH': os.environ['PATH'], 'HOME': td},
                                        capture_output=True)
                self.assertEqual(result.returncode == 0, case == 'fresh')
                self.assertEqual(outside.stat().st_mode & 0o777, 0o755)
                if case == 'fresh':
                    self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
                if case == 'existing_part':
                    self.assertEqual((folder / ('.' + name + '.part')).read_text(), 'keep')

    def test_valid_target(self):
        url, host, user, port=b.guard(self.good())
        self.assertEqual((host,user,port),("example.org","tester",22))
        self.assertIn(b.PROJECT,url)

    def test_forbid_libpq_override(self):
        e=self.good()
        with patch.dict(os.environ, {"PGHOSTADDR":"127.0.0.1","PGSERVICE":"hostile","PGSERVICEFILE":"hostile","STAGING_SSH_PRIVATE_KEY":"synthetic-ssh-secret"}):
            env=b.build_pg_env(e,e["STAGING_DATABASE_URL"],Path("roots.pem"))
        self.assertEqual(env["PGSSLMODE"],"verify-full")
        self.assertEqual(env["PGDATABASE"],"postgres")
        self.assertNotIn("PGHOSTADDR",env)
        self.assertNotIn("PGSERVICE",env)
        self.assertNotIn("PGSERVICEFILE",env)
        self.assertNotIn("STAGING_SSH_PRIVATE_KEY",env)

    def test_checked_timeout_and_safe_error(self):
        with patch.object(b.subprocess, 'run') as run:
            run.return_value.returncode = 0
            run.return_value.stdout = 'ok'
            self.assertEqual(b.checked(['synthetic'], timeout=900), 'ok')
            self.assertEqual(run.call_args.kwargs['timeout'], 900)
            b.checked(['synthetic'])
            self.assertEqual(run.call_args.kwargs['timeout'], 240)
            run.side_effect = subprocess.TimeoutExpired('synthetic-secret', 900)
            with self.assertRaisesRegex(b.GateError, '^EXPORT_UNAVAILABLE$'):
                b.checked(['synthetic'], category='EXPORT', timeout=900)

    def test_image_pinned_and_role_acl_kept(self):
        self.assertIn("sha256:",b.PG_IMAGE)
        source=Path(__file__).with_name("backup_export.py").read_text()
        self.assertIn("pg_dumpall --globals-only --no-role-passwords",source)
        self.assertIn("ROLE_PASSWORDS=NOT_EXPORTED_RESTORE_REQUIRES_SEPARATE_CREDENTIALS",source)
        self.assertNotIn("--no-owner",source)
        self.assertNotIn("--no-acl",source)

if __name__=="__main__":
    unittest.main()

