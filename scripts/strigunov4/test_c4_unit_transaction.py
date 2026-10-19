"""Linux files, flock, atomic replace, real SIGTERM/SIGKILL; manager simulated."""
from contextlib import contextmanager
import fcntl
import json
import multiprocessing
import os
from pathlib import Path
import signal
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import c4_unit_contract as c
sys.path.insert(0, str(Path(__file__).parent / "candidates"))
import c4_unit_transaction as tx

RAW = b"[Unit]\nDescription=Disposable unit transaction fixture\n[Service]\nEnvironmentFile=-" + c.ENV.encode() + b"\n"


class Fixture:
    def __init__(self, root):
        self.root = Path(root)
        self.units = self.root / "units"; self.units.mkdir(mode=0o700)
        self.records = self.root / "records"; self.records.mkdir(mode=0o700)
        self.unit = self.units / "asi-landing-staging.service"
        self.unit.write_bytes(RAW); self.unit.chmod(0o644)
        os.setxattr(self.unit, "user.c4-offline-proof", b"private-fixture-attribute")
        self.record = self.records / "fresh-unit-contract-attempt"
        self.lock = self.root / "shared.lock"; self.lock.write_bytes(b"retained-lock-metadata"); self.lock.chmod(0o600)
        self.manager = self.root / "simulated-manager.private"
        self.manager.write_text("optional"); self.manager.chmod(0o600)
        self.new = c.plan(RAW, c.digest(RAW))["output"]
        self.binding = {"sourceSha": "a" * 40, "runId": "999000123", "oldSha256": c.digest(RAW), "newSha256": c.digest(self.new)}
        self.calls = []
        self.now = None

    def observe(self, deadline):
        return {"unitSha256": c.digest(self.unit.read_bytes()), "environmentFiles": self.manager.read_text(),
                "processToken": "c" * 64, "otherStateToken": "d" * 64, "noSend": True, "health": True}

    def reload(self, deadline):
        self.calls.append(deadline)
        self.manager.write_text("optional" if b"EnvironmentFile=-" in self.unit.read_bytes() else "mandatory")

    def isolation(self, deadline):
        return None  # Explicit simulation, never an assertion about a real host.

    def apply(self, **kw):
        options = dict(observe=self.observe, reload_manager=self.reload, isolation=self.isolation)
        options.update(kw)
        return tx.apply(self.unit, self.record, [str(self.lock)], self.binding, **options)

    def recover(self):
        return tx.recover_explicit(self.unit, self.record, [str(self.lock)], self.binding, "999000124",
                                   self.observe, self.reload, self.isolation)


@contextmanager
def fixture():
    with tempfile.TemporaryDirectory(prefix="c4-unit-offline-") as root:
        yield Fixture(root)


