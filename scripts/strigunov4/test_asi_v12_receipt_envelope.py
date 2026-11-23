"""Deterministic receipt parsing/binding regressions; no crypto or network calls."""
import json
import unittest

import c4_unit_contract as contract
import c4_unit_receipt_envelope as envelope


SHA = "a" * 40
RUN = "123456789"


def receipt(sha=SHA, run=RUN):
    """Synthetic observation, never evidence for an actual host or workflow run."""
    return {
        "status": "C4_UNIT_OBSERVED",
        "incidentRun": contract.INCIDENT,
        "sourceSha": sha,
        "runId": run,
        "beforeSha256": contract.OLD_UNIT_SHA256,
        "afterSha256": "b" * 64,
        "rawUnitExported": False,
        "serverWrites": False,
        "replayAllowed": False,
        "historicalWrite": "UNKNOWN",
        "snapshot": "NON_ATOMIC_CURRENT_ONLY",
        "metadata": "ROOT_CONTROLLED_SINGLE_LINK",
        "process": "STABLE_ACROSS_TWO_READS",
        "unitBytes": 454,
        "removedBytes": 1,
        "planState": "REMOVE_ONE_OPTIONAL_BYTE",
        "environmentFiles": "EXACT_EXPECTED_OPTIONAL",
        "needDaemonReload": "yes",
    }


class ReceiptEnvelopeTests(unittest.TestCase):
    def test_valid_receipt_roundtrip_is_canonical_and_order_independent(self):
        value = receipt()
        raw = envelope.canonical(contract.strict_json(json.dumps(value)), SHA, RUN)
        self.assertEqual(raw, json.dumps(value, sort_keys=True,
                                        separators=(",", ":")).encode("ascii"))
        self.assertEqual(contract.strict_json(raw), value)
        self.assertEqual(envelope.canonical(dict(reversed(list(value.items()))),
                                            SHA, RUN), raw)

    def test_malformed_json_is_rejected_by_real_parser(self):
        for raw in (b"", b'{"runId":', b'{"runId":"123",}',
                    b'{} {}', b'{"runId":"\xff"}', b'{"unitBytes":NaN}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                contract.strict_json(raw)

    def test_every_required_field_is_enforced(self):
        for field in receipt():
            value = receipt()
            del value[field]
            with self.subTest(field=field), self.assertRaisesRegex(
                    contract.Block, "^FORMAT$"):
                envelope.canonical(contract.strict_json(json.dumps(value)), SHA, RUN)

    def test_duplicate_keys_cannot_hide_conflicting_or_identical_values(self):
        raw = json.dumps(receipt(), separators=(",", ":")).encode("ascii")
        for field, value in (("runId", RUN), ("runId", "987654321"),
                             ("sourceSha", "c" * 40), ("serverWrites", True)):
            duplicate = (raw[:-1] + b"," + json.dumps(field).encode("ascii")
                         + b":" + json.dumps(value).encode("ascii") + b"}")
            with self.subTest(field=field, value=value), self.assertRaisesRegex(
                    ValueError, "^duplicate$"):
                contract.strict_json(duplicate)
        with self.assertRaisesRegex(ValueError, "^duplicate$"):
            contract.strict_json(b'{"nested":{"runId":1,"runId":2}}')

    def test_individually_valid_receipts_cannot_use_each_others_identity(self):
        identities = ((SHA, RUN), ("c" * 40, RUN), (SHA, "987654321"))
        for sha, run in identities:
            parsed = contract.strict_json(json.dumps(receipt(sha, run)))
            self.assertEqual(contract.strict_json(envelope.canonical(parsed, sha, run)),
                             receipt(sha, run))
            for other_sha, other_run in identities:
                if (sha, run) == (other_sha, other_run):
                    continue
                with self.subTest(receipt=(sha, run), expected=(other_sha, other_run)), \
                        self.assertRaisesRegex(contract.Block, "^FORMAT$"):
                    envelope.canonical(parsed, other_sha, other_run)

    def test_envelope_enforces_plan_beyond_general_receipt_schema(self):
        cases = (dict(receipt(), unitBytes=453),
                 dict(receipt(), removedBytes=0,
                      afterSha256=contract.OLD_UNIT_SHA256,
                      planState="ALREADY_MANDATORY_ON_DISK"))
        for value in cases:
            parsed = contract.strict_json(json.dumps(value))
            self.assertEqual(contract.validate_receipt(parsed, SHA, RUN), value)
            with self.subTest(plan=value["planState"], size=value["unitBytes"]), \
                    self.assertRaisesRegex(contract.Block, "^PLAN$"):
                envelope.canonical(parsed, SHA, RUN)


if __name__ == "__main__":
    unittest.main()
