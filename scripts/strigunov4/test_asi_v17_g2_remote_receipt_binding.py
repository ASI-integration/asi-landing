"""Synthetic receipt binding regressions; invoke only the local pure decoders."""
import json
import unittest

import c4_operator_host as host
import c4_operator_observer as observer
import protected_c4_operator_observer as observer_gate
import protected_c4_operator_repair as repair_gate


class RemoteReceiptBindingTests(unittest.TestCase):
    def envelopes(self):
        observed = {
            "status": "C4_OPERATOR_OBSERVED",
            "incidentRun": observer.FAILED_RUN,
            "snapshot": "NON_ATOMIC_CURRENT_ONLY",
            "historicalWrite": "UNKNOWN",
            "replayAllowed": False,
            "databaseState": "NOT_OBSERVED",
            **dict.fromkeys(observer.FIELDS, "NOT_OBSERVED"),
            **dict.fromkeys(("lock", "environmentFiles", "live", "envPlan",
                             "membership"), "NOT_OBSERVED"),
        }
        return (
            (repair_gate.decode_remote_result, dict(host.SUCCESS),
             "BLOCK_MANUAL_RECOVERY_REQUIRED"),
            (observer_gate.decode, observed, "BLOCK_REASON_UNKNOWN"),
        )

    @staticmethod
    def raw(value):
        return json.dumps(value, separators=(",", ":")).encode("ascii")

    def blocked(self, decode, raw, code, expected):
        with self.assertRaises(repair_gate.RemoteOutcome) as raised:
            decode(raw, code)
        self.assertEqual(raised.exception.status, expected)
        self.assertEqual(raised.exception.args, (expected,))

    def test_exact_success_envelopes_at_zero_exit(self):
        for decode, receipt, _ in self.envelopes():
            with self.subTest(decoder=decode.__module__):
                result = decode(self.raw(receipt), 0)
                self.assertEqual(result, receipt)
                self.assertEqual({k: type(v) for k, v in result.items()},
                                 {k: type(v) for k, v in receipt.items()})

    def test_nonzero_exit_never_promotes_success(self):
        for decode, receipt, failure in self.envelopes():
            for code in (-15, -9, -1, 1, 2, 126, 127, 255):
                with self.subTest(decoder=decode.__module__, code=code):
                    self.blocked(decode, self.raw(receipt), code, failure)

    def test_known_blocks_require_nonzero_exit(self):
        for decode, _, failure in self.envelopes():
            for status in sorted(host.BLOCKS):
                raw = self.raw({"status": status})
                with self.subTest(decoder=decode.__module__, status=status):
                    for code in (-9, 1, 2, 255):
                        self.blocked(decode, raw, code, status)
                    self.blocked(decode, raw, 0, failure)

    def test_extra_fields_cannot_manufacture_acceptance(self):
        for decode, receipt, failure in self.envelopes():
            for base in (receipt, {"status": "BLOCK_BEFORE_APPLY"}):
                for extra in ({"accepted": True}, {"returncode": 0},
                              {"receipt": receipt}, {"extra": None}):
                    for code in (0, 2):
                        with self.subTest(decoder=decode.__module__,
                                          base=base["status"], extra=extra, code=code):
                            self.blocked(decode, self.raw(dict(base, **extra)),
                                         code, failure)

    def test_duplicate_keys_rejected_even_when_values_agree(self):
        for decode, receipt, failure in self.envelopes():
            for base in (receipt, {"status": "BLOCK_BEFORE_APPLY"}):
                for key, value in base.items():
                    # Escaped spellings must collide after JSON decoding too.
                    escaped = '"\\u%04x%s"' % (ord(key[0]), key[1:])
                    for encoded_key in (json.dumps(key), escaped):
                        for duplicate in (value, "UNRECOGNIZED"):
                            pair = (encoded_key + ":" + json.dumps(duplicate)).encode()
                            original = self.raw(base)[1:-1]
                            for body in (original + b"," + pair,
                                         pair + b"," + original):
                                for code in (0, 2):
                                    with self.subTest(decoder=decode.__module__,
                                                      key=key, duplicate=duplicate,
                                                      body=body, code=code):
                                        self.blocked(decode, b"{" + body + b"}",
                                                     code, failure)

    def test_success_field_types_and_values_are_exact(self):
        candidates = (None, True, False, 0, 1, 2, 7, 0.0, 2.0, 7.0,
                      "0", "2", "7", "false", "UNRECOGNIZED", [], {})
        for decode, receipt, failure in self.envelopes():
            for key, expected in receipt.items():
                for value in candidates:
                    if type(value) is type(expected) and value == expected:
                        continue
                    with self.subTest(decoder=decode.__module__, key=key,
                                      value=value, kind=type(value).__name__):
                        self.blocked(decode, self.raw(dict(receipt, **{key: value})),
                                     0, failure)

    def test_block_status_types_and_unknown_labels_fail_closed(self):
        for decode, _, failure in self.envelopes():
            for status in (None, True, False, 0, 1, 0.0, [], {},
                           ["BLOCK"], "", "block", "PASS", "BLOCK_UNKNOWN"):
                for code in (0, 2):
                    with self.subTest(decoder=decode.__module__, status=status,
                                      code=code):
                        self.blocked(decode, self.raw({"status": status}),
                                     code, failure)

    def test_missing_fields_and_nonobject_envelopes_fail_closed(self):
        for decode, receipt, failure in self.envelopes():
            malformed = [None, [], [receipt], True, 0, "BLOCK"]
            malformed.extend({k: v for k, v in receipt.items() if k != missing}
                             for missing in receipt)
            for value in malformed:
                for code in (0, 2):
                    with self.subTest(decoder=decode.__module__, value=value,
                                      code=code):
                        self.blocked(decode, self.raw(value), code, failure)


if __name__ == "__main__":
    unittest.main()