class UnitTransactionTests(unittest.TestCase):
    def test_success_preserves_bytes_metadata_xattrs_and_private_backup(self):
        with fixture() as f:
            before = f.unit.stat(); attrs = os.getxattr(f.unit, "user.c4-offline-proof")
            self.assertEqual(f.apply(), "UNIT_CONTRACT_OBSERVED")
            self.assertEqual(f.unit.read_bytes(), f.new)
            self.assertEqual((f.record / "original.unit.private").read_bytes(), RAW)
            self.assertEqual((f.record / "original.unit.private").stat().st_mode & 0o777, 0o600)
            self.assertEqual(f.unit.stat().st_mtime_ns, before.st_mtime_ns)
            self.assertEqual(f.unit.stat().st_mode & 0o777, 0o644)
            self.assertEqual(os.getxattr(f.unit, "user.c4-offline-proof"), attrs)
            success = json.loads((f.record / "success.json").read_text())
            self.assertEqual(success["operatorAdmission"], "NOT_PROVEN")
            self.assertEqual(len(f.calls), 1)

    def test_unknown_pin_unsealed_hash_and_identity_fail_before_record(self):
        for change in ({"newSha256": None}, {"newSha256": "e" * 64}, {"oldSha256": "f" * 64}, {"sourceSha": "bad"}):
            with fixture() as f:
                f.binding.update(change)
                with self.assertRaises((c.Block, TypeError)):
                    f.apply()
                self.assertFalse(f.record.exists())
                self.assertEqual(f.unit.read_bytes(), RAW)
                self.assertEqual(f.calls, [])

    def test_completed_or_rolled_back_attempt_cannot_replay(self):
        with fixture() as f:
            f.apply()
            with self.assertRaises(c.Block):f.apply()
            with self.assertRaises(c.Block):f.recover()
        for phase in ("PREPARED", "RELOADED"):
            with self.subTest(phase=phase), fixture() as f:
                def stop(stage):
                    if stage == phase:raise RuntimeError("simulated")
                self.assertEqual(f.apply(hook=stop), "ORIGINAL_BLOCKED_BASELINE_RESTORED")
                with self.assertRaises(FileExistsError):f.apply()
                before = {p.name: p.read_bytes() for p in f.record.iterdir()}
                calls = list(f.calls)
                with self.assertRaises(c.Block):f.recover()
                self.assertEqual(f.calls, calls)
                self.assertEqual({p.name: p.read_bytes() for p in f.record.iterdir()}, before)
                self.assertFalse((f.record / "explicit-recovery-request.json").exists())

    def test_kernel_lock_and_invalid_lock_metadata_block(self):
        with fixture() as f:
            fd = os.open(f.lock, os.O_RDWR); fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                with self.assertRaises(BlockingIOError):f.apply()
            finally:
                os.close(fd)
            self.assertFalse(f.record.exists())
            f.lock.chmod(0o666)
            with self.assertRaises(c.Block):f.apply()
            self.assertEqual(f.lock.read_bytes(), b"retained-lock-metadata")

    def test_exception_at_every_durable_phase_restores_original_baseline(self):
        for target in ("PREPARED", "APPLY_INTENT", "REPLACED", "RELOAD_INTENT", "RELOADED", "VERIFIED"):
            with self.subTest(phase=target), fixture() as f:
                def stop(stage):
                    if stage == target:raise RuntimeError("simulated phase error")
                self.assertEqual(f.apply(hook=stop), "ORIGINAL_BLOCKED_BASELINE_RESTORED")
                self.assertEqual(f.unit.read_bytes(), RAW)
                self.assertEqual(f.manager.read_text(), "optional")
                self.assertFalse((f.record / "success.json").exists())
                self.assertEqual((f.record / "original.unit.private").read_bytes(), RAW)

    def test_reload_timeout_uses_reserved_rollback_budget(self):
        with fixture() as f:
            now = [0.0]; first = [True]
            def reload(deadline):
                if first[0]:
                    first[0] = False
                    self.assertEqual(deadline, 90)
                    now[0] = 100
                    raise TimeoutError()
                self.assertEqual(deadline, 180)
                f.reload(deadline)
            self.assertEqual(f.apply(reload_manager=reload, clock=lambda: now[0]), "ORIGINAL_BLOCKED_BASELINE_RESTORED")
            self.assertEqual(f.unit.read_bytes(), RAW)

    def test_exhausted_hard_deadline_preserves_evidence_without_fake_success(self):
        with fixture() as f:
            now = [0.0]
            def fail(deadline):
                now[0] = 181
                raise TimeoutError()
            self.assertEqual(f.apply(reload_manager=fail, clock=lambda: now[0]), "MANUAL_RECOVERY_REQUIRED")
            self.assertEqual(f.unit.read_bytes(), f.new)
            self.assertEqual((f.record / "original.unit.private").read_bytes(), RAW)
            self.assertFalse((f.record / "success.json").exists())

    def test_concurrent_bytes_are_not_overwritten_by_rollback(self):
        with fixture() as f:
            foreign = b"[Service]\nDescription=Concurrent offline edit\n"
            def change(stage):
                if stage == "REPLACED":
                    f.unit.write_bytes(foreign)
                    raise RuntimeError()
            self.assertEqual(f.apply(hook=change), "MANUAL_RECOVERY_REQUIRED")
            self.assertEqual(f.unit.read_bytes(), foreign)
            self.assertEqual(f.calls, [])
            self.assertFalse((f.record / "success.json").exists())

    def test_corrupt_backup_or_metadata_blocks_explicit_recovery(self):
        with fixture() as f:
            def stop(stage):
                if stage == "PREPARED":raise RuntimeError()
            f.apply(hook=stop)
            (f.record / "original.unit.private").write_bytes(b"corrupt private backup")
            with self.assertRaises(c.Block):f.recover()
            self.assertEqual(f.unit.read_bytes(), RAW)
            self.assertEqual(tx.inspect_recovery(f.unit, f.record, f.binding), "EVIDENCE_INCOMPLETE_MANUAL_ONLY")

    def _child_at_phase(self, f, phase, signum):
        ctx = multiprocessing.get_context("fork")
        parent, child = ctx.Pipe(duplex=False)
        def run():
            parent.close()
            def stop(stage):
                if stage == phase:
                    child.send(stage)
                    signal.pause()
            status = f.apply(hook=stop)
            child.send(status)
        p = ctx.Process(target=run); p.start(); child.close()
        try:
            self.assertTrue(parent.poll(5), "child failed to reach exact phase")
            self.assertEqual(parent.recv(), phase)
            os.kill(p.pid, signum)
            p.join(5)
            self.assertFalse(p.is_alive(), "child exceeded bounded termination/recovery wait")
            result = None
            if signum == signal.SIGTERM:
                self.assertTrue(parent.poll(1)); result = parent.recv()
            return p.exitcode, result
        finally:
            if p.is_alive():os.kill(p.pid, signal.SIGKILL); p.join(2)
            parent.close()

    def test_real_sigterm_recovers_without_restart(self):
        with fixture() as f:
            code, result = self._child_at_phase(f, "RELOADED", signal.SIGTERM)
            self.assertEqual((code, result), (0, "ORIGINAL_BLOCKED_BASELINE_RESTORED"))
            self.assertEqual(f.unit.read_bytes(), RAW)
            self.assertEqual(f.manager.read_text(), "optional")
            self.assertFalse((f.record / "success.json").exists())

    def test_real_sigkill_no_replay_then_separate_explicit_recovery(self):
        for phase in ("PREPARED", "REPLACED", "RELOADED", "VERIFIED"):
            with self.subTest(phase=phase), fixture() as f:
                code, _ = self._child_at_phase(f, phase, signal.SIGKILL)
                self.assertEqual(code, -signal.SIGKILL)
                self.assertFalse((f.record / "success.json").exists())
                expected = "OLD_BYTES_REQUIRE_EXPLICIT_RECOVERY" if phase == "PREPARED" else "NEW_BYTES_REQUIRE_EXPLICIT_RECOVERY"
                self.assertEqual(tx.inspect_recovery(f.unit, f.record, f.binding), expected)
                with self.assertRaises((c.Block, FileExistsError)):f.apply()
                self.assertEqual(f.recover(), "ORIGINAL_BLOCKED_BASELINE_RESTORED")
                self.assertEqual(f.unit.read_bytes(), RAW)
                self.assertEqual(f.manager.read_text(), "optional")
                with self.assertRaises(c.Block):f.recover()

    def test_real_sigkill_inside_rollback_allows_separate_recovery(self):
        for cut in ("INTENT", "REPLACE"):
            with self.subTest(cut=cut), fixture() as f:
                ctx = multiprocessing.get_context("fork")
                parent, child = ctx.Pipe(duplex=False)
                def run():
                    parent.close()
                    write, replace = tx.durable_new, tx.replace_exact
                    def pause():
                        child.send(cut); signal.pause()
                    def write_hook(fd, name, data):
                        write(fd, name, data)
                        if cut == "INTENT" and name == "rollback-intent.json":pause()
                    def replace_hook(*args):
                        if cut == "REPLACE" and args[2] == f.new:pause()
                        return replace(*args)
                    def fail(stage):
                        if stage == "RELOADED":raise RuntimeError("start rollback")
                    with patch.object(tx, "durable_new", side_effect=write_hook), \
                            patch.object(tx, "replace_exact", side_effect=replace_hook):
                        f.apply(hook=fail)
                process = ctx.Process(target=run); process.start(); child.close()
                try:
                    self.assertTrue(parent.poll(5), "rollback did not reach cut")
                    self.assertEqual(parent.recv(), cut)
                    os.kill(process.pid, signal.SIGKILL); process.join(5)
                    self.assertFalse(process.is_alive())
                    self.assertEqual(process.exitcode, -signal.SIGKILL)
                finally:
                    if process.is_alive():os.kill(process.pid, signal.SIGKILL); process.join(2)
                    parent.close()
                intent = (f.record / "rollback-intent.json").read_bytes()
                existing_candidates = {p.name: p.read_bytes() for p in f.units.glob(".c4-unit-candidate-*")}
                self.assertEqual(f.unit.read_bytes(), f.new)
                self.assertEqual(f.recover(), "ORIGINAL_BLOCKED_BASELINE_RESTORED")
                self.assertEqual(f.unit.read_bytes(), RAW)
                self.assertEqual(f.manager.read_text(), "optional")
                self.assertEqual((f.record / "rollback-intent.json").read_bytes(), intent)
                self.assertEqual({p.name: p.read_bytes() for p in f.units.glob(".c4-unit-candidate-*")}, existing_candidates)
                if cut == "INTENT":self.assertEqual(existing_candidates, {})
                with self.assertRaises(c.Block):f.recover()

    def test_rollback_intent_mismatch_and_replace_failure_leave_no_new_candidate(self):
        for mode in ("MISMATCH", "REPLACE_FAILURE", "CANDIDATE_FAILURE", "FOREIGN_CANDIDATE"):
            with self.subTest(mode=mode), fixture() as f:
                replace = tx.replace_exact
                utime = tx.os.utime
                rolling_back = [False]
                def fail(stage):
                    if stage == "RELOADED":
                        rolling_back[0] = True
                        if mode == "MISMATCH":
                            p = f.record / "rollback-intent.json"
                            p.write_bytes(b'{"targetSha256":"wrong"}\n'); p.chmod(0o600)
                        raise RuntimeError("start rollback")
                def refuse(*args):
                    if mode == "REPLACE_FAILURE" and args[2] == f.new:raise OSError("before replacement")
                    return replace(*args)
                def fail_candidate(*args, **kwargs):
                    if mode == "FOREIGN_CANDIDATE" and rolling_back[0]:
                        candidate, = f.units.glob(".c4-unit-candidate-*")
                        foreign = f.root / "foreign-unit-fixture"
                        foreign.write_bytes(b"concurrent candidate bytes")
                        os.replace(foreign, candidate)
                        raise OSError("candidate replaced by another writer")
                    if mode == "CANDIDATE_FAILURE" and rolling_back[0]:raise OSError("candidate metadata failure")
                    return utime(*args, **kwargs)
                with patch.object(tx, "replace_exact", side_effect=refuse), \
                        patch.object(tx.os, "utime", side_effect=fail_candidate):
                    self.assertEqual(f.apply(hook=fail), "MANUAL_RECOVERY_REQUIRED")
                self.assertEqual(f.unit.read_bytes(), f.new)
                if mode == "FOREIGN_CANDIDATE":
                    candidate, = f.units.glob(".c4-unit-candidate-*")
                    self.assertEqual(candidate.read_bytes(), b"concurrent candidate bytes")
                else:
                    self.assertEqual(list(f.units.glob(".c4-unit-candidate-*")), [])
                self.assertFalse((f.record / "recovery.json").exists())

    def test_atomic_visibility_to_independent_reader(self):
        with fixture() as f:
            samples = []; stop = threading.Event(); ready = threading.Event()
            def read():
                while not stop.is_set():
                    samples.append(f.unit.read_bytes()); ready.set()
            thread = threading.Thread(target=read); thread.start()
            try:
                self.assertTrue(ready.wait(2))
                self.assertEqual(f.apply(), "UNIT_CONTRACT_OBSERVED")
                samples.append(f.unit.read_bytes())
            finally:
                stop.set(); thread.join(2)
            self.assertFalse(thread.is_alive())
            self.assertIn(RAW, samples); self.assertIn(f.new, samples)
            self.assertTrue(all(x in (RAW, f.new) for x in samples))

    def test_uncertain_success_finalization_never_becomes_admission(self):
        with fixture() as f:
            original = tx.durable_new
            def fail_after_visible(fd, name, data):
                original(fd, name, data)
                if name == "success.json":raise OSError("simulated directory durability failure")
            with patch.object(tx, "durable_new", side_effect=fail_after_visible):
                self.assertEqual(f.apply(), "ORIGINAL_BLOCKED_BASELINE_RESTORED")
            self.assertTrue((f.record / "success.json").exists())
            self.assertTrue((f.record / "recovery-started.json").exists())
            self.assertTrue((f.record / "recovery.json").exists())
            self.assertEqual(tx.inspect_recovery(f.unit, f.record, f.binding), "OLD_BYTES_REQUIRE_EXPLICIT_RECOVERY")

    def test_isolation_not_proven_stops_before_any_claim_or_service_action(self):
        with fixture() as f:
            def refuse(_):raise c.Block("IDENTITY")
            with self.assertRaises(c.Block):f.apply(isolation=refuse)
            self.assertFalse(f.record.exists())
            self.assertEqual(f.unit.read_bytes(), RAW)
            self.assertEqual(f.calls, [])

    def test_uncertain_inflight_reload_never_triggers_a_second_reload(self):
        with fixture() as f:
            inflight = [False]
            def reload(deadline):
                f.reload(deadline)
                inflight[0] = True
                raise TimeoutError("manager completion unknown")
            def isolation(deadline):
                if inflight[0]:raise c.Block("IDENTITY")
            self.assertEqual(f.apply(reload_manager=reload, isolation=isolation), "MANUAL_RECOVERY_REQUIRED")
            self.assertEqual(len(f.calls), 1)
            self.assertEqual(f.unit.read_bytes(), RAW)
            self.assertEqual(f.manager.read_text(), "mandatory")
            self.assertFalse((f.record / "success.json").exists())

    def test_process_drift_cannot_be_hidden_by_successful_disk_rollback(self):
        with fixture() as f:
            changed = [False]
            def reload(deadline):
                f.reload(deadline)
                changed[0] = True
            def observe(deadline):
                state = f.observe(deadline)
                if changed[0]:state["processToken"] = "e" * 64
                return state
            self.assertEqual(f.apply(reload_manager=reload, observe=observe), "MANUAL_RECOVERY_REQUIRED")
            self.assertEqual(f.unit.read_bytes(), RAW)
            self.assertEqual(f.manager.read_text(), "optional")
            self.assertFalse((f.record / "success.json").exists())


if __name__ == "__main__":
    unittest.main()
