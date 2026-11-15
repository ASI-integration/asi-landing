"""Offline descriptor regressions for the real marker reader; no private files."""
import errno
import os
import stat
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

import c4_operator_observer as observer


class BackupDescriptorTests(unittest.TestCase):
    PARENT = 73
    CHILD = 91
    NAME = "mock-backup-marker"

    def identity(self, **changes):
        fields = dict(st_mode=stat.S_IFREG | 0o600, st_uid=0,
                      st_nlink=1, st_size=1)
        fields.update(changes)
        return SimpleNamespace(**fields)

    def backup(self, expected, *, metadata=None, stat_error=None):
        with ExitStack() as stack:
            opened = stack.enter_context(patch.object(
                observer.os, "open", return_value=self.CHILD))
            checked = stack.enter_context(patch.object(
                observer.os, "fstat", return_value=metadata or self.identity(),
                side_effect=stat_error))
            read = stack.enter_context(patch.object(
                observer.os, "read", side_effect=AssertionError("private byte read")))
            decoded = stack.enter_context(patch.object(
                observer, "strict_json", side_effect=AssertionError("backup decoded")))
            closed = stack.enter_context(patch.object(observer.os, "close"))
            self.assertEqual(observer.marker(self.PARENT, self.NAME, "backup"), expected)
            opened.assert_called_once_with(
                self.NAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                dir_fd=self.PARENT)
            checked.assert_called_once_with(self.CHILD)
            read.assert_not_called()
            decoded.assert_not_called()
            closed.assert_called_once_with(self.CHILD)

    def test_backup_size_boundaries_never_read_or_decode(self):
        for size, expected in ((-1, "INVALID"), (0, "INVALID"),
                               (1, "PRESENT"), (4097, "PRESENT"),
                               (131071, "PRESENT"), (131072, "PRESENT"),
                               (131073, "INVALID")):
            with self.subTest(size=size):
                self.backup(expected, metadata=self.identity(st_size=size))

    def test_backup_requires_root_owner(self):
        for uid in (-1, 1, 1000):
            with self.subTest(uid=uid):
                self.backup("INVALID", metadata=self.identity(st_uid=uid))

    def test_backup_requires_exact_private_mode(self):
        # Exercise every permission/special bit independently, including removed
        # owner bits; an overly broad permission mask must not admit these.
        for bit in (1 << shift for shift in range(12)):
            mode = 0o600 ^ bit
            with self.subTest(mode=oct(mode)):
                self.backup("INVALID", metadata=self.identity(
                    st_mode=stat.S_IFREG | mode))

    def test_backup_requires_regular_file(self):
        for kind in (stat.S_IFDIR, stat.S_IFLNK, stat.S_IFIFO, stat.S_IFSOCK,
                     stat.S_IFCHR, stat.S_IFBLK, 0):
            with self.subTest(kind=kind):
                self.backup("INVALID", metadata=self.identity(st_mode=kind | 0o600))

    def test_backup_requires_exactly_one_link(self):
        for links in (-1, 0, 2, 3):
            with self.subTest(links=links):
                self.backup("INVALID", metadata=self.identity(st_nlink=links))

    def test_fstat_errors_close_acquired_descriptor_once_without_reading(self):
        for error in (OSError(errno.EIO, "mock stat failure"),
                      ValueError("mock invalid descriptor")):
            with self.subTest(error=type(error).__name__):
                self.backup("INVALID", stat_error=error)

    def test_open_errors_never_close_an_unacquired_descriptor(self):
        for error in (FileNotFoundError(errno.ENOENT, "mock absent"),
                      PermissionError(errno.EACCES, "mock denied"),
                      OSError(errno.ELOOP, "mock symlink rejected")):
            with self.subTest(errno=error.errno), \
                 patch.object(observer.os, "open", side_effect=error) as opened, \
                 patch.object(observer.os, "fstat") as checked, \
                 patch.object(observer.os, "read") as read, \
                 patch.object(observer.os, "close") as closed:
                if isinstance(error, FileNotFoundError):
                    self.assertEqual(observer.marker(self.PARENT, self.NAME, "backup"), "ABSENT")
                else:
                    with self.assertRaises(type(error)) as raised:
                        observer.marker(self.PARENT, self.NAME, "backup")
                    self.assertIs(raised.exception, error)
                opened.assert_called_once_with(
                    self.NAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                    dir_fd=self.PARENT)
                checked.assert_not_called()
                read.assert_not_called()
                closed.assert_not_called()


if __name__ == "__main__":
    unittest.main()
