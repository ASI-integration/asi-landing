"""Mocked lock identity races; never inspect host files or acquire a lock."""
import errno
import fcntl
import os
import stat
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import call, mock_open, patch

import c4_operator_observer as observer


class LockPathIdentityTests(unittest.TestCase):
    ROOT = 73
    CHILD = 91
    HOLDER = b"1: FLOCK ADVISORY WRITE 123 08:01:42 0 EOF\n"
    CHANGES = {
        "st_dev": os.makedev(8, 2),
        "st_ino": 43,
        "st_nlink": 0,
        "st_mtime_ns": 101,
        "st_ctime_ns": 201,
    }

    def metadata(self, **changes):
        fields = dict(st_dev=os.makedev(8, 1), st_ino=42,
                      st_mode=stat.S_IFREG | 0o600, st_uid=0, st_gid=0,
                      st_nlink=1, st_size=0, st_mtime_ns=100, st_ctime_ns=200)
        fields.update(changes)
        return SimpleNamespace(**fields)

    def snapshot(self, raw, expected, *, after=None, named=None,
                 named_error=None, close_error=None):
        initial = self.metadata()
        with ExitStack() as stack:
            opened = stack.enter_context(patch.object(
                observer.os, "open", return_value=self.CHILD))
            checked = stack.enter_context(patch.object(
                observer.os, "fstat", side_effect=[initial, after or initial]))
            pathname = stack.enter_context(patch.object(
                observer.os, "stat", return_value=named or initial,
                side_effect=named_error))
            proc = stack.enter_context(patch("builtins.open", mock_open(read_data=raw)))
            closed = stack.enter_context(patch.object(
                observer.os, "close", side_effect=close_error))
            forbidden = [stack.enter_context(patch.object(
                module, name, side_effect=AssertionError("unexpected lock/file access")))
                for module, name in ((observer.os, "read"), (observer.os, "write"),
                                     (fcntl, "flock"), (fcntl, "lockf"))]

            self.assertEqual(observer.lock_snapshot(self.ROOT), expected)

            opened.assert_called_once_with(
                "active.lock", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                dir_fd=self.ROOT)
            self.assertEqual(checked.call_args_list,
                             [call(self.CHILD), call(self.CHILD)])
            pathname.assert_called_once_with(
                "active.lock", dir_fd=self.ROOT, follow_symlinks=False)
            proc.assert_called_once_with("/proc/locks", "rb")
            proc().read.assert_called_once_with(observer.LOCKS_LIMIT + 1)
            proc().__exit__.assert_called_once()
            closed.assert_called_once_with(self.CHILD)
            for operation in forbidden:
                operation.assert_not_called()

    def test_stable_identity_controls(self):
        for raw, expected in ((self.HOLDER, "HELD"),
                              (b"", "VALID_METADATA_NO_HOLDER_OBSERVED")):
            with self.subTest(expected=expected):
                self.snapshot(raw, expected)

    def test_final_pathname_changes_invalidate_both_record_outcomes(self):
        for field, value in self.CHANGES.items():
            for raw in (self.HOLDER, b""):
                with self.subTest(field=field, holder=bool(raw)):
                    self.snapshot(raw, "UNKNOWN", named=self.metadata(**{field: value}))

    def test_opened_descriptor_changes_invalidate_both_record_outcomes(self):
        for field, value in self.CHANGES.items():
            for raw in (self.HOLDER, b""):
                with self.subTest(field=field, holder=bool(raw)):
                    self.snapshot(raw, "UNKNOWN", after=self.metadata(**{field: value}))

    def test_matching_final_descriptor_and_path_cannot_hide_initial_change(self):
        for field, value in self.CHANGES.items():
            for raw in (self.HOLDER, b""):
                with self.subTest(field=field, holder=bool(raw)):
                    changed = self.metadata(**{field: value})
                    self.snapshot(raw, "UNKNOWN", after=changed, named=changed)

    def test_disappearing_path_invalidates_both_record_outcomes(self):
        for raw in (self.HOLDER, b""):
            with self.subTest(holder=bool(raw)):
                self.snapshot(raw, "UNKNOWN", named_error=FileNotFoundError(
                    errno.ENOENT, "mock pathname removed"))

    def test_close_errors_invalidate_result_without_retry(self):
        for code in (errno.EINTR, errno.EIO, errno.EBADF):
            for raw in (self.HOLDER, b""):
                for changed in (False, True):
                    with self.subTest(errno=code, holder=bool(raw), changed=changed):
                        self.snapshot(
                            raw, "UNKNOWN",
                            named=self.metadata(st_ino=43) if changed else None,
                            close_error=OSError(code, "mock close failure"))


if __name__ == "__main__":
    unittest.main()
