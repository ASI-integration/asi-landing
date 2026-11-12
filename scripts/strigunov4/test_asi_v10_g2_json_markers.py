"""Offline regressions for the real G2 marker reader and JSON decoder."""
import json
import os
import stat
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import c4_operator_observer as observer


class MarkerTests(unittest.TestCase):
    def identity(self, length, **changes):
        # Supply a complete Linux identity, independently of the executing UID.
        fields = dict(st_mode=stat.S_IFREG | 0o600, st_ino=12345, st_dev=2049,
                      st_nlink=1, st_uid=0, st_gid=0, st_size=length,
                      st_atime=1700000000, st_mtime=1700000000,
                      st_ctime=1700000000, st_atime_ns=1700000000000000000,
                      st_mtime_ns=1700000000000000000,
                      st_ctime_ns=1700000000000000000)
        fields.update(changes)
        return SimpleNamespace(**fields)

    def classify(self, value, kind="success", *, raw=False, before=None, after=None):
        payload = value if raw else json.dumps(value).encode("utf-8")
        before = before or self.identity(len(payload))
        after = after or before
        with patch.object(observer.os, "open", return_value=91) as opened, \
             patch.object(observer.os, "fstat", side_effect=[before, after]), \
             patch.object(observer.os, "read", return_value=payload) as read, \
             patch.object(observer.os, "close") as closed:
            result = observer.marker(73, "fixture.json", kind)
            opened.assert_called_once_with(
                "fixture.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                dir_fd=73)
            closed.assert_called_once_with(91)
            if kind == "backup":
                read.assert_not_called()
            return result

    def prepared(self, **changes):
        value = dict(runId=observer.FAILED_RUN, sourceSha=observer.FAILED_SHA,
                     status="PREPARED", changedLists=1)
        value.update(changes)
        return value

    def test_exact_success_and_recovery_states(self):
        self.assertEqual(self.classify(dict(observer.host.SUCCESS)), "RECORDED_SUCCESS")
        for status, expected in (("ROLLBACK_PASS", "RECORDED_ROLLBACK"),
                                 ("BLOCK_BEFORE_APPLY", "RECORDED_BEFORE_APPLY")):
            with self.subTest(status=status):
                self.assertEqual(self.classify({"status": status}, "recovery"), expected)

    def test_receipt_requires_exact_keys(self):
        receipt = dict(observer.host.SUCCESS)
        for key in receipt:
            missing = dict(receipt)
            del missing[key]
            renamed = dict(missing)
            renamed[key + " "] = receipt[key]
            for value in (missing, renamed):
                with self.subTest(key=key, value=value):
                    self.assertEqual(self.classify(value), "INVALID")
        self.assertEqual(self.classify(dict(receipt, extra=False)), "INVALID")

    def test_receipt_rejects_equal_but_differently_typed_numbers(self):
        for key, original in observer.host.SUCCESS.items():
            replacements = [None, [], {}]
            if type(original) is int:
                replacements += [float(original), str(original), True]
            elif type(original) is bool:
                replacements += [int(original), float(original), str(original)]
            for replacement in replacements:
                with self.subTest(key=key, replacement=replacement):
                    self.assertEqual(self.classify(dict(observer.host.SUCCESS, **{key: replacement})), "INVALID")

    def test_status_type_confusion_is_invalid_for_all_markers(self):
        for kind, base in (("success", observer.host.SUCCESS),
                           ("prepared", self.prepared()),
                           ("recovery", {"status": "ROLLBACK_PASS"})):
            for status in (None, True, False, 0, 1, [], {}, ["PREPARED"]):
                with self.subTest(kind=kind, status=status):
                    self.assertEqual(self.classify(dict(base, status=status), kind), "INVALID")

    def test_prepared_binding_requires_both_identities(self):
        for changed in (1, 2):
            self.assertEqual(self.classify(self.prepared(changedLists=changed), "prepared"), "BOUND_TO_FAILED_RUN")
        for changes in (dict(runId="123"), dict(sourceSha="a" * 40),
                        dict(runId="123", sourceSha="a" * 40)):
            with self.subTest(changes=changes):
                self.assertEqual(self.classify(self.prepared(**changes), "prepared"), "OTHER_BINDING")

    def test_prepared_rejects_malformed_bindings_and_counts(self):
        cases = {
            "runId": [None, 123, True, "", "0", "01", "-1", "1\n", "1" * 21],
            "sourceSha": [None, 123, "", "a" * 39, "a" * 41, "A" * 40, "g" * 40, "a" * 40 + "\n"],
            "changedLists": [None, True, False, 1.0, 2.0, "1", 0, 3, [], {}],
            "status": ["prepared", "PREPARED ", "ROLLBACK_PASS"],
        }
        for key, values in cases.items():
            for value in values:
                with self.subTest(key=key, value=value):
                    self.assertEqual(self.classify(self.prepared(**{key: value}), "prepared"), "INVALID")
        for key in self.prepared():
            value = self.prepared()
            del value[key]
            self.assertEqual(self.classify(value, "prepared"), "INVALID")
        self.assertEqual(self.classify(self.prepared(extra=1), "prepared"), "INVALID")

    def test_invalid_recovery_states_and_extra_keys(self):
        for value in ({}, {"status": "BLOCK"}, {"status": "BLOCK_MANUAL_RECOVERY_REQUIRED"},
                      {"status": "PREPARED"}, {"status": "ROLLBACK_PASS "},
                      {"status": "ROLLBACK_PASS", "extra": None},
                      {"status": "BLOCK_BEFORE_APPLY", "runId": observer.FAILED_RUN},
                      dict(observer.host.SUCCESS)):
            with self.subTest(value=value):
                self.assertEqual(self.classify(value, "recovery"), "INVALID")

    def test_malformed_json_fails_closed_for_each_kind(self):
        for raw in (b'{"status":"ROLLBACK_PASS","status":"ROLLBACK_PASS"}',
                    b'{"nested":{"x":1,"x":2}}', b'{"status":"\\ud800"}',
                    b'{"\\udfff":1}', b'\xff', b'{', b'{}{}', b'[]', b'null', b'1', b'"status"'):
            for kind in ("success", "prepared", "recovery"):
                with self.subTest(raw=raw, kind=kind):
                    self.assertEqual(self.classify(raw, kind, raw=True), "INVALID")

    def test_invalid_file_identity_and_size(self):
        raw = json.dumps(observer.host.SUCCESS).encode()
        for changes in (dict(st_uid=1000), dict(st_mode=stat.S_IFREG | 0o644),
                        dict(st_mode=stat.S_IFDIR | 0o600), dict(st_nlink=2),
                        dict(st_size=0), dict(st_size=4097)):
            with self.subTest(changes=changes):
                self.assertEqual(self.classify(raw, raw=True, before=self.identity(len(raw), **changes)), "INVALID")

    def test_truncated_read_and_changed_metadata_fail_closed(self):
        raw = json.dumps(observer.host.SUCCESS).encode()
        self.assertEqual(self.classify(raw, raw=True, before=self.identity(len(raw) + 1)), "INVALID")
        for changes in (dict(st_size=len(raw) + 1), dict(st_mtime_ns=1), dict(st_ctime_ns=1)):
            with self.subTest(changes=changes):
                self.assertEqual(self.classify(raw, raw=True, after=self.identity(len(raw), **changes)), "INVALID")

    def test_backup_is_classified_without_reading_private_content(self):
        for size, expected in ((0, "INVALID"), (1, "PRESENT"),
                               (131072, "PRESENT"), (131073, "INVALID")):
            self.assertEqual(self.classify(b"", "backup", raw=True,
                                           before=self.identity(size)), expected)

    def test_absent_marker_does_not_read_or_close(self):
        with patch.object(observer.os, "open", side_effect=FileNotFoundError), \
             patch.object(observer.os, "read") as read, \
             patch.object(observer.os, "close") as close:
            self.assertEqual(observer.marker(73, "fixture.json", "prepared"), "ABSENT")
            read.assert_not_called()
            close.assert_not_called()


class StrictJsonTests(unittest.TestCase):
    def test_duplicate_keys_at_every_depth_are_rejected(self):
        for raw in ('{"x":1,"x":1}', '{"status":1,"st\\u0061tus":2}',
                    '{"outer":{"x":1,"x":2}}', '[{"x":1,"x":2}]'):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(ValueError, "DUPLICATE_JSON_KEY"):
                    observer.strict_json(raw)

    def test_unpaired_surrogates_in_keys_values_and_arrays_are_rejected(self):
        for raw in ('"\\ud800"', '"\\udfff"', '{"\\ud800":1}',
                    '{"x":[{"y":"\\udfff"}]}', '["\\ud800"]'):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(ValueError, "UNPAIRED_JSON_SURROGATE"):
                    observer.strict_json(raw)

    def test_valid_unicode_pairs_and_distinct_nested_keys_are_preserved(self):
        self.assertEqual(observer.strict_json('{"x":"\\ud83d\\ude00","nested":{"x":2}}'),
                         {"x": "😀", "nested": {"x": 2}})

    def test_invalid_syntax_and_encoding_are_rejected(self):
        for raw in (b'\xff', b'{', b'{} trailing', b'{"x":}', b'{"x":1,}'):
            with self.subTest(raw=raw):
                with self.assertRaises((ValueError, UnicodeError)):
                    observer.strict_json(raw)


if __name__ == "__main__":
    unittest.main()
