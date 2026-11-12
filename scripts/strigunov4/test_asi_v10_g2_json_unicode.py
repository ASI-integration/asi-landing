"""S4-G2 V10 offline regressions for strict_json Unicode scalar safety.

No marker file, host, network or service access; synthetic inputs only.
"""
import unittest

from c4_operator_observer import strict_json
from c4_operator_patch import Block, SAFETY, decode


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

    def test_rejects_literal_non_scalar_strings_at_every_container_level(self):
        for surrogate in ("\ud800", "\udbff", "\udc00", "\udfff"):
            for payload in (
                '"' + surrogate + '"',
                '["' + surrogate + '"]',
                '{"outer":[{"' + surrogate + '":0}]}',
            ):
                with self.subTest(payload=ascii(payload)):
                    with self.assertRaisesRegex(ValueError, "UNPAIRED_JSON_SURROGATE"):
                        strict_json(payload)

    def test_rejects_unpaired_escape_after_valid_pair_in_nested_key(self):
        for suffix in (r'\ud800', r'\udfff'):
            payload = r'{"outer":[{"\ud83d\ude80' + suffix + r'":true}]}'
            with self.subTest(suffix=suffix):
                with self.assertRaisesRegex(ValueError, "UNPAIRED_JSON_SURROGATE"):
                    strict_json(payload)

    def test_accepts_surrogate_pair_boundaries(self):
        self.assertEqual(
            strict_json(r'{"\ud800\udc00":["\udbff\udfff","\ud83d\ude80"]}'),
            {"\U00010000": ["\U0010ffff", "\U0001f680"]},
        )

    def test_rejects_duplicate_keys_after_unicode_escape_decoding(self):
        for payload in (
            r'{"nested":{"a":1,"\u0061":2}}',
            '{"nested":{"🚀":1,"\\ud83d\\ude80":2}}',
        ):
            with self.subTest(payload=payload):
                with self.assertRaisesRegex(ValueError, "DUPLICATE_JSON_KEY"):
                    strict_json(payload)

    def test_rejects_all_unescaped_json_control_characters(self):
        for code in range(32):
            for payload in ('{"value":"' + chr(code) + '"}',
                            '{"nested":{"' + chr(code) + '":0}}'):
                with self.subTest(code=code, payload=ascii(payload)):
                    with self.assertRaises(ValueError):
                        strict_json(payload)

    def test_accepts_escaped_controls_and_legal_document_whitespace(self):
        self.assertEqual(
            strict_json(' \t\r\n' + r'{"\u0000":"\b\f\n\r\t\u001f"}' + '\n'),
            {"\x00": "\b\f\n\r\t\x1f"},
        )

    def test_accepts_literal_backslash_u_without_interpreting_it_twice(self):
        self.assertEqual(
            strict_json(r'{"outer":{"\\ud800":"\\udfff"}}'),
            {"outer": {r'\ud800': r'\udfff'}},
        )


class V10HostEnvironmentUnicodeTests(unittest.TestCase):
    @staticmethod
    def environment(extra):
        return ("".join(f"{key}={value}\n" for key, value in SAFETY.items())
                .encode("utf-8") + extra)

    def test_rejects_utf8_encoded_surrogates_and_out_of_range_codepoints(self):
        for invalid in (b'\xed\xa0\x80', b'\xed\xbf\xbf', b'\xf4\x90\x80\x80'):
            with self.subTest(invalid=invalid):
                with self.assertRaisesRegex(Block, "^ENV_ENCODING$"):
                    decode(self.environment(b"NOTE=" + invalid + b"\n"))

    def test_rejects_controls_and_unicode_line_separators(self):
        for control in ("\x01", "\x08", "\x0b", "\x1f", "\x85", "\u2028", "\u2029"):
            with self.subTest(control=ascii(control)):
                with self.assertRaisesRegex(Block, "^ENV_CONTROL$"):
                    decode(self.environment(("NOTE=a" + control + "b\n").encode("utf-8")))

    def test_accepts_scalar_unicode_and_tab_in_unrelated_assignment(self):
        raw = self.environment("NOTE=Привет\t🚀\U0010ffff\n".encode("utf-8"))
        lines, values, positions = decode(raw)
        self.assertEqual("".join(lines).encode("utf-8"), raw)
        self.assertEqual(values, SAFETY)
        self.assertEqual(positions, {key: index for index, key in enumerate(SAFETY)})


if __name__ == "__main__":
    unittest.main()
