"""Synthetic unit checks for the pure S4-G2 operator EnvironmentFile plan."""
import unittest

import c4_operator_patch as operator_patch


EXPECTED_SAFETY = {
    "EMAIL_AUTO_SEND": "false",
    "EMAIL_DRAFT_ONLY": "true",
    "DRY_RUN_TELEGRAM_OUTBOUND": "true",
    "ALLOW_REAL_TELEGRAM_SYNTHETIC": "false",
    "YOOKASSA_ENABLED": "false",
    "ASI_SYNTHETIC_NO_SEND": "YES",
    "ASI_APP_ROOT": "/var/www/asi-staging/current",
}
EXPECTED_ALLOWLISTS = ("CRM_OPERATOR_EMAILS", "OPS_ADMIN_EMAILS")


def environment_bytes(extra=b""):
    return b"".join(
        f"{key}={value}\n".encode("utf-8")
        for key, value in EXPECTED_SAFETY.items()
    ) + extra


class OperatorPlanIdentityTests(unittest.TestCase):
    def test_all_seven_safety_values_remain_enforced_and_unchanged(self):
        self.assertEqual(operator_patch.SAFETY, EXPECTED_SAFETY)
        self.assertEqual(len(operator_patch.SAFETY), 7)
        raw = environment_bytes(
            b'CRM_OPERATOR_EMAILS="c4-pilot-dc194ac7e5864f7abd2752fe743a89b7@asi.local"\n'
            b'OPS_ADMIN_EMAILS="c4-pilot-dc194ac7e5864f7abd2752fe743a89b7@asi.local"\n'
        )

        result = operator_patch.plan(raw)

        self.assertEqual(result["output"], raw)
        self.assertFalse(result["changed"])
        for key, value in EXPECTED_SAFETY.items():
            with self.subTest(key=key):
                self.assertEqual(
                    result["output"].count(f"{key}={value}\n".encode("utf-8")),
                    1,
                )

    def test_exactly_two_allowlists_gain_the_fixed_synthetic_operator(self):
        self.assertEqual(operator_patch.KEYS, EXPECTED_ALLOWLISTS)
        result = operator_patch.plan(
            environment_bytes(b"UNRELATED_EMAILS=observer@example.invalid\n")
        )

        self.assertEqual(set(result["after"]), set(EXPECTED_ALLOWLISTS))
        self.assertEqual(
            sum(
                operator_patch.OPERATOR in result["after"][key]
                for key in result["after"]
            ),
            2,
        )
        self.assertEqual(result["changedLists"], 2)
        self.assertIn(b"UNRELATED_EMAILS=observer@example.invalid\n", result["output"])

    def test_unrelated_bytes_are_preserved_and_plan_is_idempotent(self):
        raw = environment_bytes(
            b'# retained comment\nSECRET="opaque bytes = stay # exact"\n\n'
            b"UNRELATED_FLAG=keep-me\n"
        )
        expected_addition = b"".join(
            f'{key}="{operator_patch.OPERATOR}"\n'.encode("utf-8")
            for key in EXPECTED_ALLOWLISTS
        )

        first = operator_patch.plan(raw)
        second = operator_patch.plan(first["output"])

        self.assertEqual(first["output"], raw + expected_addition)
        self.assertEqual(second["output"], first["output"])
        self.assertFalse(second["changed"])
        self.assertEqual(second["changedLists"], 0)

    def test_invalid_safety_values_fail_closed(self):
        raw = environment_bytes()
        for key, value in EXPECTED_SAFETY.items():
            with self.subTest(key=key):
                invalid = raw.replace(
                    f"{key}={value}\n".encode("utf-8"),
                    f"{key}=unsafe\n".encode("utf-8"),
                )
                with self.assertRaisesRegex(operator_patch.Block, "^FILE_NO_SEND$"):
                    operator_patch.plan(invalid)

    def test_absent_safety_values_fail_closed(self):
        raw = environment_bytes()
        for key, value in EXPECTED_SAFETY.items():
            with self.subTest(key=key):
                absent = raw.replace(f"{key}={value}\n".encode("utf-8"), b"")
                with self.assertRaisesRegex(operator_patch.Block, "^FILE_NO_SEND$"):
                    operator_patch.plan(absent)


if __name__ == '__main__':
    unittest.main()
