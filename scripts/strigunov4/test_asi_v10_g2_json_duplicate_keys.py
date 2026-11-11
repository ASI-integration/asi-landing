"""Synthetic offline regressions for strict_json duplicate-key boundaries.

These tests exercise parsing only and provide no physical witness evidence.
"""
import json
import unittest

from c4_operator_observer import strict_json


class V10StrictJsonDuplicateKeyTests(unittest.TestCase):
    def assert_duplicate(self, payload):
        with self.assertRaisesRegex(ValueError, r"^DUPLICATE_JSON_KEY$"):
            strict_json(payload)

    def test_rejects_top_level_duplicates_even_with_equal_values(self):
        for payload in ('{"id":1,"id":2}', '{"id":1,"id":1}'):
            with self.subTest(payload=payload):
                self.assert_duplicate(payload)

    def test_rejects_duplicates_after_falsey_first_values(self):
        for value in ('null', 'false', '0', '""', '[]', '{}'):
            with self.subTest(value=value):
                self.assert_duplicate('{"id":' + value + ',"id":1}')

    def test_rejects_nonadjacent_duplicates(self):
        self.assert_duplicate('{"id":1,"other":2,"id":3}')

    def test_rejects_duplicate_container_keys(self):
        self.assert_duplicate('{"items":{"a":1},"items":[2]}')

    def test_rejects_duplicate_empty_keys(self):
        self.assert_duplicate('{"":1,"":2}')

    def test_rejects_duplicates_in_deeply_nested_object(self):
        self.assert_duplicate('{"outer":{"inner":{"id":1,"id":2}}}')

    def test_rejects_duplicates_in_each_array_position(self):
        for payload in (
            '[{"id":1,"id":2},{"ok":true}]',
            '[{"ok":true},{"id":1,"id":2}]',
            '{"items":[[{"id":1,"id":2}]]}',
        ):
            with self.subTest(payload=payload):
                self.assert_duplicate(payload)

    def test_rejects_keys_equal_after_escape_decoding(self):
        for payload in (
            r'{"id":1,"\u0069d":2}',
            r'{"outer":{"a\\b":1,"a\u005cb":2}}',
            r'[{"\ud83d\ude00":1,"😀":2}]',
        ):
            with self.subTest(payload=payload):
                self.assert_duplicate(payload)

    def test_rejects_duplicate_keys_in_utf8_bytes(self):
        self.assert_duplicate('{"ключ":1,"ключ":2}'.encode('utf-8'))

    def test_rejects_trailing_documents_and_garbage(self):
        for payload in (
            '{"id":1} {"id":2}',
            '[{"id":1}] [{"id":2}]',
            '{"id":1}garbage',
            '{"id":1}\x00',
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(json.JSONDecodeError):
                    strict_json(payload)

    def test_accepts_same_key_in_sibling_objects(self):
        self.assertEqual(
            strict_json('{"left":{"id":1},"right":{"id":2}}'),
            {"left": {"id": 1}, "right": {"id": 2}},
        )

    def test_accepts_same_key_at_parent_and_child_levels(self):
        self.assertEqual(strict_json('{"id":{"id":2}}'), {"id": {"id": 2}})

    def test_accepts_same_key_in_separate_array_objects(self):
        self.assertEqual(
            strict_json('[{"id":1},{"id":2},{"nested":[{"id":3}]}]'),
            [{"id": 1}, {"id": 2}, {"nested": [{"id": 3}]}],
        )

    def test_accepts_distinct_case_and_unicode_normalization(self):
        self.assertEqual(
            strict_json(r'{"id":1,"ID":2,"\u00e9":3,"e\u0301":4}'),
            {"id": 1, "ID": 2, "é": 3, "e\u0301": 4},
        )

    def test_accepts_surrounding_json_whitespace(self):
        self.assertEqual(
            strict_json(' \t\r\n{"items":[{"id":1},{"id":2}]}\n\t '),
            {"items": [{"id": 1}, {"id": 2}]},
        )

    def test_key_tracking_does_not_leak_between_calls_or_after_failure(self):
        self.assertEqual(strict_json('{"id":1}'), {"id": 1})
        self.assert_duplicate('{"id":2,"id":3}')
        self.assertEqual(strict_json('{"id":4}'), {"id": 4})


if __name__ == "__main__":
    unittest.main()
