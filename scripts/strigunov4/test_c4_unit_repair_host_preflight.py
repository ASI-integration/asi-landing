"""Pure/offline checks for exact host preflight; never contact actual services."""
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import unittest

import c4_operator_patch as operator
import c4_unit_contract as c
import c4_unit_repair_host_preflight as h


def env_bytes():
    return b"\0".join((key + "=" + value).encode()
                      for key, value in operator.SAFETY.items()) + b"\0"


def props(optional=True):
    return {
        "ActiveState": "active", "SubState": "running", "LoadState": "loaded",
        "User": "asi-runtime", "Group": "asi-runtime",
        "WorkingDirectory": "/var/www/asi-staging/current", "FragmentPath": c.UNIT,
        "DropInPaths": "", "NeedDaemonReload": "no",
        "EnvironmentFiles": c.ENV + (" (ignore_errors=yes)" if optional else " (ignore_errors=no)"),
        "MainPID": "3527", "InvocationID": "a" * 32,
        "ExecMainStartTimestampMonotonic": "1234567",
    }


class StubConnection:
    requests = []
    def __init__(self, host, port, timeout):
        assert (host, port) == ("127.0.0.1", 3001)
        assert 0 < timeout <= 5
    def request(self, method, path):
        assert method == "GET"
        assert path in ("/api/health", "/api/version")
        self.path = path
        self.requests.append(path)
    def getresponse(self):
        payload = ({"ok": True} if self.path == "/api/health" else {
            "sha": h.EXPECTED_RELEASE.name, "environment": "staging",
            "resolvedReleasePath": str(h.EXPECTED_RELEASE)})
        return SimpleNamespace(status=200, read=lambda _n: json.dumps(payload).encode())
    def close(self):
        pass


