"""Offline observer marker JSON regressions using synthetic bytes only."""
import unittest

import c4_operator_observer as observer
from test_asi_v9_g2_json_boundary import marker_bytes


class ObserverJsonScalarTests(unittest.TestCase):
    def assert_invalid_scalar(self, raw):
        with self.assertRaisesRegex(ValueError, "^UNPAIRED_JSON_SURROGATE$"):
            observer.strict_json(raw)
        self.assertEqual(marker_bytes(raw), "INVALID")

    def test_rejects_unpaired_surrogates_in_nested_keys(self):
        for scalar in (br'\ud800', br'\udbff', br'\udc00', br'\udfff',
                       br'\ud800\u0041', br'\udc00\ud800',
                       br'\ud83d\ude80\ud800', b'\xed\xa0\x80',
                       b'\xed\xbf\xbf'):
            raw = b'{"outer":[{"inner":{"' + scalar + b'":true}}]}'
            with self.subTest(scalar=scalar):
                self.assert_invalid_scalar(raw)

    def test_rejects_unpaired_surrogates_in_nested_lists(self):
        for scalar in (br'\ud800', br'\udbff', br'\udc00', br'\udfff',
                       br'\ud800\u0041', br'\udc00\ud800',
                       br'\ud83d\ude80\udfff', b'\xed\xa0\x80',
                       b'\xed\xbf\xbf'):
            raw = b'{"outer":[0,[true,{"inner":[null,["' + scalar + b'"]]}]]}'
            with self.subTest(scalar=scalar):
                self.assert_invalid_scalar(raw)

    def test_rejects_nested_duplicate_keys_after_escape_decoding(self):
        for members in (
            b'"id":1,"id":2',
            br'"id":1,"\u0069d":1',
            br'"\ud83d\ude80":1,"\uD83D\uDE80":2',
            b'"\xf0\x9f\x9a\x80":1,"\\ud83d\\ude80":2',
        ):
            raw = b'{"outer":[[{"inner":{' + members + b'}}]]}'
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(ValueError, "^DUPLICATE_JSON_KEY$"):
                    observer.strict_json(raw)
                self.assertEqual(marker_bytes(raw), "INVALID")

    def test_accepts_surrogate_pairs_in_nested_keys_and_lists(self):
        for pair, expected in ((br'\ud800\udc00', "\U00010000"),
                               (br'\udbff\udfff', "\U0010ffff"),
                               (br'\uD83D\uDE80', "\U0001f680")):
            raw = (b'{"outer":[{"' + pair + b'":[["' + pair + b'"]]}]}')
            with self.subTest(pair=pair):
                self.assertEqual(observer.strict_json(raw),
                                 {"outer": [{expected: [[expected]]}]})

    def test_accepts_repeated_decoded_keys_in_separate_objects(self):
        raw = br'{"outer":[[{"id":1},{"\u0069d":2}]],"id":3}'
        self.assertEqual(observer.strict_json(raw),
                         {"outer": [[{"id": 1}, {"id": 2}]], "id": 3})

    def test_accepts_literal_backslash_u_in_nested_keys_and_lists(self):
        raw = br'{"outer":[{"\\ud800":[["\\udfff"]]}]}'
        self.assertEqual(observer.strict_json(raw),
                         {"outer": [{r'\ud800': [[r'\udfff']]}]})

    def test_marker_accepts_valid_escaped_status(self):
        raw = br'{"status":"ROLLBACK_\u0050ASS"}'
        self.assertEqual(observer.strict_json(raw), {"status": "ROLLBACK_PASS"})
        self.assertEqual(marker_bytes(raw), "RECORDED_ROLLBACK")


if __name__ == "__main__":
    unittest.main()
