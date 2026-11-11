"""Adversarial source-only checks of the pure c4 operator patch contract.

All settings below are synthetic bytes. No host or transport modules are used;
these tests provide no physical acceptance or witness evidence.
"""
from pathlib import Path
import sys
import unittest

# Support both direct execution and unittest discovery from the repository root.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import c4_operator_patch as patch


OPERATOR = "c4-pilot-dc194ac7e5864f7abd2752fe743a89b7@asi.local"
TARGETS = ("CRM_OPERATOR_EMAILS", "OPS_ADMIN_EMAILS")
SAFE = {
    "EMAIL_AUTO_SEND": "false",
    "EMAIL_DRAFT_ONLY": "true",
    "DRY_RUN_TELEGRAM_OUTBOUND": "true",
    "ALLOW_REAL_TELEGRAM_SYNTHETIC": "false",
    "YOOKASSA_ENABLED": "false",
    "ASI_SYNTHETIC_NO_SEND": "YES",
    "ASI_APP_ROOT": "/var/www/asi-staging/current",
}


def environment(overrides=None, omit=()):
    values = dict(SAFE)
    values.update(overrides or {})
    return "".join(f"{key}={value}\n" for key, value in values.items()
                   if key not in omit).encode("utf-8")


def assignment(key, value):
    return f'{key}="{value}"\n'.encode("utf-8")


