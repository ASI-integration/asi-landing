"""Offline S4-G2 fail-closed planner, no-op and marker schema regressions."""
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import c4_operator_host as host
import c4_operator_observer as observer
import c4_operator_patch as patcher
from test_asi_v9_g2_patch_invariants import canonical, synthetic_env


class PatchSafetyTests(unittest.TestCase):
    def test_unexpected_existing_operator_is_preserved_but_not_substituted_for_fixed_one(self):
        other = 'different-pilot@example.test'
        raw = synthetic_env(b''.join(canonical(key, other) for key in patcher.KEYS))
        result = patcher.plan(raw)
        self.assertEqual(result['output'], synthetic_env(b''.join(
            canonical(key, other, patcher.OPERATOR) for key in patcher.KEYS)))
        self.assertEqual(result['changedLists'], 2)
        for key in patcher.KEYS:
            self.assertEqual(result['before'][key], {other})
            self.assertEqual(result['after'][key], {other, patcher.OPERATOR})

    def test_invalid_operator_syntax_cannot_hide_in_either_list(self):
        for key in patcher.KEYS:
            for value in ('*', 'not-an-email', 'user@example.test $OTHER',
                          'user@example.test,#comment', 'user@example.test,*@example.test'):
                with self.subTest(key=key, value=value):
                    raw = synthetic_env(canonical(key, value))
                    with self.assertRaisesRegex(patcher.Block, '^ALLOWLIST_FORMAT$'):
                        patcher.plan(raw)

    def test_already_present_operator_does_not_bypass_safety_flags(self):
        configured = synthetic_env(b''.join(
            canonical(key, patcher.OPERATOR) for key in patcher.KEYS))
        self.assertFalse(patcher.plan(configured)['changed'])
        for key, value in patcher.SAFETY.items():
            line = f'{key}={value}\n'.encode()
            for invalid in (configured.replace(line, b''), configured.replace(
                    line, f'{key}=unsafe\n'.encode())):
                with self.subTest(key=key, raw=invalid):
                    with self.assertRaisesRegex(patcher.Block, '^FILE_NO_SEND$'):
                        patcher.plan(invalid)

    def test_host_noop_stops_before_claim_backup_write_or_restart(self):
        raw = synthetic_env(b''.join(
            canonical(key, patcher.OPERATOR) for key in patcher.KEYS))
        # Real perform() and plan(); isolate all live checks and mutation seams.
        with tempfile.TemporaryDirectory(prefix='g2-noop-') as directory:
            evidence = Path(directory)
            with patch.object(host, 'EVIDENCE', evidence), \
                    patch.object(host, 'live') as live, \
                    patch.object(host.io, 'read_env', return_value=(raw, None)) as read, \
                    patch.object(host.io, 'write_private') as backup, \
                    patch.object(host.io, 'atomic_env') as write, \
                    patch.object(host, 'restart') as restart, \
                    patch.object(host, 'journal') as journal, \
                    patch.object(host, 'sync_directory') as sync:
                with self.assertRaisesRegex(patcher.Block, '^ALREADY_CONFIGURED$'):
                    host.perform('123', 'a' * 40)
                read.assert_called_once_with()
                self.assertEqual(live.call_count, 2)
                self.assertIsNone(live.call_args_list[0].args[0])
                self.assertEqual(live.call_args_list[1].args[0], {
                    key: {patcher.OPERATOR} for key in patcher.KEYS})
                for mutation in (backup, write, restart, journal, sync):
                    mutation.assert_not_called()
            self.assertEqual(list(evidence.iterdir()), [])


