"""Focused unit observation/privacy/admission tests; no network or real units."""
from contextlib import ExitStack, redirect_stdout
import copy
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import c4_unit_contract as c
import c4_unit_readonly as worker
import protected_c4_unit_readonly as gate
import protected_c4_operator_repair as transport

sys.path.insert(0, str(Path(__file__).parent / "candidates"))
import c4_unit_pin_plan as pins

RAW = b"[Unit]\nDescription=Unique offline unit 39213017307\n[Service]\nEnvironmentFile=-" + c.ENV.encode() + b"\nEnvironment=PRIVATE_FIXTURE_ONLY=never-print\n"
SHA, RID = "a" * 40, "999000123"


def receipt():
    return {"status": "C4_UNIT_OBSERVED", "incidentRun": c.INCIDENT,
            "sourceSha": SHA, "runId": RID, "beforeSha256": c.OLD_UNIT_SHA256,
            "afterSha256": c.digest(RAW.replace(b"EnvironmentFile=-", b"EnvironmentFile=", 1)),
            "unitBytes": len(RAW), "removedBytes": 1, "planState": "REMOVE_ONE_OPTIONAL_BYTE",
            "environmentFiles": "EXACT_EXPECTED_OPTIONAL", "needDaemonReload": "no",
            "metadata": "ROOT_CONTROLLED_SINGLE_LINK", "process": "STABLE_ACROSS_TWO_READS",
            "rawUnitExported": False, "serverWrites": False, "replayAllowed": False,
            "historicalWrite": "UNKNOWN", "snapshot": "NON_ATOMIC_CURRENT_ONLY"}


def context():
    return dict(GITHUB_ACTIONS="true", GITHUB_REPOSITORY=transport.REPO, GITHUB_REF="refs/heads/main",
                GITHUB_EVENT_NAME="workflow_dispatch", GITHUB_WORKFLOW_REF=gate.WORKFLOW,
                GITHUB_ACTOR=transport.OWNER, GITHUB_TRIGGERING_ACTOR=transport.OWNER,
                GITHUB_ACTOR_ID=transport.OWNER_ID, GITHUB_RUN_ATTEMPT="1", STAGING_SSH_USER="project_ayfaar",
                GITHUB_SHA=SHA, GITHUB_WORKFLOW_SHA=SHA, STAGING_REVIEWED_MAIN_SHA=SHA,
                C4_OPERATOR_CONFIRM=gate.PREFIX + SHA, C4_OPERATOR_INCIDENT=c.INCIDENT,
                GITHUB_RUN_ID=RID, STAGING_SSH_HOST="unit-fixture.invalid", STAGING_SSH_PORT="22",
                STAGING_SSH_PRIVATE_KEY="offline-key-never-used-" * 8,
                GITHUB_TOKEN="offline-metadata-token-never-used")


def props():
    return dict(ActiveState="active", SubState="running", LoadState="loaded", User="asi-runtime",
                Group="asi-runtime", WorkingDirectory="/var/www/asi-staging/current",
                EnvironmentFiles=c.ENV + " (ignore_errors=yes)", DropInPaths="", FragmentPath=c.UNIT,
                NeedDaemonReload="no", MainPID="42", InvocationID="b" * 32,
                ExecMainStartTimestampMonotonic="1234567")


