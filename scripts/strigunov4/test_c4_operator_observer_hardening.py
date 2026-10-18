"""Focused offline regressions: temporary Linux files, synthetic records, no SSH.

Root ownership alone is simulated on non-root CI; descriptors, symlinks, modes,
rename races and flock are real. No target config, service or credential is used.
"""
from contextlib import ExitStack, redirect_stdout
import errno
import io
import json
import os
if os.name == "posix":
    import fcntl
else:
    fcntl = None
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import c4_operator_host as host
import c4_operator_observer as observer
import protected_c4_operator_observer as gate
import protected_c4_operator_repair as transport
from c4_operator_patch import Block, KEYS, SAFETY
from test_c4_operator_patch import env_bytes
import test_c4_operator_host as existing_host_tests

NATIVE_PROPS = host.io.props


def owned(info, uid=0):
    return SimpleNamespace(**{name: uid if name == "st_uid" else getattr(info, name)
        for name in ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink",
                     "st_size", "st_mtime_ns", "st_ctime_ns")})


@unittest.skipUnless(os.name == "posix", "Linux filesystem/lock tests")
class ObserverHardeningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.native_fstat, self.native_stat = os.fstat, os.stat
        self.stack.enter_context(patch.object(host, "EVIDENCE", self.root))
        self.stack.enter_context(patch.object(os, "fstat", side_effect=lambda fd: owned(self.native_fstat(fd))))
        self.stack.enter_context(patch.object(os, "stat", side_effect=self.root_stat))

    def root_stat(self, path, *args, **kwargs):
        info = self.native_stat(path, *args, **kwargs)
        # Only the descriptor-relative lock metadata needs a matching uid.
        return owned(info) if path == "active.lock" and "dir_fd" in kwargs else info

    def make_lock(self, mode=0o600):
        path = self.root / "active.lock"
        path.write_bytes(b"synthetic-lock-content-never-read")
        path.chmod(mode)
        return path

    def record(self, path, kind="FLOCK", waiting=False, inode=None):
        st = path.stat()
        target = f"{os.major(st.st_dev):02x}:{os.minor(st.st_dev):02x}:{st.st_ino if inode is None else inode}"
        return f"1: {'-> ' if waiting else ''}{kind} ADVISORY WRITE 123 {target} 0 EOF\n".encode()

    def snapshot(self, raw=b"", *, reader=None):
        with patch("builtins.open", return_value=reader or io.BytesIO(raw)) as opened:
            result = observer.claim_snapshot()
        if opened.called:
            opened.assert_called_once_with("/proc/locks", "rb")
        return result

    def marker(self, value, kind="success", raw=False):
        record = self.root / host.CLAIM
        record.mkdir(mode=0o700, exist_ok=True)
        path = record / (kind + ".json")
        path.write_bytes(value if raw else json.dumps(value).encode())
        path.chmod(0o600)
        return observer.claim_snapshot()[kind]

    def receipt(self):
        with patch.object(observer, "identity"), \
             patch.object(host.io, "props", return_value={"EnvironmentFiles": str(host.io.ENV) + " (ignore_errors=no)"}), \
             patch.object(host, "live", return_value={k: set() for k in KEYS}), \
             patch.object(host.io, "read_env", return_value=(env_bytes(), None)):
            return observer.observe()

    def test_repeated_systemd_records_rejected_in_both_orders(self):
        expected = str(host.io.ENV) + " (ignore_errors=no)"
        for other in (expected, str(host.io.ENV) + " (ignore_errors=yes)", "/synthetic/extra (ignore_errors=no)"):
            for values in ((other, expected), (expected, other)):
                raw = "".join("EnvironmentFiles=" + x + "\n" for x in values).encode()
                with self.subTest(values=values), patch.object(host.io, "checked", return_value=raw):
                    with self.assertRaisesRegex(Block, "DUPLICATE_SYSTEMD_PROPERTY") as error:
                        host.io.props()
                    self.assertEqual(host.failure_code(error.exception), "BLOCK_REASON_DUPLICATE_SYSTEMD_PROPERTY")
        with patch.object(host.io, "checked", return_value=b"MainPID=1\nMainPID=2\n"):
            with self.assertRaisesRegex(Block, "DUPLICATE_SYSTEMD_PROPERTY"):
                host.io.props()

    def test_real_props_gate_rejects_optional_and_duplicate_before_http(self):
        fixture = existing_host_tests.LiveContractTests("test_full_effective_contract_and_get_only")
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        base = "".join(k + "=" + v + "\n" for k, v in fixture.meta.items()).encode()
        duplicate = b"EnvironmentFiles=/synthetic/extra (ignore_errors=no)\n" + base
        optional = base.replace(b"ignore_errors=no", b"ignore_errors=yes")
        with patch.object(host.io, "props", NATIVE_PROPS):
            for raw, reason in ((duplicate, "DUPLICATE_SYSTEMD_PROPERTY"), (optional, "ENVIRONMENT_FILES")):
                with self.subTest(reason=reason), patch.object(host.io, "checked", return_value=raw):
                    with self.assertRaisesRegex(Block, reason):
                        fixture.live()
                    fixture.conn.assert_not_called()
                    fixture.proc.read_bytes.assert_not_called()

    def test_all_seven_safety_failures_stop_before_http(self):
        fixture = existing_host_tests.LiveContractTests("test_every_safety_flag_checked")
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.assertEqual(len(SAFETY), 7)
        for key, value in SAFETY.items():
            fixture.settings[key] = "unsafe"
            with self.subTest(key=key), self.assertRaisesRegex(Block, "EFFECTIVE_NO_SEND"):
                fixture.live()
            fixture.settings[key] = value
        fixture.conn.assert_not_called()

    def test_malformed_or_oversized_proc_is_unknown(self):
        path = self.make_lock()
        good = self.record(path)
        bad = [b"\n", b"1: FLOCK\n", good[:-1], good.replace(b" EOF", b""),
               good.replace(b"WRITE", b"INVENTED"), good.replace(b"ADVISORY", b"INVENTED"),
               good.replace(b"FLOCK", b"INVENTED"), b"\xff\n", b"x" * 262145,
               good + b"malformed\n", good.replace(b"0 EOF", b"0 EOF extra"),
               good.replace(b"123 ", b"private "), b"1: FLOCK ADVISORY WRITE 123 xx:01:1 0 EOF\n"]
        unrelated = self.record(path, inode=path.stat().st_ino + 1)
        bad += [unrelated.replace(b"ADVISORY", b"ACTIVE"), unrelated.replace(b"123 ", b"-2 "),
                unrelated.replace(b"0 EOF", b"10 2")]
        for raw in bad:
            with self.subTest(case=bad.index(raw)):
                self.assertEqual(self.snapshot(raw)["lock"], "UNKNOWN")

    def test_proc_read_is_bounded_and_io_errors_unknown(self):
        self.make_lock()
        class Reader(io.BytesIO):
            def read(inner, size=-1):
                self.assertEqual(size, 262145)
                return super().read(size)
        self.assertEqual(self.snapshot(reader=Reader(b"x" * 262146))["lock"], "UNKNOWN")
        with patch("builtins.open", side_effect=PermissionError("PRIVATE")):
            self.assertEqual(observer.claim_snapshot()["lock"], "UNKNOWN")

    def test_lock_records_distinguish_inode_waiter_and_other_lock_classes(self):
        path = self.make_lock()
        for raw, wanted in ((b"", "VALID_METADATA_NO_HOLDER_OBSERVED"),
            (self.record(path, inode=path.stat().st_ino + 1), "VALID_METADATA_NO_HOLDER_OBSERVED"),
            (self.record(path), "HELD"), (self.record(path).replace(b"WRITE", b"READ"), "HELD"),
            (self.record(path, waiting=True), "UNKNOWN"),
            (self.record(path) + self.record(path, waiting=True), "HELD"),
            (self.record(path, kind="POSIX"), "UNKNOWN"), (self.record(path, kind="OFDLCK"), "UNKNOWN")):
            with self.subTest(wanted=wanted, record=raw):
                self.assertEqual(self.snapshot(raw)["lock"], wanted)

    def test_actual_cross_process_flock_observed_without_acquiring(self):
        path = self.make_lock()
        program = "import sys,fcntl;f=open(sys.argv[1],'rb');fcntl.flock(f,fcntl.LOCK_EX);print('ready',flush=True);sys.stdin.read(1)"
        proc = subprocess.Popen([sys.executable, "-B", "-c", program, str(path)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={"PATH": os.environ["PATH"], "PYTHONDONTWRITEBYTECODE": "1"})
        try:
            self.assertEqual(proc.stdout.readline(), b"ready\n")
            with patch.object(fcntl, "flock", side_effect=AssertionError("OBSERVER_MUST_NOT_LOCK")):
                self.assertEqual(observer.claim_snapshot()["lock"], "HELD")
            _, errors = proc.communicate(b"x", timeout=5)
            self.assertEqual((proc.returncode, errors), (0, b""))
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.communicate(timeout=5)
        self.assertEqual(observer.claim_snapshot()["lock"], "VALID_METADATA_NO_HOLDER_OBSERVED")

    def test_invalid_mode_uid_hardlink_symlink_fifo_never_read(self):
        path = self.make_lock(0o644)
        with patch("builtins.open", side_effect=AssertionError("PROC_NOT_NEEDED")), \
             patch.object(os, "read", side_effect=AssertionError("CONTENTS_FORBIDDEN")):
            self.assertEqual(observer.claim_snapshot()["lock"], "INVALID")
            path.chmod(0o600)
            with patch.object(os, "fstat", side_effect=lambda fd: owned(self.native_fstat(fd),
                    1000 if self.native_fstat(fd).st_ino == path.stat().st_ino else 0)):
                self.assertEqual(observer.claim_snapshot()["lock"], "INVALID")
            os.link(path, self.root / "second-link")
            self.assertEqual(observer.claim_snapshot()["lock"], "INVALID")
            path.unlink()
            path.symlink_to(self.root / "second-link")
            self.assertEqual(observer.claim_snapshot()["lock"], "INVALID")
            path.unlink()
            os.mkfifo(path, 0o600)
            self.assertEqual(observer.claim_snapshot()["lock"], "INVALID")

    def test_lock_rename_unlink_and_metadata_race_are_unknown(self):
        for race in ("replace", "unlink", "mode"):
            path = self.make_lock()
            def changed():
                if race == "replace":
                    other = self.root / "replacement"
                    other.write_bytes(b"replacement"); other.chmod(0o600)
                    os.replace(other, path)
                elif race == "unlink":
                    path.unlink()
                else:
                    path.chmod(0o644)
            class Reader(io.BytesIO):
                def read(inner, size=-1):
                    changed()
                    return super().read(size)
            with self.subTest(race=race):
                self.assertEqual(self.snapshot(reader=Reader())["lock"], "UNKNOWN")

    def test_readonly_flags_and_unchanged_files(self):
        path = self.make_lock()
        before = (path.read_bytes(), path.stat())
        native_open = os.open
        def checked_open(name, flags, *args, **kwargs):
            self.assertFalse(flags & (os.O_CREAT | os.O_TRUNC | os.O_WRONLY | os.O_RDWR | os.O_APPEND))
            if name == "active.lock":
                self.assertTrue(flags & os.O_NOFOLLOW)
                self.assertTrue(flags & os.O_NONBLOCK)
                self.assertIn("dir_fd", kwargs)
            return native_open(name, flags, *args, **kwargs)
        with patch.object(os, "open", side_effect=checked_open), \
             patch.object(os, "read", side_effect=AssertionError("CONTENTS_FORBIDDEN")), \
             patch.object(os, "write", side_effect=AssertionError("WRITE_FORBIDDEN")), \
             patch.object(fcntl, "flock", side_effect=AssertionError("FLOCK_FORBIDDEN")):
            first, second = self.snapshot(), self.snapshot()
        self.assertEqual(first, second)
        self.assertEqual(path.read_bytes(), before[0])
        self.assertEqual((path.stat().st_mtime_ns, path.stat().st_ctime_ns),
                         (before[1].st_mtime_ns, before[1].st_ctime_ns))
        self.assertEqual(sorted(x.name for x in self.root.iterdir()), ["active.lock"])

    def test_close_failure_unknown_without_retry_or_loss_of_claim(self):
        path = self.make_lock()
        native_close = os.close
        closed = []
        def close(fd):
            is_lock = self.native_fstat(fd).st_ino == path.stat().st_ino
            native_close(fd)
            if is_lock:
                closed.append(fd)
                raise OSError(errno.EIO, "PRIVATE")
        with patch.object(os, "close", side_effect=close):
            result = self.snapshot()
        self.assertEqual(result["lock"], "UNKNOWN")
        self.assertEqual(result["claim"], "ABSENT")
        self.assertEqual(len(closed), 1)

    def test_absent_and_invalid_root_never_create_evidence(self):
        missing = self.root / "missing"
        with patch.object(host, "EVIDENCE", missing):
            self.assertEqual(observer.claim_snapshot()["lock"], "ABSENT")
        self.assertFalse(missing.exists())
        self.root.chmod(0o755)
        result = observer.claim_snapshot()
        self.assertEqual(result["claim"], "INVALID")
        self.assertEqual(result["lock"], "NOT_OBSERVED")

    def test_success_exact_types_and_keys(self):
        self.assertEqual(self.marker(host.SUCCESS), "RECORDED_SUCCESS")
        mutations = [dict(host.SUCCESS, releaseSwitched=0), dict(host.SUCCESS, databaseClientInvoked=0),
            dict(host.SUCCESS, effectiveFlags=7.0), dict(host.SUCCESS, effectiveLists=2.0),
            dict(host.SUCCESS, effectiveLists=True), dict(host.SUCCESS, effectiveFlags="7"),
            dict(host.SUCCESS, status=[]), dict(host.SUCCESS, databaseState=None),
            dict(host.SUCCESS, extra="PRIVATE"), {k:v for k,v in host.SUCCESS.items() if k != "humanUI"}]
        for value in mutations:
            with self.subTest(value=value):
                self.assertEqual(self.marker(value), "INVALID")
        raw = json.dumps(host.SUCCESS).encode()
        for value in (raw[:-1], b"[]", b"null", raw[:-1] + b',"releaseSwitched":false}', b"x" * 4097):
            self.assertEqual(self.marker(value, raw=True), "INVALID")

    def test_prepared_binding_types_not_mislabeled_as_other_run(self):
        prepared = dict(runId=observer.FAILED_RUN, sourceSha=observer.FAILED_SHA,
                        status="PREPARED", changedLists=2)
        self.assertEqual(self.marker(prepared, "prepared"), "BOUND_TO_FAILED_RUN")
        self.assertEqual(self.marker(dict(prepared, runId="123", sourceSha="a" * 40), "prepared"), "OTHER_BINDING")
        for key, value in (("runId", 123), ("runId", []), ("runId", "PRIVATE"),
                           ("sourceSha", None), ("sourceSha", "bad"), ("changedLists", True), ("changedLists", 2.0)):
            with self.subTest(key=key, value=value):
                self.assertEqual(self.marker(dict(prepared, **{key:value}), "prepared"), "INVALID")

    def test_conflicting_markers_remain_observations_never_overall_success(self):
        self.marker(host.SUCCESS)
        self.marker({"status":"ROLLBACK_PASS"}, "recovery")
        self.marker(dict(runId=observer.FAILED_RUN, sourceSha=observer.FAILED_SHA,
                         status="PREPARED", changedLists=2), "prepared")
        receipt = self.receipt()
        self.assertEqual((receipt["success"], receipt["recovery"]), ("RECORDED_SUCCESS", "RECORDED_ROLLBACK"))
        self.assertEqual(gate.decode(json.dumps(receipt).encode(), 0), receipt)
        self.assertEqual(receipt["status"], "C4_OPERATOR_OBSERVED")
        self.assertEqual(receipt["historicalWrite"], "UNKNOWN")
        self.assertEqual(receipt["snapshot"], "NON_ATOMIC_CURRENT_ONLY")
        self.assertIs(receipt["replayAllowed"], False)

    def test_decoder_exact_field_states_and_lock_enum(self):
        receipt = self.receipt()
        for state in observer.LOCK_STATES:
            changed = dict(receipt, lock=state)
            self.assertEqual(gate.decode(json.dumps(changed).encode(), 0), changed)
        bad = [dict(receipt, lock=x) for x in ("FREE", "PASS", "PRIVATE", [], None, 0, False)]
        bad += [dict(receipt, success="RECORDED_ROLLBACK"), dict(receipt, claim="RECORDED_SUCCESS"),
                dict(receipt, prepared="PRESENT"), dict(receipt, backup="OTHER_BINDING"),
                dict(receipt, replayAllowed=0), dict(receipt, extra="PRIVATE")]
        for key in receipt:
            incomplete = dict(receipt); del incomplete[key]; bad.append(incomplete)
        for value in bad:
            with self.subTest(value=value), self.assertRaises(transport.RemoteOutcome) as error:
                gate.decode(json.dumps(value).encode(), 0)
            self.assertEqual(error.exception.status, "BLOCK_REASON_UNKNOWN")
        with self.assertRaises(transport.RemoteOutcome):
            gate.decode(json.dumps(receipt).encode(), 2)

    def test_decoder_rejects_state_from_another_marker(self):
        receipt = self.receipt()
        with self.assertRaises(transport.RemoteOutcome):
            gate.decode(json.dumps(dict(receipt, success="RECORDED_ROLLBACK")).encode(), 0)

    def test_identity_failure_stops_before_private_reads(self):
        with patch.object(observer, "identity", side_effect=Block("HOST")), \
             patch.object(observer, "claim_snapshot") as claim, patch.object(host.io, "props") as props, \
             patch.object(host, "live") as live, patch.object(host.io, "read_env") as read:
            with self.assertRaisesRegex(Block, "HOST"):
                observer.observe()
        for item in (claim, props, live, read):
            item.assert_not_called()

    def test_observer_does_not_call_writer_or_transport(self):
        with ExitStack() as stack:
            for obj, name in ((host,"perform"), (host,"run_locked"), (host,"restart"),
                              (host,"journal"), (host.io,"atomic_env"), (host.io,"write_private"),
                              (host.io,"checked"), (transport,"execute")):
                stack.enter_context(patch.object(obj, name, side_effect=AssertionError("UNSAFE_ACTION")))
            result = self.receipt()
        self.assertEqual(result["databaseState"], "NOT_OBSERVED")
        self.assertIs(result["replayAllowed"], False)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_real_embedded_payload_rejects_before_host_access(self):
        payload = gate.payload()
        process = subprocess.run([sys.executable, "-B", "-", "invalid", "invalid"],
            input=payload, capture_output=True, timeout=5,
            env={"PATH": os.environ["PATH"], "PYTHONDONTWRITEBYTECODE": "1"})
        self.assertEqual(process.returncode, 2)
        self.assertEqual(process.stderr, b"")
        self.assertEqual(json.loads(process.stdout), {"status":"BLOCK_REASON_ARGS"})


if __name__ == "__main__":
    unittest.main()
