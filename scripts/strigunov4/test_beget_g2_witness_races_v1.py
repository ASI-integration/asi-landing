"""Offline races through production entry points; no host/service operations."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import beget_g2_operator_witness as witness
import c4_operator_host as host
from c4_operator_patch import Block, SAFETY


class WitnessRaces(unittest.TestCase):
    def observe(self, change=None):
        policy = dict(release='b'*40, unitHash='c'*64, pid=42,
                      invocation='a'*32, crm='operator@example.invalid',
                      ops='operator@example.invalid')
        identity = dict(host=witness.HOST, unit=witness.UNIT,
                        **{k: policy[k] for k in ('release', 'unitHash', 'pid', 'invocation')})
        env = dict(witness.FLAGS, CRM_OPERATOR_EMAILS=policy['crm'],
                   OPS_ADMIN_EMAILS=policy['ops'])
        raw = b''.join((k+'='+v).encode()+b'\0' for k, v in env.items())
        after = identity | (change or {})
        with ExitStack() as stack:
            for target, name, value in (
                (witness.sys, 'argv', ['witness']),
                (witness.os, 'geteuid', lambda: 0),
                (witness.os, 'uname', lambda: SimpleNamespace(nodename=witness.HOST)),
            ):
                stack.enter_context(patch.object(target, name, value))
            stack.enter_context(patch.dict(witness.os.environ, {}, clear=True))
            stack.enter_context(patch.object(witness, 'trusted_file', return_value=json.dumps(policy)))
            stack.enter_context(patch.object(witness, 'snapshot', side_effect=[identity, after]))
            stack.enter_context(patch.object(witness.os, 'open', return_value=90))
            close = stack.enter_context(patch.object(witness.os, 'close'))
            stack.enter_context(patch.object(witness.os, 'read', return_value=raw))
            stack.enter_context(patch.object(witness.os, 'pread', return_value=raw))
            try:
                return witness.observe()
            finally:
                close.assert_called_once_with(90)

    def test_complete_observation_redacts_members(self):
        result = self.observe()
        self.assertEqual(result['status'], 'OPERATOR_FLAGS_OBSERVED')
        self.assertNotIn('@', json.dumps(result))

    def test_identity_changes_reject_early_receipt(self):
        for change in ({'pid': 43}, {'invocation': 'd'*32}, {'release': 'e'*40}):
            with self.subTest(change=change), self.assertRaisesRegex(witness.Block, '^IDENTITY_OR_RACE$'):
                self.observe(change)


class ReservationRecovery(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.original = ('CRM_OPERATOR_EMAILS=old@example.invalid\n' +
                         ''.join(k+'='+v+'\n' for k, v in SAFETY.items())).encode()
        self.current = self.original
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(host, 'EVIDENCE', self.root))
        self.live = self.stack.enter_context(patch.object(host, 'live'))
        self.restart = self.stack.enter_context(patch.object(host, 'restart'))
        self.stack.enter_context(patch.object(host.io, 'read_env', side_effect=lambda: (self.current, None)))
        self.apply = self.stack.enter_context(patch.object(host.io, 'atomic_env', side_effect=self.replace))

    def replace(self, proposed, metadata, expected):
        self.assertEqual(self.current, expected)
        self.current = proposed

    def perform(self, run='123'):
        return host.perform(run, 'a'*40)

    def test_concurrent_duplicate_reservations_have_one_winner(self):
        # Both calls pass preflight on the same original generation before mkdir.
        barrier = threading.Barrier(2, timeout=5)
        local = threading.local()
        def live(expected, deadline):
            if expected is not None and not getattr(local, "reserved", False):
                local.reserved = True
                barrier.wait()
        self.live.side_effect = live
        def attempt(run):
            try:
                return self.perform(run)
            except Block as error:
                return str(error)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(attempt, ('123', '124')))
        self.assertCountEqual(results, [host.SUCCESS, 'CLAIM_EXISTS'])
        self.assertEqual(self.apply.call_count, 1)
        self.restart.assert_called_once()
        record = self.root / host.CLAIM
        self.assertEqual((record / 'original.env.private').read_bytes(), self.original)
        self.assertEqual(json.loads((record / 'success.json').read_bytes()), host.SUCCESS)

    def test_success_not_written_before_restart_finishes(self):
        def interrupt(*args):
            self.assertFalse((self.root / host.CLAIM / 'success.json').exists())
            raise KeyboardInterrupt()
        self.restart.side_effect = interrupt
        self.assertEqual(self.perform(), {'status': 'BLOCK_MANUAL_RECOVERY_REQUIRED'})
        self.assertEqual(self.current, self.original)
        self.assertFalse((self.root / host.CLAIM / 'success.json').exists())
        self.assertFalse((self.root / host.CLAIM / 'recovery.json').exists())
        calls = self.apply.call_count
        with self.assertRaisesRegex(Block, '^CLAIM_EXISTS$'):
            self.perform('125')
        self.assertEqual(self.apply.call_count, calls)

    def test_interruption_rolls_back_and_records_recovery(self):
        self.restart.side_effect = [KeyboardInterrupt(), None]
        self.assertEqual(self.perform(), {'status': 'ROLLBACK_PASS'})
        self.assertEqual(self.current, self.original)
        record = self.root / host.CLAIM
        self.assertEqual(json.loads((record / 'recovery.json').read_bytes()), {'status': 'ROLLBACK_PASS'})
        self.assertFalse((record / 'success.json').exists())


if __name__ == '__main__':
    unittest.main()