class UnitReadonlyTests(unittest.TestCase):
    def test_byte_exact_lf_crlf_spaces_and_no_final_newline(self):
        for raw in (RAW, RAW.replace(b"\n", b"\r\n"), RAW[:-1],
                    RAW.replace(b"EnvironmentFile=-", b" \tEnvironmentFile =\t -")):
            p = c.plan(raw, c.digest(raw))
            i = p["removedByteOffset"]
            self.assertEqual(p["output"][:i] + b"-" + p["output"][i:], raw)
            self.assertEqual(p["afterSha256"], c.digest(p["output"]))
            self.assertEqual(p["removedBytes"], 1)

    def test_receipt_replay_flag_requires_literal_false(self):
        expected = receipt()
        self.assertEqual(c.validate_receipt(expected, SHA, RID), expected)
        for replay in (True, 0, 1, None, "false", [], {}):
            with self.subTest(replay=replay), self.assertRaises(c.Block):
                c.validate_receipt(dict(expected, replayAllowed=replay), SHA, RID)

    def test_real_old_pin_rejects_synthetic_and_ambiguous_content(self):
        with self.assertRaisesRegex(c.Block, "OLD_HASH"):
            c.plan(RAW)
        for raw in (RAW.replace(b"EnvironmentFile=-", b"EnvironmentFile=\nEnvironmentFile=-"),
                    RAW + b"EnvironmentFile=/extra\n", RAW.replace(c.ENV.encode(), b"/other"),
                    RAW.replace(b"[Service]", b"[Unit]"), RAW + b"# continuation\\\n",
                    RAW + b"\0", RAW + b"\v", RAW.replace(b"EnvironmentFile=-", b'EnvironmentFile="-'),
                    RAW.replace(c.ENV.encode(), b"%n"), b"\xef\xbb\xbf" + RAW):
            with self.subTest(raw=raw[:30]), self.assertRaises(c.Block):
                c.plan(raw, c.digest(raw))

    def test_already_mandatory_is_not_reapplied(self):
        raw = RAW.replace(b"EnvironmentFile=-", b"EnvironmentFile=", 1)
        p = c.plan(raw, c.digest(raw))
        self.assertEqual((p["removedBytes"], p["planState"], p["output"]),
                         (0, "ALREADY_MANDATORY_ON_DISK", raw))

    def test_real_file_symlink_hardlink_fifo_permissions_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp); path = folder / "unit"
            path.write_bytes(RAW); path.chmod(0o644)
            fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
            try:
                self.assertEqual(c.read_regular(fd, "unit")[0], RAW)
                (folder / "link").symlink_to(path)
                os.link(path, folder / "hard")
                os.mkfifo(folder / "fifo", 0o600)
                for name in ("unit", "link", "fifo", "../unit"):
                    with self.subTest(name=name), self.assertRaises((c.Block, OSError)):
                        c.read_regular(fd, name)
                (folder / "hard").unlink()
                path.chmod(0o666)
                with self.assertRaisesRegex(c.Block, "METADATA"):
                    c.read_regular(fd, "unit")
            finally:
                os.close(fd)

    def test_replacement_during_read_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp); path = folder / "unit"
            path.write_bytes(RAW); path.chmod(0o644)
            fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
            original = c.os.listxattr
            def race(file_fd):
                replacement = folder / "replacement"; replacement.write_bytes(RAW)
                replacement.chmod(0o644); os.replace(replacement, path)
                return original(file_fd)
            try:
                with patch.object(c.os, "listxattr", side_effect=race), self.assertRaisesRegex(c.Block, "READ_RACE"):
                    c.read_regular(fd, "unit")
            finally:
                os.close(fd)

    def observe_fixture(self, states=None):
        stack = ExitStack(); self.addCleanup(stack.close)
        temp = stack.enter_context(tempfile.TemporaryDirectory())
        folder = Path(temp); (folder / "asi-landing-staging.service").write_bytes(RAW)
        (folder / "asi-landing-staging.service").chmod(0o644)
        stack.enter_context(patch.object(c, "open_parent", side_effect=lambda _: os.open(folder, os.O_RDONLY | os.O_DIRECTORY)))
        original_plan = c.plan
        stack.enter_context(patch.object(c, "plan", side_effect=lambda b: original_plan(b, c.digest(RAW))))
        stack.enter_context(patch.object(c, "OLD_UNIT_SHA256", c.digest(RAW)))
        stack.enter_context(patch.object(worker.os, "uname", return_value=SimpleNamespace(nodename=worker.HOST)))
        stack.enter_context(patch.object(worker, "properties", side_effect=states or [props(), props()]))
        return worker.observe(RID, SHA)

    def test_observer_uses_actual_bytes_without_exporting_them(self):
        r = self.observe_fixture()
        self.assertEqual(r["beforeSha256"], c.digest(RAW))
        self.assertEqual(r["afterSha256"], c.digest(RAW.replace(b"EnvironmentFile=-", b"EnvironmentFile=", 1)))
        wire = json.dumps(r)
        for secret in ("PRIVATE_FIXTURE_ONLY", "never-print", "EnvironmentFile=-", "42", "1234567"):
            self.assertNotIn('"' + secret + '"', wire)
        self.assertNotIn("never-print", wire)
        self.assertFalse(r["rawUnitExported"])
        self.assertFalse(r["replayAllowed"])

    def test_manager_process_drift_and_duplicate_properties_block(self):
        for key, value in (("MainPID", "43"), ("InvocationID", "c" * 32), ("NeedDaemonReload", "yes"),
                           ("EnvironmentFiles", c.ENV + " (ignore_errors=no)")):
            a, b = props(), props(); b[key] = value
            with self.subTest(key=key), self.assertRaises(c.Block):
                self.observe_fixture([a, b])
            self.doCleanups()
        raw = "\n".join(k + "=" + v for k, v in props().items()).encode()
        with patch.object(worker.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=raw + b"\nMainPID=43\n")):
            with self.assertRaisesRegex(c.Block, "PROPERTIES"):
                worker.properties(time.monotonic() + 10)

    def test_wire_rejects_secrets_duplicates_coercions_and_wrong_binding(self):
        expected = receipt()
        self.assertEqual(gate.decode(json.dumps(expected).encode(), 0, SHA, RID), expected)
        cases = [dict(expected, extra="DO_NOT_PRINT"), dict(expected, unitBytes=True),
                 dict(expected, removedBytes=True), dict(expected, sourceSha="b" * 40),
                 dict(expected, runId="123"), dict(expected, replayAllowed=0),
                 dict(expected, afterSha256="DO_NOT_PRINT"), dict(expected, needDaemonReload=[])]
        for case in cases:
            with self.subTest(case=list(case)[-1]), self.assertRaises(transport.RemoteOutcome):
                gate.decode(json.dumps(case).encode(), 0, SHA, RID)
        for raw in (b'{"status":"x","status":"y"}', b'x' * 4097, b'NaN', b'[]'):
            with self.assertRaises(transport.RemoteOutcome):
                gate.decode(raw, 2, SHA, RID)

    def test_admission_ref_owner_scope_sha_attempt_guards(self):
        good = context(); self.assertEqual(gate.validate(good)[:2], (SHA, RID))
        for key in good:
            if key == "GITHUB_TOKEN":
                continue
            bad = dict(good, **{key: "" if key in ("STAGING_SSH_HOST", "STAGING_SSH_PRIVATE_KEY") else "wrong"})
            with self.subTest(key=key), self.assertRaises(transport.Block):
                gate.validate(bad)
        with self.assertRaises(transport.Block):
            transport.validate(good)

    def test_prior_run_competition_and_main_drift_block_before_ssh(self):
        def data(endpoint, _):
            if endpoint == "branches/main":
                return {"commit": {"sha": SHA}, "protected": True}
            if endpoint == "actions/workflows/" + gate.WORKFLOW_FILE:
                return {"id": 999, "path": ".github/workflows/" + gate.WORKFLOW_FILE, "state": "active"}
            if endpoint.startswith("actions/workflows/"):
                return {"total_count": 1, "workflow_runs": [{"id": int(RID), "event": "workflow_dispatch", "head_sha": SHA,
                        "head_branch": "main", "run_attempt": 1, "workflow_id": 999}]}
            return {"total_count": 0, "workflow_runs": []}
        self.assertEqual(gate.current_main_and_first_dispatch(context(), data), (SHA, RID))
        for mode in ("prior", "main", "competing"):
            def bad(endpoint, token):
                value = data(endpoint, token)
                if mode == "main" and endpoint == "branches/main":value["commit"]["sha"] = "b" * 40
                if mode == "prior" and endpoint.startswith("actions/workflows/") and "runs?" in endpoint:value["total_count"] = 2
                if mode == "competing" and "status=waiting" in endpoint:value = {"total_count": 1, "workflow_runs": [{"id": 1}]}
                return value
            with self.subTest(mode=mode), self.assertRaises(transport.Block):
                gate.current_main_and_first_dispatch(context(), bad)

    def test_payload_and_main_do_not_expose_unknown_failure(self):
        payload = gate.payload(); compile(payload, "unit-readonly-payload", "exec")
        for denied in (b"c4_unit_transaction", b"c4_operator_host", b"staging_no_send_host", b"daemon-reload", b"STAGING_DATABASE_URL"):
            self.assertNotIn(denied, payload)
        out = io.StringIO()
        with patch.object(gate, "current_main_and_first_dispatch", side_effect=RuntimeError("DO_NOT_PRINT")), redirect_stdout(out):
            self.assertEqual(gate.main(), 2)
        self.assertEqual(json.loads(out.getvalue()), {"status": "C4_UNIT_ADMISSION_OR_TRANSPORT_BLOCK"})

    def test_workflow_keeps_protection_and_contains_no_apply_job(self):
        path = Path(__file__).resolve().parents[2] / ".github/workflows" / gate.WORKFLOW_FILE
        source = path.read_text()
        self.assertIn("environment: staging", source)
        self.assertIn("cancel-in-progress: false", source)
        self.assertIn("strigunov4-staging-nine-sql-apply", source)
        self.assertIn('test "$GITHUB_RUN_ATTEMPT" = \'1\'', source)
        self.assertIn('test "$REVIEWED_SHA" = "$GITHUB_SHA"', source)
        self.assertIn("needs: [isolated_unit_tests]", source)
        self.assertNotIn("STAGING_DATABASE_URL", source)
        self.assertNotIn("c4_unit_transaction.py", source)
        self.assertNotIn("contents: write", source)
        paths_filter = source.split("workflow_dispatch:", 1)[0]
        for consumer in (*pins.ACTIVE, pins.HISTORICAL):
            self.assertIn("      - '" + consumer + "'", paths_filter)

    def test_all_four_current_pins_updated_in_memory_history_unchanged(self):
        root = Path(__file__).resolve().parents[2]
        files = {name: (root / name).read_bytes() for name in (*pins.ACTIVE, pins.HISTORICAL)}
        new = pins.plan(files, receipt(), SHA, RID)
        self.assertEqual(new[pins.HISTORICAL], files[pins.HISTORICAL])
        for name in pins.ACTIVE:
            self.assertEqual(new[name], files[name].replace(c.OLD_UNIT_SHA256.encode(), receipt()["afterSha256"].encode(), 1))
        changed = dict(files); name = next(iter(pins.ACTIVE)); changed[name] += b"# concurrent\n"
        with self.assertRaisesRegex(c.Block, "OLD_HASH"):
            pins.plan(changed, receipt(), SHA, RID)

    def test_reused_transport_disables_bytecode_and_rejects_checkout_drift(self):
        env = context()
        def checked(args, **_):
            if args[0] == "git":return (SHA + "\n").encode()
            if args[0] == "ssh-keyscan":return b"unit-fixture.invalid ssh-ed25519 synthetic\n"
            return ("256 " + transport.HOSTKEY_FP + " offline\n").encode()
        with patch.object(transport, "checked", side_effect=checked), \
                patch.object(transport.subprocess, "run", return_value=SimpleNamespace(stdout=b"{}", returncode=0)) as run:
            transport.execute(env, admit=gate.validate, build=lambda _: b"# inert fixture", decode=lambda *_: {})
            args = run.call_args.args[0]
            i = args.index("python3")
            self.assertEqual(args[i:i + 3], ["python3", "-B", "-"])
        with patch.object(transport, "checked", return_value=b"b" * 40), patch.object(transport.subprocess, "run") as run:
            with self.assertRaises(transport.Block):
                transport.execute(env, admit=gate.validate, build=lambda _: b"", decode=lambda *_: {})
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
