"""Offline observer identity/provenance regressions using synthetic records."""
from contextlib import ExitStack
import json
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import c4_operator_observer as observer
from c4_operator_patch import Block


def metadata(size, **changes):
    values = dict(st_dev=1, st_ino=17, st_mode=stat.S_IFREG | 0o600,
                  st_uid=0, st_gid=0, st_nlink=1, st_size=size,
                  st_mtime_ns=100, st_ctime_ns=100)
    return SimpleNamespace(**(values | changes))


class WitnessIdentityTests(unittest.TestCase):
    def marker(self, raw, kind="success", *, after=None, named=None):
        before = metadata(len(raw))
        with ExitStack() as stack:
            opened = stack.enter_context(patch.object(observer.os, "open", return_value=41))
            stack.enter_context(patch.object(observer.os, "read", return_value=raw))
            stack.enter_context(patch.object(observer.os, "fstat", side_effect=[before, after or before]))
            lookup = stack.enter_context(patch.object(observer.os, "stat", return_value=named or before))
            closed = stack.enter_context(patch.object(observer.os, "close"))
            result = observer.marker(23, kind + ".json", kind)
            opened.assert_called_once_with(kind + ".json", observer.os.O_RDONLY |
                observer.os.O_NOFOLLOW | observer.os.O_NONBLOCK, dir_fd=23)
            lookup.assert_called_once_with(kind + ".json", dir_fd=23, follow_symlinks=False)
            closed.assert_called_once_with(41)
            return result

    def test_wrong_principal_stops_before_private_evidence(self):
        with patch.object(observer.os, "geteuid", return_value=1001), \
             patch.object(observer.os, "uname") as uname, \
             patch.object(observer, "claim_snapshot") as claims, \
             patch.object(observer.host, "live") as live:
            with self.assertRaisesRegex(Block, "HOST"):
                observer.observe()
            uname.assert_not_called()
            claims.assert_not_called()
            live.assert_not_called()

    def test_exact_receipt_is_recognized(self):
        self.assertEqual(self.marker(json.dumps(observer.host.SUCCESS).encode()),
                         "RECORDED_SUCCESS")

    def test_mismatched_receipt_is_invalid(self):
        for change in ({"status": "OTHER_RUN"}, {"effectiveLists": 1},
                       {"releaseSwitched": 0}, {"unexpected": "claim"}):
            with self.subTest(change=change):
                raw = json.dumps(observer.host.SUCCESS | change).encode()
                self.assertEqual(self.marker(raw), "INVALID")

    def test_duplicate_claim_binding_is_invalid_even_when_values_match(self):
        raw = ('{"runId":"%s","runId":"%s","sourceSha":"%s",'
               '"status":"PREPARED","changedLists":1}' %
               (observer.FAILED_RUN, observer.FAILED_RUN, observer.FAILED_SHA)).encode()
        self.assertEqual(self.marker(raw, "prepared"), "INVALID")

    def test_prepared_claim_must_match_incident(self):
        claim = dict(runId=observer.FAILED_RUN, sourceSha=observer.FAILED_SHA,
                     status="PREPARED", changedLists=1)
        self.assertEqual(self.marker(json.dumps(claim).encode(), "prepared"),
                         "BOUND_TO_FAILED_RUN")
        for change in ({"runId": "12345"}, {"sourceSha": "a" * 40}):
            with self.subTest(change=change):
                self.assertEqual(self.marker(json.dumps(claim | change).encode(), "prepared"),
                                 "OTHER_BINDING")

    def test_stale_witness_replaced_at_fixed_name_is_invalid(self):
        raw = json.dumps(observer.host.SUCCESS).encode()
        for change in ({"st_ino": 18}, {"st_dev": 2}, {"st_uid": 1001},
                       {"st_mode": stat.S_IFLNK | 0o600}):
            with self.subTest(change=change):
                self.assertEqual(self.marker(raw, named=metadata(len(raw), **change)), "INVALID")

    def test_witness_metadata_changed_during_read_is_invalid(self):
        raw = json.dumps(observer.host.SUCCESS).encode()
        self.assertEqual(self.marker(raw, after=metadata(len(raw), st_nlink=2)), "INVALID")


if __name__ == "__main__":
    unittest.main()
