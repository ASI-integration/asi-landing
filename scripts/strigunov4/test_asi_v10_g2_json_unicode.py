"""S4-G2 V10 offline regressions for strict_json Unicode scalar safety.

No marker file, host, network or service access; synthetic inputs only.
"""
import unittest

from c4_operator_observer import strict_json


class V10StrictJsonUnicodeTests(unittest.TestCase):
    def test_rejects_lone_surrogates_in_nested_values(self):
        invalid = (
            r'{"value":"\uD800"}',
            r'{"value":"\uDC00"}',
            r'{"value":"\uD800\u0041"}',
            r'{"value":"\uDC00\uD800"}',
            r'{"outer":[{"value":"\uD800"}]}',
        )
        for payload in invalid:
            with self.subTest(payload=payload):
                with self.assertRaisesRegex(ValueError, "UNPAIRED_JSON_SURROGATE"):
                    strict_json(payload)

    def test_rejects_lone_surrogates_in_nested_keys(self):
        invalid = (
            r'{"\uD800": 1}',
            r'{"nested": [{"\uDC00": false}]}',
            r'{"outer": {"\uD800\u0041": null}}',
        )
        for payload in invalid:
            with self.subTest(payload=payload):
                with self.assertRaisesRegex(ValueError, "UNPAIRED_JSON_SURROGATE"):
                    strict_json(payload)

    def test_accepts_valid_paired_escapes_and_unicode(self):
        raw = r'{"\uD83D\uDE00":{"value":"\uD83D\uDE80","text":"\u00e9"}}'
        self.assertEqual(strict_json(raw), {
            "\U0001F600": {"value": "\U0001F680", "text": "\u00e9"}
        })

    def test_accepts_independent_repeat_keys_across_objects(self):
        self.assertEqual(
            strict_json('{"left":{"id":1},"right":{"id":2}}'),
            {"left": {"id": 1}, "right": {"id": 2}},
        )

    def test_rejects_duplicate_key_inside_nested_object(self):
        with self.assertRaisesRegex(ValueError, "DUPLICATE_JSON_KEY"):
            strict_json('{"outer":{"id":1,"id":2}}')

    def test_rejects_trailing_documents_or_garbage(self):
        for payload in ('{"ok":true} {"other":1}', '{"ok":true}garbage'):
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    strict_json(payload)


if __name__ == "__main__":
    unittest.main()
