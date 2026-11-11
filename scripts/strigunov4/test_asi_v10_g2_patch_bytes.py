"""Source-only byte-preservation regressions for the pure operator planner.

All configuration is synthetic. These tests neither invoke host adapters nor
provide physical witness evidence. Run with python3 -B on this file.
"""
import unittest

import c4_operator_patch as patcher


# Deliberately independent of SAFETY: a production default change must not
# silently change the safety fixture and the expected output together.
SAFE = (
    b"EMAIL_AUTO_SEND=false\n"
    b"EMAIL_DRAFT_ONLY=true\n"
    b"DRY_RUN_TELEGRAM_OUTBOUND=true\n"
    b"ALLOW_REAL_TELEGRAM_SYNTHETIC=false\n"
    b"YOOKASSA_ENABLED=false\n"
    b"ASI_SYNTHETIC_NO_SEND=YES\n"
    b"ASI_APP_ROOT=/var/www/asi-staging/current\n"
)
OPERATOR = b"c4-pilot-dc194ac7e5864f7abd2752fe743a89b7@asi.local"
CRM = b'CRM_OPERATOR_EMAILS="' + OPERATOR + b'"\n'
ADMIN = b'OPS_ADMIN_EMAILS="' + OPERATOR + b'"\n'


class PatchBytesTests(unittest.TestCase):
    def assert_plan(self, raw, expected, changed_lists):
        result = patcher.plan(raw)
        self.assertIs(type(result["output"]), bytes)
        self.assertEqual(result["output"], expected)
        self.assertEqual(result["changed"], raw != expected)
        self.assertEqual(result["changedLists"], changed_lists)
        for key in ("CRM_OPERATOR_EMAILS", "OPS_ADMIN_EMAILS"):
            self.assertEqual(result["after"][key],
                             result["before"][key] | {OPERATOR.decode("ascii")})
        # The exact result must itself be stable, including its formatting.
        again = patcher.plan(expected)
        self.assertEqual(again["output"], expected)
        self.assertFalse(again["changed"])
        self.assertEqual(again["changedLists"], 0)
        return result

    def assert_block(self, raw, code):
        with self.assertRaises(patcher.Block) as caught:
            patcher.plan(raw)
        self.assertEqual(caught.exception.args, (code,))

    def test_append_preserves_every_existing_byte(self):
        raw = SAFE + b'OTHER="a b = # ; $literal"  \t\nEMPTY=\n\n'
        self.assert_plan(raw, raw + CRM + ADMIN, 2)

    def test_comments_are_not_assignments(self):
        raw = (b" \t# CRM_OPERATOR_EMAILS=decoy@example.test  \t\n"
               b"; OPS_ADMIN_EMAILS=decoy@example.test\n" + SAFE
               + b"# EMAIL_AUTO_SEND=true\n; path C:\\synthetic retained\n")
        self.assert_plan(raw, raw + CRM + ADMIN, 2)

    def test_utf8_and_distinct_unicode_normalizations_survive(self):
        extra = ('# Отель 🏨 — 東京\n'
                 'PROPERTY="Санкт-Петербург / café / cafe\u0301"\n'
                 'LABEL="客室 😀 \u00a0 \u2003"\n').encode("utf-8")
        raw = SAFE + extra
        self.assert_plan(raw, raw + CRM + ADMIN, 2)

    def test_blank_lines_tabs_and_trailing_spaces_survive(self):
        raw = b"\n \t \n" + SAFE + b"\tOTHER='  a\tb  ' \t\n \t\n\n"
        self.assert_plan(raw, raw + CRM + ADMIN, 2)

    def test_only_target_lines_change_in_place(self):
        prefix = b"# before\n" + SAFE
        middle = b"\tOTHER=value  \n# between\n\n"
        suffix = b"; after\nOTHER=value-again\n"
        raw = (prefix + b" \tCRM_OPERATOR_EMAILS='Alice@example.test' \t\n"
               + middle + b"OPS_ADMIN_EMAILS=Bob@example.test\n" + suffix)
        expected = (prefix + b'CRM_OPERATOR_EMAILS="Alice@example.test,'
                    + OPERATOR + b'"\n' + middle
                    + b'OPS_ADMIN_EMAILS="Bob@example.test,' + OPERATOR
                    + b'"\n' + suffix)
        result = self.assert_plan(raw, expected, 2)
        self.assertEqual(result["before"], {
            "CRM_OPERATOR_EMAILS": {"alice@example.test"},
            "OPS_ADMIN_EMAILS": {"bob@example.test"},
        })

    def test_existing_operator_retains_noncanonical_target_bytes(self):
        raw = (SAFE + b" \tCRM_OPERATOR_EMAILS='Alice@example.test; "
               + OPERATOR.upper() + b"'  \t\n"
               + b"\tOPS_ADMIN_EMAILS=" + OPERATOR + b" \t\n")
        self.assert_plan(raw, raw, 0)

    def test_in_place_rewrite_preserves_utf8_and_whitespace_neighbors(self):
        prefix = ('# Отель 🏨 café cafe\u0301  \t\n'
                  'PROPERTY="東京\u00a0\u2003😀" \t\n').encode("utf-8")
        middle = '\tLABEL="cafe\u0301 / café"  \n\n'.encode("utf-8")
        suffix = '; Конец 🏨\u00a0  \t\nOTHER= \t\n'.encode("utf-8")
        raw = (SAFE + prefix + b"CRM_OPERATOR_EMAILS=a@example.test\n"
               + middle + b"OPS_ADMIN_EMAILS=b@example.test\n" + suffix)
        expected = (SAFE + prefix + b'CRM_OPERATOR_EMAILS="a@example.test,'
                    + OPERATOR + b'"\n' + middle
                    + b'OPS_ADMIN_EMAILS="b@example.test,' + OPERATOR
                    + b'"\n' + suffix)
        self.assert_plan(raw, expected, 2)

    def test_existing_operator_does_not_bypass_hostile_member_validation(self):
        for key in (b"CRM_OPERATOR_EMAILS", b"OPS_ADMIN_EMAILS"):
            for hostile in (b"*", b"*@example.test", b"$(command)",
                            b"$OTHER", b"not-an-email"):
                for value in (OPERATOR + b"," + hostile,
                              hostile + b";" + OPERATOR.upper()):
                    with self.subTest(key=key, value=value):
                        # Both targets already contain the operator: neither
                        # global nor per-list no-op shortcuts may skip checks.
                        raw = SAFE + CRM + ADMIN
                        original = CRM if key == b"CRM_OPERATOR_EMAILS" else ADMIN
                        raw = raw.replace(original, key + b'="' + value + b'"\n')
                        self.assert_block(raw, "ALLOWLIST_FORMAT")

    def test_conflicting_safety_overrides_fail_in_either_order(self):
        for line in SAFE.splitlines(keepends=True):
            key, safe_value = line.rstrip(b"\n").split(b"=", 1)
            unsafe_value = {b"false": b"true", b"true": b"false",
                            b"YES": b"NO"}.get(safe_value, b"/wrong/root")
            override = key + b"=" + unsafe_value + b"\n"
            for raw in (SAFE + override, override + SAFE):
                with self.subTest(key=key, raw=raw):
                    self.assert_block(raw, "DUPLICATE_TARGET_OR_SAFETY")

    def test_near_miss_safety_values_fail_closed(self):
        for line in SAFE.splitlines(keepends=True):
            key, value = line.rstrip(b"\n").split(b"=", 1)
            for altered in (value.swapcase(), b'"' + value + b' "',
                            b"' " + value + b"'", value + b" # safe"):
                with self.subTest(key=key, altered=altered):
                    self.assert_block(SAFE.replace(line, key + b"=" + altered + b"\n"),
                                      "FILE_NO_SEND")

    def test_accepted_safety_quoting_and_outer_whitespace_are_preserved(self):
        # The parser strips outer whitespace and removes balanced quotes.
        # These forms are safe by contract, but their bytes must stay intact.
        for quote in (b"", b"'", b'"'):
            raw = b"".join(
                b" \t" + key + b"=" + quote + value + quote + b" \t\n"
                for key, value in (line.split(b"=", 1)
                                   for line in SAFE.splitlines())
            )
            with self.subTest(quote=quote):
                self.assert_plan(raw, raw + CRM + ADMIN, 2)

    def test_one_missing_target_appends_after_untouched_tail(self):
        raw = SAFE + ADMIN + b"# retained tail\n\tOTHER=x \t\n"
        self.assert_plan(raw, raw + CRM, 1)

    def test_duplicate_unrelated_keys_remain_in_order(self):
        raw = SAFE + b'OTHER=first\nOTHER="second"\nOTHER=third \t\n'
        self.assert_plan(raw, raw + CRM + ADMIN, 2)

    def test_target_prefix_suffix_and_case_lookalikes_are_untouched(self):
        raw = (SAFE + b"CRM_OPERATOR_EMAILS_BACKUP=decoy@example.test\n"
               b"XOPS_ADMIN_EMAILS=decoy@example.test\n"
               b"crm_operator_emails=decoy@example.test\n")
        self.assert_plan(raw, raw + CRM + ADMIN, 2)

    def test_member_deduplication_does_not_rewrite_neighbors(self):
        raw = SAFE + b"# keep  \nCRM_OPERATOR_EMAILS=A@example.test;a@example.test\n\tOTHER=x\n"
        expected = (SAFE + b'# keep  \nCRM_OPERATOR_EMAILS="A@example.test,'
                    + OPERATOR + b'"\n\tOTHER=x\n' + ADMIN)
        self.assert_plan(raw, expected, 2)

    def test_duplicate_target_and_safety_assignments_fail_closed(self):
        for key in ("CRM_OPERATOR_EMAILS", "OPS_ADMIN_EMAILS"):
            with self.subTest(key=key):
                line = (key + "=a@example.test\n").encode()
                self.assert_block(SAFE + line + b" \t" + line,
                                  "DUPLICATE_TARGET_OR_SAFETY")
        for line in SAFE.splitlines(keepends=True):
            with self.subTest(line=line):
                self.assert_block(SAFE + line, "DUPLICATE_TARGET_OR_SAFETY")

    def test_missing_or_unsafe_safety_values_fail_closed(self):
        for line in SAFE.splitlines(keepends=True):
            with self.subTest(line=line):
                self.assert_block(SAFE.replace(line, b""), "FILE_NO_SEND")
                key = line.split(b"=", 1)[0]
                self.assert_block(SAFE.replace(line, key + b"=unsafe\n"),
                                  "FILE_NO_SEND")

    def test_continuation_and_quote_smuggling_fail_closed(self):
        cases = (
            (b"OTHER=value\\\nCRM_OPERATOR_EMAILS=a@example.test\n", "ENV_ESCAPE"),
            (b"# comment \\\nCRM_OPERATOR_EMAILS=a@example.test\n", "ENV_ESCAPE"),
            (b"; comment \\ \t\n", "ENV_ESCAPE"),
            (b'OTHER="unfinished\nCRM_OPERATOR_EMAILS=a@example.test\n', "ENV_QUOTING"),
            (b"OTHER=un'quoted\n", "ENV_QUOTING"),
            (b'OTHER="a"b"\n', "ENV_QUOTING"),
            (b"export CRM_OPERATOR_EMAILS=a@example.test\n", "ENV_ASSIGNMENT"),
        )
        for extra, code in cases:
            with self.subTest(extra=extra):
                self.assert_block(SAFE + extra, code)

    def test_invalid_utf8_controls_and_line_separators_fail_closed(self):
        for value in (b"\xff", b"\xc0\xaf", b"\xed\xa0\x80", b"\xf0\x9f"):
            with self.subTest(value=value):
                self.assert_block(SAFE + b"OTHER=" + value + b"\n", "ENV_ENCODING")
        for value in (b"\x01", b"\x0b", b"\x0c", b"\x1f",
                      "\u0085".encode(), "\u2028".encode(), "\u2029".encode()):
            with self.subTest(value=value):
                self.assert_block(SAFE + b"OTHER=" + value + b"\n", "ENV_CONTROL")
        for extra in (b"OTHER=a\0b\n", b"OTHER=x\r\n"):
            with self.subTest(extra=extra):
                self.assert_block(SAFE + extra, "ENV_FORMAT")

    def test_allowlist_injection_and_wildcards_fail_closed(self):
        for key in (b"CRM_OPERATOR_EMAILS", b"OPS_ADMIN_EMAILS"):
            for value in (b"*", b"*@example.test", b"a@example.test,$OTHER",
                          b"$(command)", b"a@example.test;not-an-email"):
                with self.subTest(key=key, value=value):
                    self.assert_block(SAFE + key + b"=" + value + b"\n",
                                      "ALLOWLIST_FORMAT")

    def test_input_type_size_line_and_member_limits_fail_closed(self):
        for raw in (None, "synthetic", bytearray(SAFE), b"", b"x" * 131073):
            with self.subTest(kind=type(raw).__name__):
                self.assert_block(raw, "ENV_SIZE")
        self.assert_block(SAFE[:-1], "ENV_FORMAT")
        self.assert_block(SAFE + b"\n" * 2500, "ENV_LINES")
        self.assert_block(SAFE + b"CRM_OPERATOR_EMAILS=" + b"a" * 16385 + b"\n",
                          "ALLOWLIST_SIZE")


if __name__ == "__main__":
    unittest.main()