class OperatorPatchInvariants(unittest.TestCase):
    def blocked(self, raw, reason):
        with self.assertRaises(patch.Block) as caught:
            patch.plan(raw)
        self.assertEqual(caught.exception.args, (reason,))

    def test_identical_duplicate_safety_keys_fail_closed(self):
        for key, value in SAFE.items():
            with self.subTest(key=key):
                self.blocked(environment() + assignment(key, value),
                             "DUPLICATE_TARGET_OR_SAFETY")

    def test_duplicate_targets_fail_even_when_empty_or_equivalent(self):
        for key in TARGETS:
            for first, second in (("", ""), ("A@unit.test", "a@unit.test"),
                                  (OPERATOR, OPERATOR)):
                with self.subTest(key=key, first=first):
                    raw = environment() + assignment(key, first)
                    raw += f" \t{key}='{second}' \t\n".encode()
                    self.blocked(raw, "DUPLICATE_TARGET_OR_SAFETY")

    def test_conflicting_duplicate_safety_keys_reject_both_orders(self):
        for key, value in SAFE.items():
            for first, second in ((value, "unsafe"), ("unsafe", value)):
                with self.subTest(key=key, first=first):
                    raw = environment(omit=(key,))
                    self.blocked(raw + assignment(key, first) + assignment(key, second),
                                 "DUPLICATE_TARGET_OR_SAFETY")

    def test_every_safety_key_is_required(self):
        for key in SAFE:
            with self.subTest(key=key):
                self.blocked(environment(omit=(key,)), "FILE_NO_SEND")

    def test_safety_values_require_exact_case_and_content(self):
        for key, value in SAFE.items():
            variants = (value.swapcase(), value + "x", " " + value,
                        value + " ", "", "1", "0")
            for bad in variants:
                with self.subTest(key=key, bad=bad):
                    self.blocked(environment({key: '"' + bad + '"'}), "FILE_NO_SEND")

    def test_root_path_aliases_are_not_safe(self):
        for root in ("/var/www/asi-staging/current/", "/var/www/asi-staging/./current",
                     "/var/www/asi-staging/releases/../current", "/var/www/asi/current"):
            with self.subTest(root=root):
                self.blocked(environment({"ASI_APP_ROOT": root}), "FILE_NO_SEND")

    def test_quoted_safety_lines_are_preserved_exactly(self):
        raw = b"".join(f" \t{k}='{v}'\t \n".encode() for k, v in SAFE.items())
        result = patch.plan(raw)
        expected = raw + b"".join(assignment(k, OPERATOR) for k in TARGETS)
        self.assertEqual(result["output"], expected)
        self.assertEqual(result["changedLists"], 2)
        self.assertIs(result["changed"], True)

    def test_interleaved_unrelated_bytes_survive_both_replacements(self):
        prefix = environment() + "# Синтетический комментарий\n\t\n".encode()
        middle = b'UNRELATED="spaces = # ; retained"\nUNRELATED=second\n; note\n'
        suffix = b"\tOTHER=literal$value\t\n# CRM_OPERATOR_EMAILS=decoy\n\n"
        raw = prefix + assignment(TARGETS[0], "A@unit.test;a@unit.test B@unit.test")
        raw += middle + assignment(TARGETS[1], "C@unit.test") + suffix
        result = patch.plan(raw)
        expected = prefix + assignment(TARGETS[0], "A@unit.test,B@unit.test," + OPERATOR)
        expected += middle + assignment(TARGETS[1], "C@unit.test," + OPERATOR) + suffix
        self.assertEqual(result["output"], expected)
        self.assertEqual(result["changedLists"], 2)
        self.assertEqual(result["before"], {
            TARGETS[0]: {"a@unit.test", "b@unit.test"}, TARGETS[1]: {"c@unit.test"}})
        for key in TARGETS:
            self.assertEqual(result["after"][key], result["before"][key] | {OPERATOR})
        self.assertEqual(patch.plan(expected)["output"], expected)

    def test_already_present_operator_keeps_noncanonical_line_bytes(self):
        raw = environment() + b"# keep this spacing\n"
        raw += b"".join(f" \t{k}='{OPERATOR.upper()}; A@unit.test' \t\n".encode()
                        for k in TARGETS)
        result = patch.plan(raw)
        self.assertEqual(result["output"], raw)
        self.assertIs(result["changed"], False)
        self.assertEqual(result["changedLists"], 0)
        self.assertEqual(result["before"], result["after"])

    def test_only_missing_target_is_appended(self):
        for existing in TARGETS:
            missing = next(k for k in TARGETS if k != existing)
            raw = environment() + f"\t{existing}='{OPERATOR}' \n".encode()
            raw += b"# trailing comment\n\n"
            result = patch.plan(raw)
            self.assertEqual(result["output"], raw + assignment(missing, OPERATOR))
            self.assertEqual(result["changedLists"], 1)
            self.assertEqual(result["before"][missing], set())

    def test_duplicate_operator_members_are_deduplicated_without_member_loss(self):
        raw = environment() + b"".join(
            assignment(k, f"A@unit.test;{OPERATOR.upper()} {OPERATOR},a@unit.test;B@unit.test")
            for k in TARGETS)
        result = patch.plan(raw)
        expected = environment() + b"".join(
            assignment(k, f"A@unit.test,{OPERATOR.upper()},B@unit.test") for k in TARGETS)
        self.assertEqual(result["output"], expected)
        self.assertEqual(result["changedLists"], 2)
        for key in TARGETS:
            self.assertEqual(result["after"][key], {"a@unit.test", "b@unit.test", OPERATOR})
        self.assertIs(patch.plan(expected)["changed"], False)

    def test_commented_keys_do_not_supply_required_safety(self):
        for key, value in SAFE.items():
            for marker in ("#", ";"):
                with self.subTest(key=key, marker=marker):
                    raw = environment(omit=(key,)) + f" {marker} {key}={value}\n".encode()
                    self.blocked(raw, "FILE_NO_SEND")

    def test_unrelated_escape_or_continuation_cannot_hide_a_target(self):
        for extra in (b"OTHER=continued\\\n", b"# comment\\\n",
                      b"; comment\\\n", b'OTHER="escaped\\value"\n'):
            with self.subTest(extra=extra):
                self.blocked(environment() + extra + assignment(TARGETS[0], OPERATOR),
                             "ENV_ESCAPE")


if __name__ == "__main__":
    unittest.main()
