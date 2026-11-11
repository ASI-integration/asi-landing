"""Offline marker regressions using synthetic bytes and mocked descriptors only.

These tests exercise source contracts, not physical witness acceptance. No real
marker files, service operations, credentials, or network calls are needed.
"""
import json
import stat
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import c4_operator_observer as observer


class JsonMarkerTests(unittest.TestCase):
    def prepared(self):
        return {"runId": "123456", "sourceSha": "a" * 40,
                "status": "PREPARED", "changedLists": 1}

    def classify(self, raw, kind="prepared"):
        """Run the real decoder/validator behind an entirely synthetic read."""
        info = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0,
                               st_nlink=1, st_size=len(raw),
                               st_mtime_ns=10, st_ctime_ns=20)
        with patch.object(observer.os, "open", return_value=901) as opened, \
                patch.object(observer.os, "fstat", return_value=info), \
                patch.object(observer.os, "read", return_value=raw) as read, \
                patch.object(observer.os, "close") as closed:
            result = observer.marker(900, "synthetic.json", kind)
            opened.assert_called_once_with(
                "synthetic.json", observer.os.O_RDONLY | observer.os.O_NOFOLLOW
                | observer.os.O_NONBLOCK, dir_fd=900)
            if 0 < len(raw) <= 4096:
                read.assert_called_once_with(901, 4097)
            else:
                read.assert_not_called()
            closed.assert_called_once_with(901)
            return result

    def encoded(self, value):
        return json.dumps(value, ensure_ascii=False).encode("utf-8")

    def test_valid_synthetic_markers(self):
        cases = (("prepared", self.prepared(), "OTHER_BINDING"),
                 ("success", dict(observer.host.SUCCESS), "RECORDED_SUCCESS"),
                 ("recovery", {"status": "ROLLBACK_PASS"}, "RECORDED_ROLLBACK"),
                 ("recovery", {"status": "BLOCK_BEFORE_APPLY"},
                  "RECORDED_BEFORE_APPLY"))
        for kind, value, expected in cases:
            with self.subTest(kind=kind, value=value):
                self.assertEqual(self.classify(self.encoded(value), kind), expected)

    def test_malformed_json_is_invalid_for_every_marker_kind(self):
        payloads = (b"", b"{", b'{"status":}', b'{"status":"x",}',
                    b"{'status':'x'}", b'{status:"x"}', b'{"x":"\\q"}',
                    b'{"x":"line\nbreak"}', b'{"x":01}', b'/*comment*/{}')
        for kind in ("prepared", "success", "recovery"):
            for raw in payloads:
                with self.subTest(kind=kind, raw=raw):
                    self.assertEqual(self.classify(raw, kind), "INVALID")

    def test_non_object_json_is_invalid(self):
        for value in (None, True, False, 0, 1.5, "PREPARED", [],
                      [self.prepared()]):
            with self.subTest(value=value):
                for kind in ("prepared", "success", "recovery"):
                    self.assertEqual(self.classify(self.encoded(value), kind), "INVALID")

    def test_trailing_documents_and_garbage_are_invalid(self):
        raw = self.encoded(self.prepared())
        for suffix in (b"{}", b" null", b"garbage", b"\x00"):
            with self.subTest(suffix=suffix):
                self.assertEqual(self.classify(raw + suffix), "INVALID")

    def test_json_whitespace_preserves_valid_marker(self):
        self.assertEqual(self.classify(b" \r\n\t" + self.encoded(self.prepared())
                                       + b"\n\t "), "OTHER_BINDING")

    def test_invalid_utf8_is_invalid(self):
        for raw in (b'{"status":"\xff"}', b'{"\xc0\xaf":1}',
                    b'{"x":"\xed\xa0\x80"}', b'{"x":"\xe2\x82"}'):
            with self.subTest(raw=raw):
                self.assertEqual(self.classify(raw), "INVALID")

    def test_duplicate_fields_cannot_override_status(self):
        for raw in (b'{"status":"ROLLBACK_PASS","status":"BLOCK_BEFORE_APPLY"}',
                    b'{"status":"ROLLBACK_PASS","sta\\u0074us":"ROLLBACK_PASS"}'):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(ValueError, "DUPLICATE_JSON_KEY"):
                    observer.strict_json(raw)
                self.assertEqual(self.classify(raw, "recovery"), "INVALID")

    def test_unexpected_fields_are_rejected_in_all_schemas(self):
        for kind, value in (("prepared", self.prepared()),
                            ("success", dict(observer.host.SUCCESS)),
                            ("recovery", {"status": "ROLLBACK_PASS"})):
            for key in ("extra", "", "статус", "状态", "🚀", "status\u200b"):
                with self.subTest(kind=kind, key=key):
                    self.assertEqual(self.classify(
                        self.encoded(dict(value, **{key: {"nested": True}})), kind),
                        "INVALID")

    def test_missing_fields_are_rejected(self):
        for kind, value in (("prepared", self.prepared()),
                            ("success", dict(observer.host.SUCCESS)),
                            ("recovery", {"status": "ROLLBACK_PASS"})):
            for key in value:
                with self.subTest(kind=kind, key=key):
                    altered = {k: v for k, v in value.items() if k != key}
                    self.assertEqual(self.classify(self.encoded(altered), kind), "INVALID")

    def test_unicode_lookalikes_do_not_replace_required_keys(self):
        for key in ("ѕtatus", "statυs", "ｓｔａｔｕｓ", "status\u200b"):
            with self.subTest(key=key):
                raw = self.encoded({key: "ROLLBACK_PASS"})
                self.assertEqual(observer.strict_json(raw), {key: "ROLLBACK_PASS"})
                self.assertEqual(self.classify(raw, "recovery"), "INVALID")

    def test_escaped_ascii_key_is_equivalent_to_literal_key(self):
        self.assertEqual(self.classify(
            b'{"sta\\u0074us":"ROLLBACK_PASS"}', "recovery"),
            "RECORDED_ROLLBACK")

    def test_unicode_keys_are_preserved_without_normalization(self):
        value = {"é": 1, "e\u0301": 2, "状态": {"🚀": ["готово"]}}
        for ascii_only in (True, False):
            with self.subTest(ascii_only=ascii_only):
                raw = json.dumps(value, ensure_ascii=ascii_only).encode("utf-8")
                self.assertEqual(observer.strict_json(raw), value)
                self.assertEqual(len(observer.strict_json(raw)), 3)

    def test_escaped_unicode_duplicate_key_is_rejected(self):
        for raw in ('{"é":1,"\\u00e9":2}',
                    '{"nested":[{"🚀":1,"\\ud83d\\ude80":2}]}'):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(ValueError, "DUPLICATE_JSON_KEY"):
                    observer.strict_json(raw.encode("utf-8"))

    def test_surrogates_in_unknown_nested_fields_are_still_rejected(self):
        for raw in (br'{"extra":{"\ud800":1}}',
                    br'{"extra":[{"key":"\udfff"}]}'):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(ValueError, "UNPAIRED_JSON_SURROGATE"):
                    observer.strict_json(raw)
                self.assertEqual(self.classify(raw), "INVALID")

    def test_prepared_field_types_and_bounds_are_strict(self):
        changes = {"changedLists": (True, False, 0, 3, 1.0, "1", None),
                   "runId": (123456, "0", "01", "1\n", "١٢٣", "1" * 21),
                   "sourceSha": (None, "A" * 40, "a" * 39, "a" * 41,
                                 "a" * 40 + "\n"),
                   "status": (None, [], "prepared", "PREPARED\u200b")}
        for key, values in changes.items():
            for value in values:
                with self.subTest(key=key, value=value):
                    altered = dict(self.prepared(), **{key: value})
                    self.assertEqual(self.classify(self.encoded(altered)), "INVALID")
        self.assertEqual(self.classify(self.encoded(
            dict(self.prepared(), changedLists=2))), "OTHER_BINDING")

    def test_success_rejects_numeric_boolean_type_confusion(self):
        for key, value in observer.host.SUCCESS.items():
            if type(value) not in (int, bool):
                continue
            replacement = int(value) if type(value) is bool else float(value)
            with self.subTest(key=key):
                altered = dict(observer.host.SUCCESS, **{key: replacement})
                self.assertEqual(self.classify(self.encoded(altered), "success"), "INVALID")

    def test_nonfinite_values_cannot_form_valid_markers(self):
        for token in (b"NaN", b"Infinity", b"-Infinity", b"1e999"):
            with self.subTest(token=token):
                raw = self.encoded(self.prepared()).replace(b'"changedLists": 1',
                                                          b'"changedLists": ' + token)
                self.assertEqual(self.classify(raw), "INVALID")

    def test_oversized_marker_is_rejected_before_read(self):
        self.assertEqual(self.classify(b" " * 4097), "INVALID")


if __name__ == "__main__":
    unittest.main()
