"""Offline byte-fidelity regressions for the pure C4 operator patch planner."""
import unittest

import c4_operator_patch as patch


def safety_bytes():
    """Use deliberately noncanonical whitespace around valid safety settings."""
    return "".join(
        f'\t{key}="{value}"  \t\n' for key, value in patch.SAFETY.items()
    ).encode("utf-8")


UNRELATED = (
    '\t# Примечание: ёж, café, e\u0301, 🏨  \t\n'
    '; CRM_OPERATOR_EMAILS=comment@example.test\t\n'
    '\n \t \n'
    'TITLE="Отель = # уют ; 東京"  \t\n'
    "LABEL='café и чай'\n"
    'REPEATED=первое\nREPEATED=второе\n'
).encode("utf-8")


class PatchByteFidelityTests(unittest.TestCase):
    def test_updates_only_target_lines_among_utf8_comments_and_whitespace(self):
        prefix = safety_bytes() + UNRELATED
        middle = '\t; Между списками 🏨\t \nOTHER="  пробелы  "\n'.encode()
        suffix = '\n# Конец  \t\n'.encode()
        raw = (prefix + b'  CRM_OPERATOR_EMAILS="Alice@example.test; Bob@example.test" \t\n'
               + middle + b"\tOPS_ADMIN_EMAILS='Admin@example.test'  \n" + suffix)
        result = patch.plan(raw)
        expected = (
            prefix
            + f'CRM_OPERATOR_EMAILS="Alice@example.test,Bob@example.test,{patch.OPERATOR}"\n'.encode()
            + middle
            + f'OPS_ADMIN_EMAILS="Admin@example.test,{patch.OPERATOR}"\n'.encode()
            + suffix
        )
        self.assertEqual(result["output"], expected)
        self.assertTrue(result["changed"])
        self.assertEqual(result["changedLists"], 2)
        self.assertEqual(result["before"], {
            "CRM_OPERATOR_EMAILS": {"alice@example.test", "bob@example.test"},
            "OPS_ADMIN_EMAILS": {"admin@example.test"},
        })
        for key in patch.KEYS:
            self.assertEqual(result["after"][key], result["before"][key] | {patch.OPERATOR})
        again = patch.plan(expected)
        self.assertEqual(again["output"], expected)
        self.assertFalse(again["changed"])
        self.assertEqual(again["changedLists"], 0)

    def test_existing_operator_preserves_noncanonical_target_bytes(self):
        raw = safety_bytes() + UNRELATED + (
            f" \tCRM_OPERATOR_EMAILS='First@example.test ; {patch.OPERATOR.upper()}' \t\n"
            f'\tOPS_ADMIN_EMAILS="{patch.OPERATOR}\t admin@example.test"  \n'
        ).encode()
        lines, values, positions = patch.decode(raw)
        self.assertEqual("".join(lines).encode(), raw)
        for key in patch.KEYS:
            self.assertTrue(lines[positions[key]].lstrip().startswith(key + "="))
            self.assertIn(patch.OPERATOR, {x.lower() for x in patch.members(values[key])})
        result = patch.plan(raw)
        self.assertEqual(result["output"], raw)
        self.assertFalse(result["changed"])
        self.assertEqual(result["changedLists"], 0)
        self.assertEqual(result["before"], result["after"])

    def test_missing_targets_append_after_exact_original_bytes(self):
        raw = safety_bytes() + UNRELATED
        expected = raw + "".join(
            f'{key}="{patch.OPERATOR}"\n' for key in patch.KEYS
        ).encode()
        result = patch.plan(raw)
        self.assertEqual(result["output"], expected)
        self.assertEqual(result["changedLists"], 2)
        self.assertTrue(result["changed"])
        self.assertEqual(result["before"], dict.fromkeys(patch.KEYS, set()))
        self.assertEqual(result["after"], {key: {patch.OPERATOR} for key in patch.KEYS})

    def test_duplicate_target_and_safety_assignments_fail_closed(self):
        for key in (*patch.KEYS, *patch.SAFETY):
            value = patch.SAFETY.get(key, "a@example.test")
            raw = safety_bytes() + UNRELATED
            if key in patch.KEYS:
                raw += f'{key}="{value}"\n'.encode()
            # An identical duplicate is still ambiguous, even with indentation.
            raw += f" \t{key}='{value}'  \n".encode()
            with self.subTest(key=key):
                with self.assertRaisesRegex(patch.Block, "^DUPLICATE_TARGET_OR_SAFETY$"):
                    patch.plan(raw)

    def test_ambiguous_unrelated_syntax_is_rejected_before_editing(self):
        cases = (
            (b'NOTE="unfinished\n', "ENV_QUOTING"),
            (b'NOTE=prefix\\\n', "ENV_ESCAPE"),
            (b'  # comment\\  \n', "ENV_ESCAPE"),
            (b'\t; comment\\\n', "ENV_ESCAPE"),
            (b'export NOTE=value\n', "ENV_ASSIGNMENT"),
            ('NOTE=before\u2028CRM_OPERATOR_EMAILS=x@example.test\n'.encode(), "ENV_CONTROL"),
            (b'NOTE=\xff\n', "ENV_ENCODING"),
        )
        for extra, reason in cases:
            with self.subTest(extra=extra):
                with self.assertRaisesRegex(patch.Block, f"^{reason}$"):
                    patch.plan(safety_bytes() + UNRELATED + extra)

    def test_inline_target_comments_are_not_silently_discarded(self):
        for value, reason in (
            ('"a@example.test" # сохранить', "ENV_QUOTING"),
            ('a@example.test # сохранить', "ALLOWLIST_FORMAT"),
        ):
            raw = safety_bytes() + UNRELATED + f'CRM_OPERATOR_EMAILS={value}\n'.encode()
            with self.subTest(value=value):
                with self.assertRaisesRegex(patch.Block, f"^{reason}$"):
                    patch.plan(raw)


if __name__ == "__main__":
    unittest.main()