class HostPreflightTests(unittest.TestCase):
    def test_01_only_exact_effective_safety(self):
        self.assertTrue(h.effective_safety(env_bytes()))

    def test_02_duplicate_effective_key_rejected(self):
        with self.assertRaises(c.Block):
            h.effective_safety(env_bytes() + b"EMAIL_AUTO_SEND=false\0")

    def test_03_missing_or_insecure_flags_rejected(self):
        for bad in (env_bytes().replace(b"YOOKASSA_ENABLED=false\0", b""),
                    env_bytes().replace(b"EMAIL_AUTO_SEND=false", b"EMAIL_AUTO_SEND=true"),
                    env_bytes().replace(b"ASI_SYNTHETIC_NO_SEND=YES", b"ASI_SYNTHETIC_NO_SEND=NO"),
                    env_bytes()[:-1], b""):
            with self.subTest(bad=bad[:20]), self.assertRaises(c.Block):
                h.effective_safety(bad)

    def test_04_irrelevant_env_does_not_escape(self):
        raw = env_bytes() + b"PRIVATE_CREDENTIAL=UNPRINTABLE_SECRET\0"
        self.assertIs(h.effective_safety(raw), True)

    def test_05_optional_and_mandatory_manager_contract(self):
        h.manager_phase(props(), "OLD")
        h.manager_phase(props(False), "NEW")
        with self.assertRaises(c.Block):
            h.manager_phase(props(), "NEW")
        with self.assertRaises(c.Block):
            h.manager_phase(props(False), "OLD")

    def test_06_wrong_manager_property_rejected(self):
        for key, bad in (("NeedDaemonReload", "yes"), ("DropInPaths", "unexpected"),
                         ("User", "root"), ("LoadState", "not-found"),
                         ("WorkingDirectory", "/other"), ("MainPID", "0"),
                         ("FragmentPath", "/etc/systemd/system/other.service")):
            with self.subTest(key=key), self.assertRaises(c.Block):
                h.manager_phase(dict(props(), **{key: bad}), "OLD")

    def test_07_process_identity_changes_with_restart(self):
        base = h.process_identity(props())
        self.assertEqual(len(base), 64)
        for key, value in (("MainPID", "3528"), ("InvocationID", "b" * 32),
                           ("ExecMainStartTimestampMonotonic", "1234568")):
            self.assertNotEqual(base, h.process_identity(dict(props(), **{key: value})))

    def test_08_source_owned_old_new_byte_phase(self):
        old = b"[Service]\nEnvironmentFile=-" + c.ENV.encode() + b"\n"
        new = old.replace(b"EnvironmentFile=-", b"EnvironmentFile=", 1)
        original, changed = c.digest(old), c.digest(new)
        with patch.object(h.phase, "OLD", original), patch.object(h.phase, "NEW", changed):
            self.assertEqual(h.unit_phase(old, "OLD")["afterSha256"], changed)
            self.assertEqual(h.unit_phase(new, "NEW")["afterSha256"], changed)
            with self.assertRaises(c.Block):
                h.unit_phase(old, "NEW")
            with self.assertRaises(c.Block):
                h.unit_phase(new, "OLD")

    def test_09_exact_fixed_loopback_health_and_version(self):
        StubConnection.requests = []
        with patch.object(h.http.client, "HTTPConnection", StubConnection):
            self.assertTrue(h.check_health(h.time.monotonic() + 30))
        self.assertEqual(StubConnection.requests, ["/api/health", "/api/version"])

    def test_10_offline_cannot_run_root_host_observation(self):
        with patch.object(h.os, "uname", return_value=SimpleNamespace(nodename="OFFLINE_DENIED"), create=True), \
                self.assertRaises(c.Block):
            h.fixed_observation("OLD")

    def test_11_phase_unknown_rejected(self):
        with self.assertRaises(c.Block):
            h.fixed_observation("OTHER")
        with self.assertRaises(c.Block):
            h.manager_phase(props(), "OTHER")

    def test_12_snapshot_cannot_claim_manager_wide_isolation(self):
        # A synthetic no-send/health success cannot supply a manager-wide
        # state token or authorize any mutation.
        with self.assertRaises(c.Block):
            h.phase.phase({
                "unitSha256": h.phase.OLD, "environmentFiles": "optional",
                "noSend": True, "health": True, "processToken": "a" * 64,
                "otherStateToken": "NOT_PROVEN"
            }, "OLD")


    def test_13_full_host_observation_remains_non_authoritative(self):
        old = SimpleNamespace(st_dev=1, st_ino=2)
        p = props()
        with patch.object(h, "host_identity"), \
             patch.object(h.c, "open_parent", return_value=777), \
             patch.object(h.c, "read_regular", side_effect=[(b"fixture", old, {}), (b"fixture", old, {})]), \
             patch.object(h.c, "signature", return_value=(1, 2)), \
             patch.object(h, "unit_phase", return_value={"beforeSha256": h.phase.OLD}) as unit_plan, \
             patch.object(h.unit_reader, "properties", side_effect=[p, p]), \
             patch.object(h, "process_env", return_value=True) as proc, \
             patch.object(h, "check_health", return_value=True) as health, \
             patch.object(h.os, "close", return_value=None), \
             patch.object(h.os, "fstat", return_value=SimpleNamespace(st_dev=1, st_ino=9)):
            result = h.fixed_observation("OLD")
        self.assertEqual(result["unitSha256"], h.phase.OLD)
        self.assertEqual(result["environmentFiles"], "optional")
        self.assertEqual(result["otherStateToken"], "NOT_PROVEN")
        self.assertEqual(result["isolation"], "MANAGER_WIDE_NOT_PROVEN")
        self.assertEqual(result["snapshot"], "NON_ATOMIC_CURRENT_ONLY")
        unit_plan.assert_called_once_with(b"fixture", "OLD")
        self.assertEqual(proc.call_count, 2)
        health.assert_called_once()
        with self.assertRaises(c.Block):
            h.phase.phase({k: result[k] for k in h.phase.SNAPSHOT_KEYS}, "OLD")

    def test_14_host_observation_rejects_manager_drift(self):
        before, after = props(), dict(props(), InvocationID="b" * 32)
        s = SimpleNamespace(st_dev=1, st_ino=2)
        with patch.object(h, "host_identity"), \
             patch.object(h.c, "open_parent", return_value=777), \
             patch.object(h.c, "read_regular", side_effect=[(b"fixture", s, {}), (b"fixture", s, {})]), \
             patch.object(h.c, "signature", return_value=(1, 2)), \
             patch.object(h, "unit_phase", return_value={"beforeSha256": h.phase.OLD}), \
             patch.object(h.unit_reader, "properties", side_effect=[before, after]), \
             patch.object(h, "process_env", return_value=True), \
             patch.object(h, "check_health", return_value=True), \
             patch.object(h.os, "close", return_value=None), self.assertRaisesRegex(c.Block, "PROCESS_CHANGED"):
            h.fixed_observation("OLD")


    def test_15_process_reader_consumes_to_eof_without_export(self):
        data = env_bytes()
        mid = len(data) // 2
        with patch.object(h.os, "open", return_value=155), \
             patch.object(h.os, "read", side_effect=[data[:mid], data[mid:], b""]) as reads, \
             patch.object(h.os, "close", return_value=None) as close:
            self.assertIs(h.process_env("3527", h.time.monotonic() + 5), True)
        self.assertEqual(reads.call_count, 3)
        close.assert_called_once_with(155)

    def test_16_process_reader_refuses_oversize(self):
        # A bounded procfs pseudo-file has no trustworthy st_size.
        with patch.object(h.os, "open", return_value=155), \
             patch.object(h.os, "read", return_value=b"x" * 8192), \
             patch.object(h.os, "close", return_value=None), \
             self.assertRaisesRegex(c.Block, "SIZE"):
            h.process_env("3527", h.time.monotonic() + 5)


if __name__ == "__main__":
    unittest.main()
