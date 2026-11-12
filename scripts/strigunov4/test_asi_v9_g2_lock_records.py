"""Deterministic lock-record and stale snapshot rejection, entirely synthetic."""
import io
import os
import stat
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import c4_operator_observer as observer


def metadata(**changes):
    return SimpleNamespace(**(dict(st_dev=os.makedev(8, 1), st_ino=42,
        st_mode=stat.S_IFREG | 0o600, st_uid=0, st_gid=0, st_nlink=1,
        st_size=0, st_mtime_ns=100, st_ctime_ns=100) | changes))


class LockRecords(unittest.TestCase):
    def test_holder_waiter_and_other_inode(self):
        cases = [
            (b'', 'VALID_METADATA_NO_HOLDER_OBSERVED'),
            (b'1: FLOCK ADVISORY WRITE 123 08:01:42 0 EOF\n', 'HELD'),
            (b'1: -> FLOCK ADVISORY WRITE 123 08:01:42 0 EOF\n', 'UNKNOWN'),
            (b'1: FLOCK ADVISORY WRITE 123 08:01:43 0 EOF\n', 'VALID_METADATA_NO_HOLDER_OBSERVED'),
            (b'1: POSIX ADVISORY WRITE 123 08:01:42 0 9\n', 'UNKNOWN'),
            (b'1: OFDLCK ADVISORY WRITE -1 08:01:42 0 EOF\n', 'UNKNOWN'),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                self.assertEqual(observer.lock_records(raw, metadata()), expected)

    def test_malformed_records_never_prove_no_holder(self):
        valid = b'1: FLOCK ADVISORY WRITE 123 08:01:42 0 EOF\n'
        for raw in (valid[:-1], valid.replace(b'123', b'0'),
                    valid.replace(b'0 EOF', b'9 2'),
                    valid.replace(b'ADVISORY', b'ACTIVE'),
                    valid.replace(b'08:01:42', b'08:01:x'),
                    valid + b'bad unrelated record\n', b'x'*(observer.LOCKS_LIMIT+1)):
            with self.subTest(raw=raw[:80]):
                self.assertEqual(observer.lock_records(raw, metadata()), 'UNKNOWN')

    def snapshot(self, before, after=None, named=None):
        with patch.object(observer.os, 'open', return_value=90) as opened, \
             patch.object(observer.os, 'close') as closed, \
             patch.object(observer.os, 'fstat', side_effect=[before, after or before]), \
             patch.object(observer.os, 'stat', return_value=named or before), \
             patch('builtins.open', return_value=io.BytesIO(b'')) as proc:
            result = observer.lock_snapshot(80)
            opened.assert_called_once_with('active.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=80)
            closed.assert_called_once_with(90)
            if result == 'INVALID':
                proc.assert_not_called()
            return result

    def test_invalid_identity_rejected_before_proc_read(self):
        for change in ({'st_uid': 1000}, {'st_nlink': 2},
                       {'st_mode': stat.S_IFREG | 0o644},
                       {'st_mode': stat.S_IFDIR | 0o600}):
            with self.subTest(change=change):
                self.assertEqual(self.snapshot(metadata(**change)), 'INVALID')

    def test_stale_timestamps_or_replaced_path_invalidate_witness(self):
        self.assertEqual(self.snapshot(metadata()), 'VALID_METADATA_NO_HOLDER_OBSERVED')
        for field in ('st_mtime_ns', 'st_ctime_ns', 'st_ino', 'st_dev', 'st_size'):
            changed = metadata(**{field: getattr(metadata(), field)+1})
            with self.subTest(field=field, stage='descriptor'):
                self.assertEqual(self.snapshot(metadata(), after=changed), 'UNKNOWN')
            with self.subTest(field=field, stage='pathname'):
                self.assertEqual(self.snapshot(metadata(), named=changed), 'UNKNOWN')

    def test_marker_timestamp_race_rejects_exact_success(self):
        import json
        raw = json.dumps(observer.host.SUCCESS).encode()
        before = metadata(st_size=len(raw))
        for field in ('st_mtime_ns', 'st_ctime_ns'):
            with self.subTest(field=field), \
                 patch.object(observer.os, 'open', return_value=90), \
                 patch.object(observer.os, 'close') as close, \
                 patch.object(observer.os, 'read', return_value=raw), \
                 patch.object(observer.os, 'fstat', side_effect=[before, metadata(st_size=len(raw), **{field: 99})]):
                self.assertEqual(observer.marker(80, 'success.json', 'success'), 'INVALID')
                close.assert_called_once_with(90)


if __name__ == '__main__':
    unittest.main()
