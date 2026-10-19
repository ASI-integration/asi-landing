"""Offline policy-only tests. No host commands, protected workflow or real keys."""
import copy
import unittest

import c4_unit_contract as c
import c4_unit_repair_phase_contract as g


def receipt():
    return {
        "status": "C4_UNIT_OBSERVED", "incidentRun": c.INCIDENT,
        "sourceSha": g.RECEIPT_SOURCE, "runId": g.RECEIPT_RUN,
        "beforeSha256": g.OLD, "afterSha256": g.NEW,
        "unitBytes": 454, "removedBytes": 1,
        "planState": "REMOVE_ONE_OPTIONAL_BYTE",
        "environmentFiles": "EXACT_EXPECTED_OPTIONAL",
        "needDaemonReload": "no", "metadata": "ROOT_CONTROLLED_SINGLE_LINK",
        "process": "STABLE_ACROSS_TWO_READS", "rawUnitExported": False,
        "serverWrites": False, "replayAllowed": False,
        "historicalWrite": "UNKNOWN", "snapshot": "NON_ATOMIC_CURRENT_ONLY"
    }


def snapshot(phase):
    return {
        "unitSha256": g.OLD if phase == "OLD" else g.NEW,
        "environmentFiles": "optional" if phase == "OLD" else "mandatory",
        "processToken": "b" * 64,
        "otherStateToken": "c" * 64,
        "noSend": True,
        "health": True
    }


class TransitionPolicyTests(unittest.TestCase):
    def test_01_exact_real_receipt_binding(self):
        self.assertEqual(g.verified_receipt(receipt())["afterSha256"], g.NEW)

    def test_02_old_admission_independent_of_new_only_guards(self):
        self.assertEqual(g.phase(snapshot("OLD"), "OLD")["unitSha256"], g.OLD)
        with self.assertRaises(c.Block):
            g.phase(snapshot("OLD"), "NEW")

    def test_03_strict_forward_transition(self):
        self.assertEqual(g.transition(receipt(), snapshot("OLD"), snapshot("NEW")),
                         "OFFLINE_PHASE_CONTRACT_PASS")

    def test_04_wrong_receipt_and_replay_fail_closed(self):
        for key, bad in (
            ("runId", "99999"), ("sourceSha", "d" * 40),
            ("beforeSha256", "a" * 64), ("afterSha256", "a" * 64),
            ("removedBytes", 0), ("unitBytes", 453),
            ("planState", "ALREADY_MANDATORY_ON_DISK"),
            ("replayAllowed", True), ("historicalWrite", "ABSENT"),
            ("needDaemonReload", "yes")
        ):
            v = dict(receipt(), **{key: bad})
            with self.subTest(key=key), self.assertRaises(c.Block):
                g.verified_receipt(v)

    def test_05_wrong_old_phase_refused(self):
        for key, value in (
            ("unitSha256", g.NEW), ("environmentFiles", "mandatory"),
            ("noSend", False), ("health", False), ("health", 1),
            ("processToken", "unknown"), ("otherStateToken", "")
        ):
            v = dict(snapshot("OLD"), **{key: value})
            with self.subTest(key=key), self.assertRaises(c.Block):
                g.phase(v, "OLD")

    def test_06_wrong_new_phase_refused(self):
        for key, value in (
            ("unitSha256", g.OLD), ("environmentFiles", "optional"),
            ("noSend", None), ("processToken", None),
            ("health", "true"), ("otherStateToken", "z" * 64)
        ):
            v = dict(snapshot("NEW"), **{key: value})
            with self.subTest(key=key), self.assertRaises(c.Block):
                g.phase(v, "NEW")

    def test_07_changed_process_or_other_manager_state_refused(self):
        for key in ("processToken", "otherStateToken"):
            new = dict(snapshot("NEW"), **{key: "e" * 64})
            with self.subTest(key=key), self.assertRaisesRegex(c.Block, "PROCESS_CHANGED"):
                g.transition(receipt(), snapshot("OLD"), new)

    def test_08_snapshot_schema_and_direction_refused(self):
        for v in (dict(snapshot("OLD"), unknown="x"),
                  {k: val for k, val in snapshot("OLD").items() if k != "health"}):
            with self.assertRaises(c.Block):
                g.phase(v, "OLD")
        with self.assertRaises(c.Block):
            g.phase(snapshot("OLD"), "unknown")


if __name__ == "__main__":
    unittest.main()
