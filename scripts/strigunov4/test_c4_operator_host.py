"""Isolated Linux files and simulated service failures; never systemctl/SSH."""
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import time
import unittest
from unittest.mock import patch, MagicMock

import c4_operator_host as h
import c4_operator_observer as observer
from c4_operator_patch import plan, SAFETY, KEYS, OPERATOR, Block
from test_c4_operator_patch import env_bytes


@unittest.skipUnless(os.name == "posix", "Actual atomic-file tests run on isolated Linux CI")
class FileRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = self.root / "environment"
        self.original = env_bytes(b"SECRET=never-print\nCRM_OPERATOR_EMAILS=a@b.test\n")
        self.env.write_bytes(self.original)
        self.env.chmod(0o640)
        self.evidence = self.root / "evidence"
        self.evidence.mkdir(mode=0o700)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(h, "EVIDENCE", self.evidence))
        self.stack.enter_context(patch.object(h.io, "ENV", self.env))
        self.stack.enter_context(patch.object(h.io, "read_env",
            side_effect=lambda: (self.env.read_bytes(), self.env.stat())))
        self.live = self.stack.enter_context(patch.object(h, "live"))
        self.restart = self.stack.enter_context(patch.object(h, "restart"))

    def perform(self):
        return h.perform("123", "a" * 40)

    def test_success_atomic_preservation(self):
        report = self.perform()
        self.assertEqual(report, h.SUCCESS)
        expected = plan(self.original)
        self.assertEqual(self.env.read_bytes(), expected["output"])
        self.restart.assert_called_once()
        self.assertEqual(self.restart.call_args.args[0], expected["after"])
        record = self.evidence / h.CLAIM
        backup = record / "original.env.private"
        self.assertEqual(backup.read_bytes(), self.original)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.env.stat().st_mode & 0o777, 0o640)
        self.assertNotIn("never-print", json.dumps(report))

    def test_replay_other_run_blocked(self):
        self.perform()
        self.env.write_bytes(self.original)
        with self.assertRaisesRegex(Block, "CLAIM_EXISTS"):
            h.perform("124", "b" * 40)

    def test_restart_failure_restores_original(self):
        self.restart.side_effect = [Block("FAILED"), None]
        self.assertEqual(self.perform(), {"status": "ROLLBACK_PASS"})
        self.assertEqual(self.env.read_bytes(), self.original)
        self.assertEqual(self.restart.call_args.args[0], plan(self.original)["before"])

    def test_catchable_crash_recovers(self):
        self.restart.side_effect = [KeyboardInterrupt(), None]
        self.assertEqual(self.perform(), {"status": "ROLLBACK_PASS"})
        self.assertEqual(self.env.read_bytes(), self.original)

    def test_uncertain_recovery_blocks(self):
        self.restart.side_effect = Block("FAILED")
        self.assertEqual(self.perform(), {"status": "BLOCK_MANUAL_RECOVERY_REQUIRED"})
        self.assertTrue((self.evidence / h.CLAIM / "original.env.private").exists())

    def test_concurrent_change_not_overwritten(self):
        foreign = env_bytes(b"SECRET=someone-else\n")
        def fail(*args):
            self.env.write_bytes(foreign)
            raise Block("FAILED")
        self.restart.side_effect = fail
        self.assertEqual(self.perform(), {"status": "BLOCK_MANUAL_RECOVERY_REQUIRED"})
        self.assertEqual(self.env.read_bytes(), foreign)

    def test_crash_claim_without_apply_cannot_replay(self):
        (self.evidence / h.CLAIM).mkdir()
        with self.assertRaisesRegex(Block, "CLAIM_EXISTS"):
            self.perform()
        self.assertEqual(self.env.read_bytes(), self.original)
        self.restart.assert_not_called()

    def test_failure_before_replace_no_restart(self):
        with patch.object(h.io, "atomic_env", side_effect=OSError("hidden")):
            self.assertEqual(self.perform(), {"status": "BLOCK_BEFORE_APPLY"})
        self.assertEqual(self.env.read_bytes(), self.original)
        self.restart.assert_not_called()

    def test_already_configured_no_mutation(self):
        self.env.write_bytes(plan(self.original)["output"])
        with self.assertRaises(Block):
            self.perform()
        self.assertFalse((self.evidence / h.CLAIM).exists())
        self.restart.assert_not_called()


    def test_preflight_refusal_preserves_bytes_and_has_no_claim(self):
        for error in (Block("ENVIRONMENT_FILES"), Block("HEALTH"), OSError("private")):
            self.live.side_effect = error
            with self.subTest(error=type(error)), self.assertRaises(type(error)):
                self.perform()
            self.assertEqual(self.env.read_bytes(), self.original)
            self.assertFalse((self.evidence / h.CLAIM).exists())
            self.restart.assert_not_called()

    def test_observer_claim_markers_are_read_only_and_private(self):
        # File ownership alone is simulated for the non-root CI user; real
        # Linux paths, symlinks, modes, bounded reads and open flags are exercised.
        native_fstat, native_open = os.fstat, os.open
        def root_owned(fd):
            st = native_fstat(fd)
            return SimpleNamespace(**{name: (0 if name == "st_uid" else getattr(st, name))
                for name in ("st_uid", "st_mode", "st_size", "st_nlink", "st_mtime_ns", "st_ctime_ns")})
        def readonly_open(path, flags, *args, **kwargs):
            self.assertFalse(flags & (os.O_CREAT | os.O_TRUNC | os.O_WRONLY | os.O_RDWR))
            return native_open(path, flags, *args, **kwargs)
        def snapshot():
            with patch.object(os, "fstat", side_effect=root_owned), \
                    patch.object(os, "open", side_effect=readonly_open):
                return observer.claim_snapshot()
        self.assertEqual(snapshot()["claim"], "ABSENT")
        record = self.evidence / h.CLAIM
        record.mkdir(mode=0o700)
        self.assertEqual(snapshot()["prepared"], "ABSENT")
        files = {"original.env.private": self.original,
                 "prepared.json": json.dumps({"runId": observer.FAILED_RUN,
                    "sourceSha": observer.FAILED_SHA, "status": "PREPARED", "changedLists": 2}).encode(),
                 "success.json": json.dumps(h.SUCCESS).encode(),
                 "recovery.json": b'{"status":"ROLLBACK_PASS"}'}
        for name, value in files.items():
            (record / name).write_bytes(value)
            (record / name).chmod(0o600)
        out = snapshot()
        self.assertEqual(out, dict(claim="PRESENT", backup="PRESENT", prepared="BOUND_TO_FAILED_RUN",
                                  success="RECORDED_SUCCESS", recovery="RECORDED_ROLLBACK", lock="ABSENT"))
        self.assertNotIn("never-print", json.dumps(out))
        for name, value in files.items():
            self.assertEqual((record / name).read_bytes(), value)
        for value in (b'{"status":"secret-hostile"}', b'x' * 4097, b'[]'):
            (record / "prepared.json").write_bytes(value)
            self.assertEqual(snapshot()["prepared"], "INVALID")
        (record / "prepared.json").unlink()  # disposable test fixture only
        (record / "prepared.json").symlink_to(self.env)
        self.assertEqual(snapshot()["prepared"], "INVALID")
        self.assertEqual(self.env.read_bytes(), self.original)
        self.restart.assert_not_called()


class LiveContractTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.unit = MagicMock()
        self.unit.is_symlink.return_value = False
        self.unit.is_file.return_value = True
        self.unit.read_bytes.return_value = b"synthetic-unit"
        self.root = MagicMock()
        self.root.is_dir.return_value = True
        self.root.is_symlink.return_value = False
        self.release = self.root.__truediv__.return_value.__truediv__.return_value
        self.current = MagicMock()
        self.current.is_symlink.return_value = True
        self.current.resolve.return_value = self.release
        self.env = MagicMock()
        self.env.parent.is_dir.return_value = True
        self.env.parent.is_symlink.return_value = False
        self.settings = dict(SAFETY, CRM_OPERATOR_EMAILS=OPERATOR, OPS_ADMIN_EMAILS=OPERATOR)
        self.proc = MagicMock()
        self.proc.read_bytes.side_effect = lambda: b"\0".join(
            (k + "=" + v).encode() for k, v in self.settings.items())
        def path(value):
            if value == "/etc/systemd/system/asi-landing-staging.service":
                return self.unit
            mock = MagicMock()
            mock.__truediv__.return_value.__truediv__.return_value = self.proc
            return mock
        self.stack.enter_context(patch.object(h, "Path", side_effect=path))
        self.stack.enter_context(patch.object(h.io, "ROOT", self.root))
        self.stack.enter_context(patch.object(h.io, "CURRENT", self.current))
        self.stack.enter_context(patch.object(h.io, "ENV", self.env))
        self.stack.enter_context(patch.object(h.io, "UNIT_HASH",
            hashlib.sha256(b"synthetic-unit").hexdigest()))
        self.stack.enter_context(patch.object(h.os, "geteuid", return_value=0, create=True))
        self.stack.enter_context(patch.object(h.os, "uname",
            return_value=SimpleNamespace(nodename=h.io.HOST), create=True))
        self.meta = dict(ActiveState="active", User="asi-runtime", Group="asi-runtime",
            WorkingDirectory=str(self.current), EnvironmentFiles=str(self.env) + " (ignore_errors=no)",
            DropInPaths="", MainPID="42")
        self.props = self.stack.enter_context(patch.object(h.io, "props",
            side_effect=lambda *a: dict(self.meta)))
        self.conn = self.stack.enter_context(patch.object(h.http.client, "HTTPConnection"))
        reply = self.conn.return_value.getresponse.return_value
        reply.status = 200
        def response(*args):
            endpoint = self.conn.return_value.request.call_args.args[1]
            return json.dumps({"ok": True} if endpoint.endswith("health") else {
                "sha": h.G0, "environment": "staging",
                "resolvedReleasePath": str(self.release)}).encode()
        reply.read.side_effect = response

    def live(self):
        return h.live({k: {OPERATOR} for k in KEYS}, time.monotonic() + 10)

    def test_full_effective_contract_and_get_only(self):
        self.live()
        self.assertEqual([c.args[0] for c in self.conn.return_value.request.call_args_list],
                         ["GET", "GET"])

    def test_every_safety_flag_checked(self):
        for key in SAFETY:
            self.settings[key] = "unsafe"
            with self.subTest(key=key), self.assertRaises(Block):
                self.live()
            self.settings[key] = SAFETY[key]

    def test_both_memberships_required(self):
        for key in KEYS:
            self.settings[key] = ""
            with self.subTest(key=key), self.assertRaises(Block):
                self.live()
            self.settings[key] = OPERATOR

    def test_unit_or_service_drift_blocks(self):
        self.unit.read_bytes.return_value = b"changed"
        with self.assertRaises(Block):
            self.live()
        self.unit.read_bytes.return_value = b"synthetic-unit"
        for value in (str(self.env), str(self.env) + " (ignore_errors=yes)",
                      str(self.env) + " (ignore_errors=no) /unapproved/env", ""):
            self.meta["EnvironmentFiles"] = value
            with self.subTest(value=value), self.assertRaisesRegex(Block, "ENVIRONMENT_FILES"):
                self.live()
        self.conn.assert_not_called()

    def test_redirect_rejected(self):
        self.conn.return_value.getresponse.return_value.status = 302
        with self.assertRaises(Block):
            self.live()

    def test_pid_change_rejected(self):
        self.props.side_effect = [dict(self.meta), dict(self.meta, MainPID="43")]
        with self.assertRaises(Block):
            self.live()


def load_tests(loader, tests, pattern):
    """Keep observer hardening regressions in the existing focused CI command."""
    from test_c4_operator_observer_hardening import ObserverHardeningTests
    tests.addTests(loader.loadTestsFromTestCase(ObserverHardeningTests))
    return tests


if __name__ == "__main__":
    unittest.main()
