"""Offline byte-boundary regressions; no host files or external calls."""
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import c4_operator_observer as observer
import c4_operator_patch as operator


def marker_bytes(raw, kind="recovery"):
    """Feed actual marker parsing stable, synthetic descriptor metadata."""
    info = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0,
                           st_nlink=1, st_size=len(raw),
                           st_mtime_ns=1, st_ctime_ns=1)
    with patch.object(observer.os, "open", return_value=101) as opened, \
            patch.object(observer.os, "fstat", return_value=info), \
            patch.object(observer.os, "read", return_value=raw) as read, \
            patch.object(observer.os, "close") as closed:
        result = observer.marker(100, kind + ".json", kind)
    opened.assert_called_once()
    read.assert_called_once_with(101, 4097)
    closed.assert_called_once_with(101)
    return result


def safe_env(extra=b""):
    return b"".join((key + "=" + value + "\n").encode("utf-8")
                    for key, value in operator.SAFETY.items()) + extra


class JsonBoundaryTests(unittest.TestCase):
    def test_trailing_documents_and_garbage_fail_closed(self):
        for suffix in (b'{}', b' null', b'garbage', b'\x00'):
            raw = b'{"status":"ROLLBACK_PASS"}' + suffix
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError):
                    observer.strict_json(raw)
                self.assertEqual(marker_bytes(raw), "INVALID")

    def test_malformed_utf8_fails_closed(self):
        for invalid in (b'\xff', b'\xc3', b'\xc0\xaf'):
            raw = b'{"status":"' + invalid + b'"}'
            with self.subTest(raw=raw):
                with self.assertRaises(UnicodeError):
                    observer.strict_json(raw)
                self.assertEqual(marker_bytes(raw), "INVALID")

    def test_surrogate_encoded_bytes_fail_closed(self):
        raw = b'{"status":"\xed\xa0\x80"}'
        with self.assertRaisesRegex(ValueError, "UNPAIRED_JSON_SURROGATE"):
            observer.strict_json(raw)
        self.assertEqual(marker_bytes(raw), "INVALID")

    def test_scalar_and_array_json_never_become_markers(self):
        for raw, expected in ((b'null', None), (b'true', True),
                              (b'false', False), (b'0', 0), (b'1.5', 1.5),
                              (b'"ROLLBACK_PASS"', "ROLLBACK_PASS"),
                              (b'[]', []), (b'[{}]', [{}])):
            with self.subTest(raw=raw):
                parsed = observer.strict_json(raw)
                self.assertEqual(parsed, expected)
                self.assertIs(type(parsed), type(expected))
                self.assertEqual(marker_bytes(raw), "INVALID")

    def test_valid_marker_whitespace_and_escaped_status(self):
        raw = b' \t\r\n{"status":"ROLLBACK_\\u0050ASS"}\n '
        self.assertEqual(observer.strict_json(raw), {"status": "ROLLBACK_PASS"})
        self.assertEqual(marker_bytes(raw), "RECORDED_ROLLBACK")
        self.assertEqual(marker_bytes(b'{"status":"BLOCK_BEFORE_APPLY"}'),
                         "RECORDED_BEFORE_APPLY")

    def test_valid_nested_unicode_byte_document(self):
        raw = b'{"items":[{"id":1},{"id":2}],"text":"\xc3\xa9","emoji":"\\ud83d\\ude80"}'
        self.assertEqual(observer.strict_json(raw),
                         {"items": [{"id": 1}, {"id": 2}],
                          "text": "\u00e9", "emoji": "\U0001f680"})

    def test_operator_rejects_json_instead_of_environment(self):
        for raw in (b'{}\n', b'null\n', b'[]\n',
                    b'{"CRM_OPERATOR_EMAILS":"a@example.test"}\n'):
            with self.subTest(raw=raw), self.assertRaisesRegex(
                    operator.Block, "ENV_ASSIGNMENT"):
                operator.plan(raw)

    def test_operator_malformed_utf8_rejected(self):
        with self.assertRaisesRegex(operator.Block, "ENV_ENCODING"):
            operator.plan(safe_env(b'NOTE=\xff\n'))

    def test_operator_valid_bytes_preserved_and_plan_idempotent(self):
        raw = safe_env(b'# \xc3\xa9\nCRM_OPERATOR_EMAILS=A@example.test\n')
        result = operator.plan(raw)
        self.assertTrue(result["output"].startswith(raw.split(b'CRM_OPERATOR_EMAILS=')[0]))
        for key in operator.KEYS:
            self.assertEqual(result["after"][key],
                             result["before"][key] | {operator.OPERATOR})
        again = operator.plan(result["output"])
        self.assertEqual(again["output"], result["output"])
        self.assertIs(again["changed"], False)
        self.assertEqual(again["changedLists"], 0)


if __name__ == "__main__":
    unittest.main()
