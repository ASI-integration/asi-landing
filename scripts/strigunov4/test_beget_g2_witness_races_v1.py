"""Offline concurrency checks for the pure C4 operator patch planner."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import unittest


HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import c4_operator_patch as patch


EXPECTED_OPERATOR = "c4-pilot-dc194ac7e5864f7abd2752fe743a89b7@asi.local"


def safety_bytes():
    return b"".join(
        f"{key}={value}\n".encode("utf-8")
        for key, value in patch.SAFETY.items()
    )


def safe_snapshot(extra=b""):
    return safety_bytes() + extra


def allowlist_line(key, members):
    return f'{key}="{",".join(members)}"\n'.encode("ascii")


def blocked_code(raw):
    try:
        patch.plan(raw)
    except patch.Block as error:
        return str(error)
    return None


class OperatorPlanRaceTests(unittest.TestCase):
    def test_parallel_plans_preserve_all_seven_safety_flags(self):
        self.assertEqual(len(patch.SAFETY), 7)
        snapshots = tuple(
            safe_snapshot(f"UNRELATED_MARKER=snapshot-{index}\n".encode("ascii"))
            for index in range(32)
        )

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(patch.plan, snapshots))

        appended = b"".join(
            allowlist_line(key, (patch.OPERATOR,)) for key in patch.KEYS
        )
        for index, (snapshot, result) in enumerate(zip(snapshots, results)):
            with self.subTest(snapshot=index):
                self.assertEqual(result["output"], snapshot + appended)
                _, values, _ = patch.decode(result["output"])
                self.assertEqual(
                    {key: values[key] for key in patch.SAFETY}, patch.SAFETY
                )
                for key, value in patch.SAFETY.items():
                    assignment = f"{key}={value}\n".encode("utf-8")
                    self.assertEqual(result["output"].count(assignment), 1)

    def test_parallel_independent_snapshots_patch_exactly_two_allowlists(self):
        self.assertEqual(patch.KEYS, ("CRM_OPERATOR_EMAILS", "OPS_ADMIN_EMAILS"))
        self.assertEqual(patch.OPERATOR, EXPECTED_OPERATOR)
        snapshots = tuple(
            safe_snapshot(
                (
                    f"SNAPSHOT_ID={index}\n"
                    f"CRM_OPERATOR_EMAILS=crm-{index}@example.invalid\n"
                    f"OPS_ADMIN_EMAILS=ops-{index}@example.invalid\n"
                ).encode("ascii")
            )
            for index in range(24)
        )

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(patch.plan, snapshots))

        for index, (snapshot, result) in enumerate(zip(snapshots, results)):
            crm = f"crm-{index}@example.invalid"
            ops = f"ops-{index}@example.invalid"
            expected = safe_snapshot(f"SNAPSHOT_ID={index}\n".encode("ascii"))
            expected += allowlist_line(patch.KEYS[0], (crm, patch.OPERATOR))
            expected += allowlist_line(patch.KEYS[1], (ops, patch.OPERATOR))
            with self.subTest(snapshot=index):
                self.assertNotEqual(snapshot, expected)
                self.assertEqual(result["output"], expected)
                _, values, _ = patch.decode(result["output"])
                self.assertEqual(
                    patch.members(values[patch.KEYS[0]]), [crm, EXPECTED_OPERATOR]
                )
                self.assertEqual(
                    patch.members(values[patch.KEYS[1]]), [ops, EXPECTED_OPERATOR]
                )
                containing_operator = tuple(
                    key
                    for key in patch.KEYS
                    if patch.OPERATOR in {
                        member.lower() for member in patch.members(values[key])
                    }
                )
                self.assertEqual(containing_operator, patch.KEYS)
                self.assertEqual(
                    result["output"].count(patch.OPERATOR.encode("ascii")), 2
                )
                self.assertEqual(result["changedLists"], 2)

    def test_same_input_is_byte_deterministic_preserving_and_idempotent(self):
        prefix = safe_snapshot(
            b"# retained before CRM\n"
            b"UNRELATED_ONE=retained-value\n"
        )
        between = b"\n; retained between lists\nUNRELATED_TWO=keep-this-too\n"
        suffix = b"# retained after OPS\n"
        raw = (
            prefix
            + b"CRM_OPERATOR_EMAILS=existing@example.invalid\n"
            + between
            + b"OPS_ADMIN_EMAILS=admin@example.invalid\n"
            + suffix
        )
        expected = (
            prefix
            + allowlist_line(
                patch.KEYS[0], ("existing@example.invalid", patch.OPERATOR)
            )
            + between
            + allowlist_line(
                patch.KEYS[1], ("admin@example.invalid", patch.OPERATOR)
            )
            + suffix
        )

        with ThreadPoolExecutor(max_workers=12) as pool:
            first_pass = list(pool.map(patch.plan, (raw,) * 48))

        self.assertTrue(all(result["output"] == expected for result in first_pass))
        self.assertTrue(all(result["changedLists"] == 2 for result in first_pass))

        with ThreadPoolExecutor(max_workers=12) as pool:
            second_pass = list(pool.map(patch.plan, (expected,) * 48))

        self.assertTrue(all(result["output"] == expected for result in second_pass))
        self.assertTrue(all(not result["changed"] for result in second_pass))
        self.assertTrue(all(result["changedLists"] == 0 for result in second_pass))

    def test_invalid_absent_or_stale_safety_flags_fail_closed_in_parallel(self):
        cases = []
        base = safe_snapshot(b"UNRELATED=retained\n")
        for index, (key, value) in enumerate(patch.SAFETY.items()):
            assignment = f"{key}={value}\n".encode("utf-8")
            cases.extend(
                (
                    (f"{key}:invalid", base.replace(
                        assignment, f"{key} invalid\n".encode("utf-8")
                    ), "ENV_ASSIGNMENT"),
                    (f"{key}:absent", base.replace(assignment, b""), "FILE_NO_SEND"),
                    (f"{key}:stale", base.replace(
                        assignment, f"{key}=stale-value-{index}\n".encode("utf-8")
                    ), "FILE_NO_SEND"),
                )
            )

        tasks = tuple(cases) * 3
        with ThreadPoolExecutor(max_workers=12) as pool:
            outcomes = list(pool.map(blocked_code, (raw for _, raw, _ in tasks)))

        self.assertEqual(len(outcomes), len(tasks))
        for task_index, ((label, _, expected_code), actual_code) in enumerate(
            zip(tasks, outcomes)
        ):
            with self.subTest(task=task_index, case=label):
                self.assertEqual(actual_code, expected_code)


if __name__ == "__main__":
    unittest.main()
