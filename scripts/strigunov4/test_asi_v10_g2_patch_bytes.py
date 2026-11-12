"""Synthetic, in-memory byte-integrity regressions; no host access."""
import unittest

import c4_operator_patch as p


SAFETY = b"".join(f"{key}={value}\n".encode() for key, value in p.SAFETY.items())
OPERATOR = p.OPERATOR.encode("ascii")


def canonical(key, members=OPERATOR):
    return key.encode() + b'="' + members + b'"\n'


class PatchBytesTests(unittest.TestCase):
    def test_append_exact_bytes_and_order(self):
        raw = SAFETY + '# Русский текст 🙂\nNOTE="café = # значение"\n\t\n'.encode()
        expected = raw + b"".join(canonical(key) for key in p.KEYS)
        result = p.plan(raw)
        self.assertEqual(result["output"], expected)
        self.assertTrue(result["changed"])
        self.assertEqual(result["changedLists"], 2)

    def test_replace_only_target_lines_with_identical_context(self):
        old = b' \tCRM_OPERATOR_EMAILS="A@example.test; b@example.test" \t\n'
        prefix = SAFETY + b'# ' + old + b'COPY="A@example.test; b@example.test"\n'
        suffix = 'NOTE="не менять é"\n'.encode() + canonical(p.KEYS[1])
        raw = prefix + old + suffix
        result = p.plan(raw)
        self.assertEqual(result["output"], prefix + canonical(
            p.KEYS[0], b"A@example.test,b@example.test," + OPERATOR) + suffix)
        self.assertEqual(result["changedLists"], 1)

    def test_noop_preserves_noncanonical_format_and_case(self):
        raw = SAFETY + b"".join(
            key.encode() + b"='A@example.test;\t" + OPERATOR.upper() + b"' \t\n"
            for key in reversed(p.KEYS))
        result = p.plan(raw)
        self.assertEqual(result["output"], raw)
        self.assertFalse(result["changed"])
        self.assertEqual(result["changedLists"], 0)

    def test_deduplication_exact_output_then_noop(self):
        raw = SAFETY + b'CRM_OPERATOR_EMAILS=A@example.test,a@example.test\n'
        expected = SAFETY + canonical(p.KEYS[0], b"A@example.test," + OPERATOR)
        expected += canonical(p.KEYS[1])
        self.assertEqual(p.plan(raw)["output"], expected)
        result = p.plan(expected)
        self.assertEqual(result["output"], expected)
        self.assertFalse(result["changed"])
        self.assertEqual(result["changedLists"], 0)

    def test_duplicate_target_and_safety_assignments_block(self):
        for key in (*p.KEYS, *p.SAFETY):
            value = p.SAFETY.get(key, "a@example.test")
            raw = SAFETY
            if key in p.KEYS:
                raw += f"{key}={value}\n".encode()
            raw += f" \t{key}='{value}' \t\n".encode()
            with self.subTest(key=key), self.assertRaisesRegex(
                    p.Block, "^DUPLICATE_TARGET_OR_SAFETY$"):
                p.plan(raw)

    def test_unicode_padding_cannot_disguise_assignments(self):
        for space in ("\u00a0", "\u2003", "\u202f", "\u3000"):
            for key in (*p.KEYS, *p.SAFETY):
                raw = SAFETY + f"{space}{key}=a@example.test\n".encode()
                with self.subTest(space=repr(space), key=key):
                    with self.assertRaisesRegex(p.Block, "^ENV_ASSIGNMENT$"):
                        p.plan(raw)

    def test_unicode_member_separators_and_padding_block(self):
        for space in ("\u00a0", "\u2003", "\u202f", "\u3000"):
            for value in (space + "a@example.test", "a@example.test" + space,
                          "a@example.test" + space + p.OPERATOR):
                raw = SAFETY + f'CRM_OPERATOR_EMAILS="{value}"\n'.encode()
                with self.subTest(value=value), self.assertRaisesRegex(
                        p.Block, "^ALLOWLIST_FORMAT$"):
                    p.plan(raw)

    def test_ambiguous_context_blocks(self):
        for extra in (b'OTHER="unfinished\nCRM_OPERATOR_EMAILS=a@b.test\n',
                      b'OTHER=x\\\nCRM_OPERATOR_EMAILS=a@b.test\n',
                      b'# comment\\\nCRM_OPERATOR_EMAILS=a@b.test\n',
                      b'export CRM_OPERATOR_EMAILS=a@b.test\n'):
            with self.subTest(extra=extra), self.assertRaises(p.Block):
                p.plan(SAFETY + extra)

    def test_invalid_utf8_and_line_boundaries_block(self):
        for extra in (b'NOTE=\xff\n', b'NOTE=x\r\n', b'NOTE=x\x00\n',
                      'NOTE=x\u2028CRM_OPERATOR_EMAILS=a@b.test\n'.encode()):
            with self.subTest(extra=extra), self.assertRaises(p.Block):
                p.plan(SAFETY + extra)


if __name__ == "__main__":
    unittest.main()
