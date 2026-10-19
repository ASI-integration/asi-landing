"""Synthetic EnvironmentFiles distinctions; no host credentials or staging access."""
import json
import unittest
from unittest.mock import patch

import c4_operator_host as host
import c4_operator_observer as observer
import protected_c4_operator_observer as gate
import c4_operator_patch as planner
from c4_operator_patch import KEYS, SAFETY
from test_c4_operator_host import LiveContractTests

# Fixed, non-secret analogue of the already-consumed operator observer receipt.
BASE = {
    "backup": "NOT_OBSERVED",
    "claim": "ABSENT",
    "databaseState": "NOT_OBSERVED",
    "envPlan": "CHANGE_NEEDED",
    "environmentFiles": "EXPECTED_PATH_OTHER_FORMAT",
    "historicalWrite": "UNKNOWN",
    "incidentRun": observer.FAILED_RUN,
    "live": "BLOCK_REASON_ENVIRONMENT_FILES",
    "lock": "VALID_METADATA_NO_HOLDER_OBSERVED",
    "membership": "NOT_OBSERVED",
    "prepared": "NOT_OBSERVED",
    "recovery": "NOT_OBSERVED",
    "replayAllowed": False,
    "snapshot": "NON_ATOMIC_CURRENT_ONLY",
    "status": "C4_OPERATOR_OBSERVED",
    "success": "NOT_OBSERVED",
}


class EnvironmentContractTests(unittest.TestCase):
    def observed(self, value):
        markers = {key: BASE[key] for key in (*observer.FIELDS, "lock")}
        with patch.object(observer, "identity"), \
             patch.object(observer, "claim_snapshot", return_value=markers), \
             patch.object(host.io, "props", return_value={"EnvironmentFiles": value}), \
             patch.object(host, "live", side_effect=planner.Block("ENVIRONMENT_FILES")), \
             patch.object(host.io, "read_env", return_value=(b"synthetic", None)), \
             patch.object(observer, "plan", return_value={"changed": True}):
            result = observer.observe()
        self.assertEqual(result["live"], "BLOCK_REASON_ENVIRONMENT_FILES")
        self.assertEqual(result["membership"], "NOT_OBSERVED")
        self.assertEqual(result["historicalWrite"], "UNKNOWN")
        self.assertIs(result["replayAllowed"], False)
        return result

    def test_observed_receipt_not_promoted_to_host_pass(self):
        self.assertEqual(gate.decode(json.dumps(BASE).encode(), 0), BASE)
        self.assertNotEqual(BASE["live"], "PASS")
        self.assertEqual(BASE["claim"], "ABSENT")
        self.assertEqual(BASE["backup"], "NOT_OBSERVED")

    def test_optional_envfile_reported_but_not_admitted(self):
        report = self.observed(str(host.io.ENV) + " (ignore_errors=yes)")
        self.assertEqual(report["environmentFiles"], "EXACT_EXPECTED_OPTIONAL")

    def test_path_only_reported_but_not_admitted(self):
        report = self.observed(str(host.io.ENV))
        self.assertEqual(report["environmentFiles"], "EXPECTED_PATH_ONLY")

    def test_ambiguous_path_not_classified_as_optional(self):
        expected = str(host.io.ENV)
        for value in (expected + " (ignore_errors=yes) /synthetic/extra",
                      "prefix" + expected + " (ignore_errors=yes)",
                      expected + " (ignore_errors=no) /synthetic/extra",
                      expected + "  (ignore_errors=yes)",
                      expected + " (ignore_errors=yes) ",
                      expected + ".backup"):
            with self.subTest(value=value):
                report = self.observed(value)
                self.assertEqual(report["environmentFiles"], "EXPECTED_PATH_OTHER_FORMAT")
                self.assertNotIn("/synthetic/extra", json.dumps(report))

    def test_decoder_accepts_only_two_new_fixed_states(self):
        for state in ("EXACT_EXPECTED_OPTIONAL", "EXPECTED_PATH_ONLY"):
            with self.subTest(state=state):
                receipt = dict(BASE, environmentFiles=state)
                self.assertEqual(gate.decode(json.dumps(receipt).encode(), 0), receipt)
        for state in (str(host.io.ENV), "ignore_errors=yes", "EXACT_EXPECTED_OPTIONAL ", True):
            with self.subTest(state=state), self.assertRaises(gate.transport.RemoteOutcome):
                gate.decode(json.dumps(dict(BASE, environmentFiles=state)).encode(), 0)

    def test_duplicate_systemd_properties_still_rejected(self):
        for key in ("EnvironmentFiles", "User", "DropInPaths"):
            raw = (key + "=first\n" + key + "=second\n").encode()
            with self.subTest(key=key), patch.object(host.io, "checked", return_value=raw):
                with self.assertRaisesRegex(planner.Block, "DUPLICATE_SYSTEMD_PROPERTY"):
                    host.io.props()

    def test_live_gate_still_rejects_optional_and_extra(self):
        fixture = LiveContractTests("test_full_effective_contract_and_get_only")
        fixture.setUp()
        try:
            expected = str(fixture.env)
            for value in (expected + " (ignore_errors=yes)", expected,
                          expected + " (ignore_errors=no) /synthetic/extra"):
                fixture.meta["EnvironmentFiles"] = value
                with self.subTest(value=value), self.assertRaisesRegex(
                        planner.Block, "ENVIRONMENT_FILES"):
                    fixture.live()
            fixture.conn.assert_not_called()
            fixture.meta["EnvironmentFiles"] = expected + " (ignore_errors=no)"
            fixture.live()
            self.assertEqual([c.args[0] for c in fixture.conn.return_value.request.call_args_list],
                             ["GET", "GET"])
        finally:
            fixture.doCleanups()

    def test_change_needed_not_proof_operator_missing(self):
        prefix = "".join(k + "=" + v + "\n" for k, v in SAFETY.items())
        raw = (prefix + "".join(k + "=" + planner.OPERATOR + "," + planner.OPERATOR
                                + "\n" for k in KEYS)).encode()
        proposal = planner.plan(raw)
        self.assertTrue(proposal["changed"])
        self.assertTrue(all(planner.OPERATOR in proposal["before"][k] for k in KEYS))


if __name__ == "__main__":
    unittest.main()
