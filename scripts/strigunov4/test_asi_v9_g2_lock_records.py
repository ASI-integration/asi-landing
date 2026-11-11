"""Synthetic lock-record regressions; never inspect process locks or services."""

import io
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import c4_operator_observer as observer


class SyntheticProcLocks(io.BytesIO):
    """In-memory /proc/locks substitute that records the requested bound."""

    def __init__(self, raw):
        super().__init__(raw)
        self.read_sizes = []

    def read(self, size=-1):
        self.read_sizes.append(size)
        return super().read(size)


class LockRecordTests(unittest.TestCase):
    DEVICE_MAJOR = 0x08
    DEVICE_MINOR = 0x21
    INODE = 424242

    def setUp(self):
        major = patch.object(
            observer.os, "major", side_effect=lambda device: device[0], create=True
        )
        minor = patch.object(
            observer.os, "minor", side_effect=lambda device: device[1], create=True
        )
        nofollow = patch.object(observer.os, "O_NOFOLLOW", 0x20000, create=True)
        nonblock = patch.object(observer.os, "O_NONBLOCK", 0x800, create=True)
        major.start()
        minor.start()
        nofollow.start()
        nonblock.start()
        self.addCleanup(nonblock.stop)
        self.addCleanup(nofollow.stop)
        self.addCleanup(minor.stop)
        self.addCleanup(major.stop)
        self.info = self.stat_info()

    def stat_info(self, *, device_major=None, device_minor=None, inode=None):
        major = self.DEVICE_MAJOR if device_major is None else device_major
        minor = self.DEVICE_MINOR if device_minor is None else device_minor
        return SimpleNamespace(
            st_dev=(major, minor),
            st_ino=self.INODE if inode is None else inode,
            st_mode=stat.S_IFREG | 0o600,
            st_uid=0,
            st_gid=0,
            st_nlink=1,
            st_size=0,
            st_mtime_ns=100,
            st_ctime_ns=200,
        )

    def flock(self, *, waiting=False, device_major=None, device_minor=None,
              inode=None, access="WRITE", newline=True, zero_padded=False):
        major = self.DEVICE_MAJOR if device_major is None else device_major
        minor = self.DEVICE_MINOR if device_minor is None else device_minor
        target_inode = self.INODE if inode is None else inode
        arrow = "-> " if waiting else ""
        ending = "\n" if newline else ""
        device = (f"{major:02x}:{minor:02x}" if zero_padded
                  else f"{major:x}:{minor:x}")
        return (
            f"1: {arrow}FLOCK ADVISORY {access} 123 "
            f"{device}:{target_inode} 0 EOF{ending}"
        ).encode("ascii")

    def snapshot(self, raw, *, after=None, named=None):
        before = self.info
        after = before if after is None else after
        named = before if named is None else named
        fixture = SyntheticProcLocks(raw)
        with patch.object(observer.os, "open", return_value=91), \
             patch.object(observer.os, "fstat", side_effect=(before, after)), \
             patch.object(observer.os, "stat", return_value=named), \
             patch.object(observer.os, "close") as close, \
             patch("builtins.open", return_value=fixture) as proc_locks:
            result = observer.lock_snapshot(17)
        proc_locks.assert_called_once_with("/proc/locks", "rb")
        self.assertEqual(fixture.read_sizes, [observer.LOCKS_LIMIT + 1])
        close.assert_called_once_with(91)
        return result

    def test_matching_stat_device_and_inode_are_held_including_zero_padding(self):
        for access in ("READ", "WRITE"):
            for zero_padded in (False, True):
                with self.subTest(access=access, zero_padded=zero_padded):
                    self.assertEqual(
                        observer.lock_records(
                            self.flock(access=access, zero_padded=zero_padded),
                            self.info,
                        ),
                        "HELD",
                    )

    def test_waiting_flock_is_unknown_without_a_holder(self):
        self.assertEqual(
            observer.lock_records(self.flock(waiting=True), self.info),
            "UNKNOWN",
        )

    def test_unrelated_waiting_flock_is_valid_metadata_without_holder(self):
        unrelated = (
            self.flock(waiting=True, device_major=self.DEVICE_MAJOR + 1),
            self.flock(waiting=True, device_minor=self.DEVICE_MINOR + 1),
            self.flock(waiting=True, inode=self.INODE + 1),
        )
        for raw in unrelated:
            with self.subTest(raw=raw):
                self.assertEqual(
                    observer.lock_records(raw, self.info),
                    "VALID_METADATA_NO_HOLDER_OBSERVED",
                )

    def test_held_record_wins_over_matching_waiter_and_unrelated_waiter(self):
        without_holder = b"".join((
            self.flock(waiting=True, inode=self.INODE + 1),
            self.flock(waiting=True),
        ))
        self.assertEqual(observer.lock_records(without_holder, self.info), "UNKNOWN")
        self.assertEqual(
            observer.lock_records(without_holder + self.flock(), self.info),
            "HELD",
        )

    def test_well_formed_unrelated_flock_is_not_a_holder(self):
        unrelated = (
            self.flock(device_major=self.DEVICE_MAJOR + 1),
            self.flock(device_minor=self.DEVICE_MINOR + 1),
            self.flock(inode=self.INODE + 1),
        )
        for raw in unrelated:
            with self.subTest(raw=raw):
                self.assertEqual(
                    observer.lock_records(raw, self.info),
                    "VALID_METADATA_NO_HOLDER_OBSERVED",
                )

    def test_malformed_flock_is_unknown_even_when_unrelated(self):
        unrelated = self.flock(inode=self.INODE + 1)
        malformed = (
            unrelated.replace(b"ADVISORY", b"ACTIVE"),
            unrelated.replace(b"WRITE", b"INVENTED"),
            unrelated.replace(b"123 ", b"not-a-pid "),
            unrelated.replace(b"0 EOF", b"9 2"),
            unrelated + b"extra\n",
        )
        for raw in malformed:
            with self.subTest(raw=raw):
                self.assertEqual(observer.lock_records(raw, self.info), "UNKNOWN")

    def test_malformed_record_makes_otherwise_held_records_unknown(self):
        raw = self.flock() + b"2: FLOCK ADVISORY WRITE\n"
        self.assertEqual(observer.lock_records(raw, self.info), "UNKNOWN")

    def test_truncated_flock_lines_are_unknown_regardless_of_identity(self):
        matching = self.flock()
        unrelated = self.flock(inode=self.INODE + 1)
        truncated = (
            matching.removesuffix(b"\n"),
            unrelated.removesuffix(b"\n"),
            matching.removesuffix(b" 0 EOF\n") + b"\n",
            unrelated.removesuffix(b" 0 EOF\n") + b"\n",
            b"1: FLOCK\n",
        )
        for raw in truncated:
            with self.subTest(raw=raw):
                self.assertEqual(observer.lock_records(raw, self.info), "UNKNOWN")

    def test_oversized_valid_matching_records_are_unknown(self):
        held = self.flock()
        raw = held * (observer.LOCKS_LIMIT // len(held) + 1)
        self.assertGreater(len(raw), observer.LOCKS_LIMIT)
        self.assertTrue(raw.endswith(b"\n"))
        self.assertEqual(observer.lock_records(raw, self.info), "UNKNOWN")

    def test_lock_snapshot_classifies_only_the_supplied_synthetic_bytes(self):
        unrelated = self.flock(inode=self.INODE + 1)
        cases = (
            (self.flock(zero_padded=True), "HELD"),
            (unrelated, "VALID_METADATA_NO_HOLDER_OBSERVED"),
            (self.flock(waiting=True), "UNKNOWN"),
            (self.flock(waiting=True, inode=self.INODE + 1),
             "VALID_METADATA_NO_HOLDER_OBSERVED"),
            (unrelated.replace(b"ADVISORY", b"ACTIVE"), "UNKNOWN"),
            (unrelated.removesuffix(b" 0 EOF\n") + b"\n", "UNKNOWN"),
        )
        for raw, expected in cases:
            with self.subTest(raw=raw, expected=expected):
                self.assertEqual(self.snapshot(raw), expected)

    def test_lock_snapshot_rejects_descriptor_or_path_stat_replacement(self):
        for source in ("descriptor", "path"):
            for field in ("device", "inode"):
                changed = self.stat_info(
                    device_major=(self.DEVICE_MAJOR + 1 if field == "device" else None),
                    inode=(self.INODE + 1 if field == "inode" else None),
                )
                kwargs = {"after" if source == "descriptor" else "named": changed}
                with self.subTest(source=source, field=field):
                    self.assertEqual(self.snapshot(self.flock(), **kwargs), "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
