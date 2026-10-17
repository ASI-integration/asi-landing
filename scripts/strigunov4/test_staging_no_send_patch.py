"""Synthetic, credential-free checks for the single-flag staging patch."""
import hashlib
import unittest

import staging_no_send_patch as m


class PatchTests(unittest.TestCase):
    BASE = (
        b"# safe existing config\n"
        b"EMAIL_AUTO_SEND=false\n"
        b"EMAIL_DRAFT_ONLY=true\n"
        b"DRY_RUN_TELEGRAM_OUTBOUND=true\n"
        b"ALLOW_REAL_TELEGRAM_SYNTHETIC=false\n"
        b"YOOKASSA_ENABLED=false\n"
        b"ASI_APP_ROOT=/var/www/asi-staging/current\n"
        b"STAGING_PRIVATE_EXAMPLE='never-print-this-value'\n"
    )

    def test_append_exactly_one_line(self):
        result = m.plan(self.BASE)
        self.assertTrue(result["changed"])
        self.assertEqual(result["output"], self.BASE + m.FLAG)
        self.assertEqual(result["bytes_written"], len(m.FLAG))
        self.assertEqual(
            result["output_sha256"],
            hashlib.sha256(self.BASE + m.FLAG).hexdigest(),
        )
        self.assertNotIn("never-print-this-value", str({
            k: v for k, v in result.items() if k != "output"
        }))

    def test_idempotent_exact_yes(self):
        added = m.plan(self.BASE)["output"]
        next_plan = m.plan(added)
        self.assertFalse(next_plan["changed"])
        self.assertEqual(next_plan["output"], added)

    def test_comments_do_not_count_as_active_key(self):
        original = self.BASE + b"# ASI_SYNTHETIC_NO_SEND=NO\n"
        self.assertEqual(m.plan(original)["output"], original + m.FLAG)

    def test_wrong_value_rejected(self):
        for value in (b"NO", b"FALSE", b"yes", b'"YES"', b"", b"1"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(m.Block, "CONFLICTING"):
                    m.plan(self.BASE + b"ASI_SYNTHETIC_NO_SEND=" + value + b"\n")

    def test_duplicate_rejected(self):
        with self.assertRaisesRegex(m.Block, "DUPLICATE"):
            m.plan(self.BASE + m.FLAG + m.FLAG)

    def test_export_prefix_rejected_if_present(self):
        with self.assertRaisesRegex(m.Block, "CONFLICTING"):
            m.plan(self.BASE + b"export ASI_SYNTHETIC_NO_SEND=YES\n")

    def test_ambiguous_name_rejected(self):
        with self.assertRaisesRegex(m.Block, "CONFLICTING"):
            m.plan(self.BASE + b"ASI_SYNTHETIC_NO_SEND FALSE\n")

    def test_other_key_is_not_changed(self):
        original = self.BASE + b"ASI_SYNTHETIC_NO_SEND_EXTRA=false\n"
        result = m.plan(original)
        self.assertEqual(result["output"], original + m.FLAG)

    def test_never_truncate_secret_bytes(self):
        raw = self.BASE + b"PASSWORD_WITH_QUOTES=foo#' =!@%^&* / \\\\ \n"
        self.assertEqual(m.plan(raw)["output"], raw + m.FLAG)

    def test_crlf_rejected(self):
        with self.assertRaisesRegex(m.Block, "UNSAFE_FILE_FORMAT"):
            m.plan(self.BASE.replace(b"\n", b"\r\n"))

    def test_nul_rejected(self):
        with self.assertRaisesRegex(m.Block, "UNSAFE_FILE_FORMAT"):
            m.plan(self.BASE + b"A=B\0\n")

    def test_missing_final_newline_rejected(self):
        with self.assertRaisesRegex(m.Block, "UNSAFE_FILE_FORMAT"):
            m.plan(self.BASE.rstrip(b"\n"))

    def test_continuation_at_eof_rejected(self):
        with self.assertRaisesRegex(m.Block, "UNTERMINATED_CONTINUATION"):
            m.plan(self.BASE + b"KEY=partial\\\n")

    def test_empty_and_oversize_rejected(self):
        for raw in (b"", b"A" * 131073):
            with self.subTest(length=len(raw)):
                with self.assertRaisesRegex(m.Block, "INVALID_FILE_SIZE"):
                    m.plan(raw)

    def test_input_type_rejected(self):
        with self.assertRaisesRegex(m.Block, "INVALID_FILE_SIZE"):
            m.plan("ASI_SYNTHETIC_NO_SEND=YES\n")


if __name__ == "__main__":
    unittest.main()
