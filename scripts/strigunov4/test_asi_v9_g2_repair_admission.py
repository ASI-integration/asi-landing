"""Offline synthetic admission and recovery regressions; never invoke SSH."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import protected_c4_operator_repair as admission
import c4_operator_host as host


class AdmissionTests(unittest.TestCase):
    def environment(self):
        sha = 'a' * 40
        return dict(GITHUB_ACTIONS='true', GITHUB_REPOSITORY=admission.REPO,
                    GITHUB_REF='refs/heads/main', GITHUB_EVENT_NAME='workflow_dispatch',
                    GITHUB_WORKFLOW_REF=admission.WORKFLOW,
                    GITHUB_ACTOR=admission.OWNER, GITHUB_TRIGGERING_ACTOR=admission.OWNER,
                    GITHUB_ACTOR_ID=admission.OWNER_ID, GITHUB_RUN_ATTEMPT='1',
                    STAGING_SSH_USER='project_ayfaar', GITHUB_SHA=sha,
                    GITHUB_WORKFLOW_SHA=sha, STAGING_REVIEWED_MAIN_SHA=sha,
                    C4_OPERATOR_CONFIRM='CONFIGURE_C4_OPERATOR_' + sha,
                    C4_OPERATOR_INCIDENT='39140030546', GITHUB_RUN_ID='123',
                    STAGING_SSH_HOST='synthetic.invalid', STAGING_SSH_PORT='22',
                    STAGING_SSH_PRIVATE_KEY='synthetic-placeholder-' * 8)

    def test_explicit_approval_permitted(self):
        self.assertEqual(admission.validate(self.environment()),
                         ('a' * 40, '123', 'synthetic.invalid', 22))

    def test_missing_or_stale_approval_denied_before_transport(self):
        for key, value in [('C4_OPERATOR_CONFIRM', None),
                           ('C4_OPERATOR_CONFIRM', 'CONFIGURE_C4_OPERATOR_' + 'b' * 40),
                           ('STAGING_REVIEWED_MAIN_SHA', None),
                           ('GITHUB_RUN_ATTEMPT', '2')]:
            with self.subTest(key=key, value=value):
                env = self.environment()
                env[key] = value
                with patch.object(admission, 'checked') as transport:
                    with self.assertRaises(admission.Block):
                        admission.execute(env)
                    transport.assert_not_called()

    def test_payload_fixed_regular_sources_permitted(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / 'scripts/strigunov4'
            directory.mkdir(parents=True)
            for name in ('staging_no_send_patch', 'staging_no_send_host',
                         'c4_operator_patch', 'c4_operator_host'):
                (directory / (name + '.py')).write_text('SYNTHETIC = True\n')
            self.assertIn(b'SYNTHETIC = True', admission.payload(Path(tmp)))

    def test_untrusted_source_paths_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            directory = root / 'scripts/strigunov4'
            directory.mkdir(parents=True)
            target = root / 'outside.py'
            target.write_text('raise AssertionError("must never execute")\n')
            module = directory / 'c4_operator_host.py'
            module.symlink_to(target)
            alias = root / 'alias'
            alias.symlink_to(root, target_is_directory=True)
            for source_root, name in [(root, '../outside'), (root, 'c4_operator_host'),
                                      (alias, 'c4_operator_host'),
                                      (root / '..' / root.name, 'c4_operator_host'),
                                      (Path('relative'), 'c4_operator_host')]:
                with self.subTest(root=source_root, name=name):
                    with self.assertRaises((admission.Block, OSError)):
                        admission.source_bytes(source_root, name)

    def test_receipts_require_unambiguous_typed_claims(self):
        success = json.dumps(host.SUCCESS).encode()
        self.assertEqual(admission.decode_remote_result(success, 0), host.SUCCESS)
        malformed = [b'{"status":"ROLLBACK_PASS","status":"BLOCK"}',
                     b'{"status":"ROLLBACK_PASS","restored":false}',
                     b'{"status":"C4_OPERATOR_CONFIG_PASS"}', success, b'not json']
        for raw in malformed:
            with self.subTest(raw=raw):
                with self.assertRaises(admission.RemoteOutcome) as caught:
                    admission.decode_remote_result(raw, 2)
                self.assertEqual(caught.exception.status, 'BLOCK_MANUAL_RECOVERY_REQUIRED')
        forged = dict(host.SUCCESS, releaseSwitched=0)
        with self.assertRaises(admission.RemoteOutcome):
            admission.decode_remote_result(json.dumps(forged).encode(), 0)
        for status in ('ROLLBACK_PASS', 'BLOCK_BEFORE_APPLY',
                       'BLOCK_MANUAL_RECOVERY_REQUIRED', 'BLOCK_REASON_CLAIM_EXISTS'):
            with self.assertRaises(admission.RemoteOutcome) as caught:
                admission.decode_remote_result(json.dumps({'status': status}).encode(), 2)
            self.assertEqual(caught.exception.status, status)


class ClaimRecoveryTests(unittest.TestCase):
    def test_verified_restore_reports_rollback_and_retains_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(host, 'EVIDENCE', Path(tmp)), \
                 patch.object(host, 'live'), patch.object(host, 'sync_directory'), \
                 patch.object(host, 'journal'), patch.object(host.io, 'write_private'), \
                 patch.object(host, 'restart') as restart, \
                 patch.object(host.io, 'read_env', side_effect=[
                     (b'old', {}), (b'new', {}), (b'old', {})]), \
                 patch.object(host, 'plan', return_value={
                     'before': {}, 'after': {}, 'changed': True,
                     'changedLists': 1, 'output': b'new'}), \
                 patch.object(host.io, 'atomic_env', side_effect=[
                     OSError('synthetic interrupted apply'), None]) as apply:
                self.assertEqual(host.perform('123', 'a' * 40),
                                 {'status': 'ROLLBACK_PASS'})
                self.assertEqual(apply.call_args.args, (b'old', {}, b'new'))
                restart.assert_called_once()
                self.assertTrue((Path(tmp) / host.CLAIM).is_dir())

    def test_existing_incident_claim_denies_replay(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / host.CLAIM).mkdir()
            with patch.object(host, 'EVIDENCE', Path(tmp)), \
                 patch.object(host, 'live'), \
                 patch.object(host.io, 'read_env', return_value=(b'old', {})), \
                 patch.object(host, 'plan', return_value={'before': {}, 'changed': True}), \
                 patch.object(host.io, 'atomic_env') as apply:
                for run, sha in [('123', 'a' * 40), ('456', 'b' * 40)]:
                    with self.assertRaises(host.Block) as caught:
                        host.perform(run, sha)
                    self.assertEqual(str(caught.exception), 'CLAIM_EXISTS')
                apply.assert_not_called()

    def test_failed_restore_requires_manual_recovery_and_retains_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(host, 'EVIDENCE', Path(tmp)), \
                 patch.object(host, 'live'), patch.object(host, 'sync_directory'), \
                 patch.object(host, 'journal'), patch.object(host.io, 'write_private'), \
                 patch.object(host.io, 'read_env', side_effect=[(b'old', {}), (b'new', {})]), \
                 patch.object(host, 'plan', return_value={
                     'before': {}, 'after': {}, 'changed': True,
                     'changedLists': 1, 'output': b'new'}), \
                 patch.object(host.io, 'atomic_env', side_effect=OSError('synthetic')) as apply:
                self.assertEqual(host.perform('123', 'a' * 40),
                                 {'status': 'BLOCK_MANUAL_RECOVERY_REQUIRED'})
                self.assertEqual(apply.call_count, 2)
                self.assertTrue((Path(tmp) / host.CLAIM).is_dir())


if __name__ == '__main__':
    unittest.main()
