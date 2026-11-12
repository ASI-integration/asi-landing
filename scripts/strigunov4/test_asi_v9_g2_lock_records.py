"""File-local lock snapshots and durable no-replay claims, without services."""
import itertools
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import c4_operator_host as host
import c4_operator_observer as observer


class LockRecordTests(unittest.TestCase):
    def setUp(self):
        self.info = SimpleNamespace(st_dev=os.makedev(8, 1), st_ino=42)

    def record(self, *, inode=42, device='08:01', waiting=False, kind='FLOCK'):
        pid = -1 if kind == 'OFDLCK' else 123
        return f'1: {"-> " if waiting else ""}{kind} ADVISORY WRITE {pid} {device}:{inode} 0 EOF\n'.encode()

    def test_conflicting_orders_do_not_turn_waiters_into_holders(self):
        holder = self.record()
        waiter = self.record(waiting=True)
        other_class = self.record(kind='POSIX')
        for records, expected in (((holder, waiter, other_class), 'HELD'),
                                  ((waiter, other_class), 'UNKNOWN')):
            for order in itertools.permutations(records):
                with self.subTest(order=order):
                    self.assertEqual(observer.lock_records(b''.join(order), self.info), expected)

    def test_identity_requires_device_and_inode_with_accepted_control(self):
        self.assertEqual(observer.lock_records(self.record(), self.info), 'HELD')
        for raw in (self.record(inode=43), self.record(device='08:02'),
                    self.record(device='09:01'), b''):
            with self.subTest(raw=raw):
                self.assertEqual(observer.lock_records(raw, self.info),
                                 'VALID_METADATA_NO_HOLDER_OBSERVED')
        self.assertEqual(observer.lock_records(self.record(waiting=True), self.info), 'UNKNOWN')

    def test_malformed_record_invalidates_holder_in_either_order(self):
        for malformed in (b'2: FLOCK\n', self.record(inode=43).replace(b'123', b'0'),
                          self.record().replace(b'0 EOF', b'1 EOF')):
            for order in ((self.record(), malformed), (malformed, self.record())):
                with self.subTest(order=order):
                    self.assertEqual(observer.lock_records(b''.join(order), self.info), 'UNKNOWN')


class ClaimNoReplayTests(unittest.TestCase):
    def test_orphan_and_recorded_claims_block_every_run_binding(self):
        original = b''.join(f'{k}={v}\n'.encode() for k, v in host.SAFETY.items())
        for marker in (None, 'prepared.json', 'success.json', 'recovery.json'):
            with self.subTest(marker=marker), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                record = root / host.CLAIM
                record.mkdir(mode=0o700)
                if marker:
                    (record / marker).write_bytes(b'{}')
                before = {p.name: p.read_bytes() for p in record.iterdir()}
                with patch.object(host, 'EVIDENCE', root), \
                     patch.object(host, 'live') as live, \
                     patch.object(host.io, 'read_env', return_value=(original, object())), \
                     patch.object(host.io, 'atomic_env') as atomic, \
                     patch.object(host.io, 'write_private') as write, \
                     patch.object(host, 'sync_directory') as sync, \
                     patch.object(host, 'restart') as restart:
                    for run, sha in (('123', 'a' * 40), ('124', 'a' * 40),
                                     ('123', 'b' * 40), ('124', 'b' * 40)):
                        with self.subTest(run=run, sha=sha):
                            with self.assertRaisesRegex(host.Block, '^CLAIM_EXISTS$'):
                                host.perform(run, sha)
                    self.assertEqual(live.call_count, 8)
                    for forbidden in (atomic, write, sync, restart):
                        forbidden.assert_not_called()
                self.assertEqual({p.name: p.read_bytes() for p in record.iterdir()}, before)

    def test_fresh_claim_control_is_created_before_any_write(self):
        original = b''.join(f'{k}={v}\n'.encode() for k, v in host.SAFETY.items())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def stop_at_backup(path, raw):
                self.assertEqual(path, root / host.CLAIM / 'original.env.private')
                self.assertTrue(path.parent.is_dir())
                self.assertEqual(raw, original)
                raise OSError('synthetic interruption before apply')
            with patch.object(host, 'EVIDENCE', root), patch.object(host, 'live'), \
                 patch.object(host.io, 'read_env', return_value=(original, object())), \
                 patch.object(host, 'sync_directory') as sync, \
                 patch.object(host.io, 'write_private', side_effect=stop_at_backup) as write, \
                 patch.object(host.io, 'atomic_env') as atomic, \
                 patch.object(host, 'restart') as restart:
                with self.assertRaisesRegex(OSError, '^synthetic interruption before apply$'):
                    host.perform('123', 'a' * 40)
                write.assert_called_once()
                sync.assert_called_once_with(root)
                atomic.assert_not_called()
                restart.assert_not_called()
                with self.assertRaisesRegex(host.Block, '^CLAIM_EXISTS$'):
                    host.perform('124', 'b' * 40)
                self.assertEqual(write.call_count, 1)


if __name__ == '__main__':
    unittest.main()