class MarkerSchemaTests(unittest.TestCase):
    def marker(self, raw, kind):
        """Real disposable file and parser; simulate only root ownership metadata.

        Tests run unprivileged. Mode, size, link count and race timestamps remain
        actual fstat values, so the schema path is reached without host access.
        """
        real_fstat = os.fstat

        def root_owned(fd):
            info = real_fstat(fd)
            return SimpleNamespace(**{
                name: 0 if name == 'st_uid' else getattr(info, name)
                for name in ('st_mode', 'st_uid', 'st_nlink', 'st_size',
                             'st_mtime_ns', 'st_ctime_ns')
            })

        with tempfile.TemporaryDirectory(prefix='g2-marker-') as directory:
            path = Path(directory) / 'synthetic.json'
            path.write_bytes(raw)
            path.chmod(0o600)
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                with patch.object(observer.os, 'fstat', side_effect=root_owned):
                    result = observer.marker(fd, path.name, kind)
                self.assertEqual(path.read_bytes(), raw)
                self.assertEqual(sorted(p.name for p in Path(directory).iterdir()),
                                 ['synthetic.json'])
                return result
            finally:
                os.close(fd)

    def prepared(self, **changes):
        return dict(runId=observer.FAILED_RUN, sourceSha=observer.FAILED_SHA,
                    status='PREPARED', changedLists=2) | changes

    def test_prepared_schema_accepts_only_one_or_two_changed_lists(self):
        for count in (1, 2):
            with self.subTest(count=count):
                raw = json.dumps(self.prepared(changedLists=count)).encode()
                self.assertEqual(self.marker(raw, 'prepared'), 'BOUND_TO_FAILED_RUN')
        for count in (0, 3, -1, True, False, 1.0, '2', None):
            with self.subTest(count=count):
                raw = json.dumps(self.prepared(changedLists=count)).encode()
                self.assertEqual(self.marker(raw, 'prepared'), 'INVALID')

    def test_prepared_binding_and_exact_key_schema(self):
        valid_other = self.prepared(runId='123', sourceSha='a' * 40)
        self.assertEqual(self.marker(json.dumps(valid_other).encode(), 'prepared'),
                         'OTHER_BINDING')
        base = self.prepared()
        invalid = [dict(base, extra='unexpected'), self.prepared(runId=123),
                   self.prepared(runId='0123'), self.prepared(sourceSha='A' * 40),
                   self.prepared(status='SUCCESS')]
        invalid.extend({key: value for key, value in base.items() if key != removed}
                       for removed in base)
        for data in invalid:
            with self.subTest(data=data):
                self.assertEqual(self.marker(json.dumps(data).encode(), 'prepared'),
                                 'INVALID')

    def test_duplicate_marker_keys_rejected_even_when_values_agree(self):
        cases = (
            ('prepared', self.prepared(), 'changedLists', 2),
            ('success', host.SUCCESS, 'effectiveLists', 2),
            ('recovery', {'status': 'ROLLBACK_PASS'}, 'status', 'ROLLBACK_PASS'),
        )
        for kind, data, key, value in cases:
            with self.subTest(kind=kind):
                valid = json.dumps(data).encode()
                self.assertNotEqual(self.marker(valid, kind), 'INVALID')
                # Insert a duplicate in the serialized bytes, not a Python dict.
                duplicate = (json.dumps(data)[:-1] + ',' + json.dumps(key)
                             + ':' + json.dumps(value) + '}').encode()
                self.assertEqual(self.marker(duplicate, kind), 'INVALID')
                with self.assertRaisesRegex(ValueError, '^DUPLICATE_JSON_KEY$'):
                    observer.strict_json(duplicate)

    def test_success_schema_rejects_extra_fields_and_bool_integer_aliases(self):
        self.assertEqual(self.marker(json.dumps(host.SUCCESS).encode(), 'success'),
                         'RECORDED_SUCCESS')
        invalid = [dict(host.SUCCESS, extra='unexpected'),
                   dict(host.SUCCESS, effectiveLists=2.0),
                   dict(host.SUCCESS, effectiveFlags=True),
                   dict(host.SUCCESS, releaseSwitched=0),
                   dict(host.SUCCESS, databaseClientInvoked=0)]
        invalid.extend({key: value for key, value in host.SUCCESS.items() if key != removed}
                       for removed in host.SUCCESS)
        for data in invalid:
            with self.subTest(data=data):
                self.assertEqual(self.marker(json.dumps(data).encode(), 'success'),
                                 'INVALID')

    def test_recovery_schema_does_not_accept_success_or_extra_fields(self):
        for status, state in (('ROLLBACK_PASS', 'RECORDED_ROLLBACK'),
                              ('BLOCK_BEFORE_APPLY', 'RECORDED_BEFORE_APPLY')):
            raw = json.dumps({'status': status}).encode()
            self.assertEqual(self.marker(raw, 'recovery'), state)
            extra = json.dumps({'status': status, 'changedLists': 0}).encode()
            self.assertEqual(self.marker(extra, 'recovery'), 'INVALID')
        self.assertEqual(self.marker(json.dumps(host.SUCCESS).encode(), 'recovery'),
                         'INVALID')


if __name__ == '__main__':
    unittest.main()
