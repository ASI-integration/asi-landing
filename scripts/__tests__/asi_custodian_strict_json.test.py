"""Task29C: strict JSON parsing against ambiguous protocol and durable state."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest

SERVICE = Path(__file__).resolve().parents[1] / "custodian" / "asi_custodian.py"
spec = importlib.util.spec_from_file_location("asi_task29c", SERVICE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
RUN = "strig-cust-a1b2c3d4e5f6"


class StrictJsonUnitTests(unittest.TestCase):
    def test_duplicate_protocol_fields_even_if_identical_are_denied(self):
        payload = ('{"kind":"ASI_CUSTODIAN_TECHNICAL_V0","op":"append",'
                   '"runId":"' + RUN + '","seq":1,"seq":1,'
                   '"requestId":"' + "a" * 32 + '","result":"OBSERVED"}\n')
        with self.assertRaisesRegex(m.Unsafe, "DUPLICATE_JSON_KEY"):
            m.parse_request(payload.encode(), {"runId": RUN})

    def test_duplicate_nested_json_keys_and_nonfinite_numbers_denied(self):
        for payload in ('{"a":{"b":1,"b":2}}', '{"a":NaN}', '{"a":Infinity}',
                        '{"a":-Infinity}'):
            with self.subTest(payload=payload):
                with self.assertRaises(m.Unsafe):
                    m.strict_json_loads(payload)

    @unittest.skipUnless(sys.platform == "linux" and os.getuid() != 0,
                         "native ephemeral Linux fixture")
    def test_duplicate_config_field_fails_before_service_start(self):
        with tempfile.TemporaryDirectory(prefix="asi-29c-config-") as tmp:
            root = Path(tmp) / "state"
            m.initialize(str(root), RUN, os.getuid(), os.getgid())
            conf = root / "config.json"
            original = conf.read_text()
            self.assertIn('"guestSend":false', original)
            conf.write_text(original.replace('"guestSend":false',
                                                  '"guestSend":true,"guestSend":false'))
            with self.assertRaisesRegex(m.Unsafe, "DUPLICATE_JSON_KEY"):
                m.read_config(root)

    @unittest.skipUnless(sys.platform == "linux" and os.getuid() != 0,
                         "native ephemeral Linux fixture")
    def test_duplicate_durable_journal_fields_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix="asi-29c-ledger-") as tmp:
            root = Path(tmp) / "state"
            m.initialize(str(root), RUN, os.getuid(), os.getgid())
            conf = m.read_config(root)
            (root / "events.ndjson").write_bytes(
                b'{"v":1,"v":1,"seq":1}\n'
            )
            with self.assertRaisesRegex(m.Unsafe, "DUPLICATE_JSON_KEY"):
                m.inspect_journal(root, conf)


if __name__ == "__main__":
    unittest.main(verbosity=2)
