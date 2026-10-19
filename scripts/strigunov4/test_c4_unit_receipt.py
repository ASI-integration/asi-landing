"""Offline fixtures only. Synthetic hashes are never evidence for the real unit."""
from contextlib import redirect_stdout
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import c4_unit_contract as c
import c4_unit_receipt_envelope as e
import protected_c4_unit_receipt as gate
import protected_c4_unit_readonly as reader
import protected_c4_operator_repair as transport
import test_c4_unit_readonly as fixtures

SHA, RID = fixtures.SHA, fixtures.RID


def receipt():
    """Build a synthetic receipt matching the observed byte-count contract only."""
    return dict(fixtures.receipt(), unitBytes=454)


def context():
    """Build an offline dispatch fixture bound to the new workflow and confirmation."""
    return dict(fixtures.context(), GITHUB_WORKFLOW_REF=gate.WORKFLOW,
                C4_OPERATOR_CONFIRM=gate.PREFIX + SHA)


def api(endpoint, _):
    """Serve in-memory GitHub responses; no request reaches GitHub or staging."""
    if endpoint == "branches/main":
        return {"commit": {"sha": SHA}, "protected": True}
    if endpoint == "actions/workflows/" + gate.WORKFLOW_FILE:
        return {"id": 888, "path": ".github/workflows/" + gate.WORKFLOW_FILE, "state": "active"}
    if endpoint.startswith("actions/workflows/" + gate.WORKFLOW_FILE + "/runs?"):
        return {"total_count": 1, "workflow_runs": [{"id": int(RID), "workflow_id": 888,
                "event": "workflow_dispatch", "head_sha": SHA, "head_branch": "main", "run_attempt": 1}]}
    if endpoint.startswith("actions/workflows/" + reader.WORKFLOW_FILE + "/runs?"):
        return {"total_count": 1, "workflow_runs": [{"id": gate.PREVIOUS_RUN,
                "workflow_id": gate.PREVIOUS_WORKFLOW, "head_sha": gate.PREVIOUS_SHA,
                "head_branch": "main", "event": "workflow_dispatch", "run_attempt": 1,
                "status": "completed", "conclusion": "success"}]}
    return {"total_count": 0, "workflow_runs": []}


class EncryptedReceiptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        """Generate one disposable RSA certificate and key for isolated crypto tests."""
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.key, cls.cert_path = cls.root / "fixture.key", cls.root / "fixture.crt"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "2",
                        "-subj", "/CN=OFFLINE-DISPOSABLE-FIXTURE", "-keyout", str(cls.key),
                        "-out", str(cls.cert_path)], check=True, capture_output=True)
        cls.cert = cls.cert_path.read_bytes()
        cls.output = cls.root / "step-output"
        cls.fp = c.digest(e.command(["x509", "-outform", "DER"], cls.cert))

    @classmethod
    def tearDownClass(cls):
        """Remove only the disposable test certificate and key directory."""
        cls.temp.cleanup()

    def decrypt(self, cipher):
        """Decrypt test ciphertext using the disposable fixture recipient."""
        return e.command(["cms", "-decrypt", "-binary", "-inform", "DER", "-recip", str(self.cert_path),
                          "-inkey", str(self.key)], cipher)

    def test_01_real_authenticated_roundtrip_and_no_plaintext_file(self):
        """Verify CMS algorithms, exact roundtrip and ciphertext-only private storage."""
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td)
            expected = e.canonical(receipt(), SHA, RID)
            e.save(receipt(), SHA, RID, self.cert, folder, self.output)
            cipher = (folder / e.NAME).read_bytes()
            self.assertEqual(self.output.read_text(), "ciphertext_sha256=" + c.digest(cipher) + "\n")
            self.assertEqual(self.decrypt(cipher), expected)
            self.assertNotIn(receipt()["afterSha256"].encode(), cipher)
            structure = e.command(["cms", "-cmsout", "-print", "-inform", "DER"], cipher)
            for algorithm in (b"id-smime-ct-authEnvelopedData", b"aes-256-gcm", b"rsaesOaep", b"sha256"):
                self.assertIn(algorithm, structure)
            self.assertEqual({p.name for p in folder.iterdir()}, {e.NAME})
            self.assertEqual((folder / e.NAME).stat().st_mode & 0o777, 0o600)

    def test_02_tamper_truncation_wrong_key_rejected(self):
        """Reject modified, truncated or invalid CMS and an unrelated private key."""
        raw = e.canonical(receipt(), SHA, RID); cipher = e.encrypt(raw, self.cert)
        for corrupt in (cipher[:-1], cipher[:-1] + bytes([cipher[-1] ^ 1]), b"not-cms"):
            with self.subTest(length=len(corrupt)), self.assertRaises(c.Block):
                self.decrypt(corrupt)
        with tempfile.TemporaryDirectory() as td:
            wrong = Path(td) / "key"
            subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048",
                            "-out", str(wrong)], check=True, capture_output=True)
            with self.assertRaises(c.Block):
                e.command(["cms", "-decrypt", "-binary", "-inform", "DER", "-inkey", str(wrong)], cipher)

    def test_03_recipient_pin_and_crypto_fail_closed(self):
        """Check pinned recipient, crypto timeouts and the minimal Windows environment."""
        self.assertEqual(e.recipient(self.cert, self.fp), self.cert)
        with self.assertRaisesRegex(c.Block, "RECIPIENT"):
            e.recipient(self.cert)
        actual = e.regular(e.CERT, 8192)
        self.assertEqual(e.recipient(actual), actual)
        with patch.object(e.subprocess, "run", side_effect=subprocess.TimeoutExpired("openssl", 15)), \
                self.assertRaisesRegex(c.Block, "CRYPTO"):
            e.recipient(actual)
        with patch.object(e.os, "name", "nt"), patch.dict(os.environ, {"SYSTEMROOT": "C:/Windows", "OPENSSL_CONF": "SECRET"}), \
                patch.object(e.shutil, "which", return_value="fixture-openssl"), \
                patch.object(e.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=b"ok")) as run:
            self.assertEqual(e.command(["version"]), b"ok")
            self.assertEqual(set(run.call_args.kwargs["env"]), {"PATH", "LC_ALL", "SYSTEMROOT"})

    def test_04_schema_mask_duplicates_raw_fields_and_wrong_binding(self):
        """Reject masked hashes, extra fields, ambiguous JSON and incorrect run binding."""
        cases = [dict(receipt(), afterSha256="6e0ce129***"), dict(receipt(), rawUnit="SECRET"),
                 dict(receipt(), unitBytes=453), dict(receipt(), unitBytes=True),
                 dict(receipt(), beforeSha256="f" * 64), dict(receipt(), runId="123"),
                 dict(receipt(), sourceSha="b" * 40), dict(receipt(), replayAllowed=0)]
        for value in cases:
            with self.subTest(value=list(value)[-1]), patch.object(e, "encrypt") as encrypt, \
                    self.assertRaises(c.Block):
                e.save(value, SHA, RID, self.cert, self.root, self.output)
            encrypt.assert_not_called()
        for raw in (b'{"a":1,"a":2}', b'NaN'):
            with self.assertRaises(ValueError):
                c.strict_json(raw)

    def test_05_logs_contain_only_closed_statuses(self):
        """Do not depend on step outputs or logging after save; never expose receipt bytes."""
        for failure in (None, RuntimeError("SECRET-NEVER-LOG")):
            out = io.StringIO()
            with tempfile.TemporaryDirectory() as td, \
                    patch.dict(os.environ, {"GITHUB_OUTPUT": td}), \
                    patch.object(gate, "admit", return_value=(SHA, RID)), \
                    patch.object(e, "prepare", return_value=(self.cert, self.root)), \
                    patch.object(transport, "execute", return_value=receipt()), \
                    patch.object(e, "save", side_effect=failure), redirect_stdout(out):
                self.assertEqual(gate.main(), 2 if failure else 0)
            if failure:
                self.assertEqual(set(c.strict_json(out.getvalue())), {"status"})
            else:
                self.assertEqual(out.getvalue(), "")
            self.assertNotIn(receipt()["afterSha256"], out.getvalue())
            self.assertNotIn("SECRET", out.getvalue())

    def test_06_exclusive_output_links_and_readback_fail_closed(self):
        """Test binary preservation, exclusive writes, link refusal and exact readback."""
        with tempfile.TemporaryDirectory() as td:
            binary_path = Path(td) / "binary-fixture"
            binary = bytes(range(256)) + b"\r\n\n\x1a"
            e.write_new(binary_path, binary)
            self.assertEqual(binary_path.read_bytes(), binary)
            self.assertEqual(e.regular(binary_path, 4096), binary)
            env = dict(context(), RUNNER_TEMP=td, C4_RECEIPT_CIPHER_SHA256=c.digest(b"x" * 512))
            with patch.object(e, "encrypt", return_value=b"x" * 512):
                _, original = e.prepare(env)
                with self.assertRaises(FileExistsError): e.prepare(env)
            data = b"x" * 512
            e.write_new(original / e.NAME, data)
            with self.assertRaises(FileExistsError): e.write_new(original / e.NAME, data)
            download = original.with_name(original.name + "-download"); download.mkdir()
            with self.assertRaises(c.Block): e.verify_download(env)
            (download / e.NAME).write_bytes(data); e.verify_download(env)
            (download / e.NAME).write_bytes(b"y" * 512)
            with self.assertRaises(c.Block): e.verify_download(env)
            # Matching corrupted copies must still fail the original encryption pin.
            (original / e.NAME).write_bytes(b"y" * 512)
            with self.assertRaises(c.Block): e.verify_download(env)
            for missing in ("", "abc", "f" * 64):
                with self.assertRaises(c.Block):
                    e.verify_download(dict(env, C4_RECEIPT_CIPHER_SHA256=missing))
            (download / e.NAME).unlink(); (download / e.NAME).symlink_to(original / e.NAME)
            with self.assertRaises(c.Block): e.verify_download(env)
            (download / e.NAME).unlink(); os.link(original / e.NAME, download / e.NAME)
            with self.assertRaises(c.Block): e.verify_download(env)

    def test_07_first_new_dispatch_accepts_consumed_old_success(self):
        """Accept only the first new dispatch paired with the consumed successful old run."""
        self.assertEqual(gate.admit(context(), api), (SHA, RID))
        self.assertNotEqual(gate.WORKFLOW_FILE, reader.WORKFLOW_FILE)

    def test_08_wrong_actor_sha_attempt_confirmation_ref_rejected(self):
        """Reject changed owner, source, attempt and confirmation fields before execution."""
        for key in ("GITHUB_ACTOR", "GITHUB_ACTOR_ID", "GITHUB_TRIGGERING_ACTOR", "GITHUB_REF",
                    "GITHUB_SHA", "GITHUB_WORKFLOW_SHA", "GITHUB_RUN_ATTEMPT", "C4_OPERATOR_CONFIRM"):
            with self.subTest(key=key), self.assertRaises(transport.Block):
                gate.admit(dict(context(), **{key: "wrong"}), api)

    def test_09_previous_new_dispatch_even_failed_consumes_procedure(self):
        """Reject absent, additional, hidden or incorrectly typed new dispatch counts."""
        for count in (0, 2, True, 101):
            def changed(endpoint, token):
                """Return a deliberately altered in-memory API response for an admission test."""
                value = api(endpoint, token)
                if gate.WORKFLOW_FILE + "/runs?" in endpoint: value["total_count"] = count
                return value
            with self.subTest(count=count), self.assertRaises(transport.Block):
                gate.admit(context(), changed)

    def test_10_old_run_provenance_and_no_replay_are_mandatory(self):
        """Reject any departure from the fixed old run identity and successful completion."""
        for key, wrong in (("id", 1), ("head_sha", "b" * 40), ("run_attempt", 2),
                           ("workflow_id", 1), ("conclusion", "failure"), ("status", "in_progress")):
            def changed(endpoint, token):
                """Return a deliberately altered in-memory API response for an admission test."""
                value = api(endpoint, token)
                if reader.WORKFLOW_FILE + "/runs?" in endpoint: value["workflow_runs"][0][key] = wrong
                return value
            with self.subTest(key=key), self.assertRaises(transport.Block):
                gate.admit(context(), changed)

    def test_11_all_queues_and_hidden_pagination_block(self):
        """Reject competing runs of any event type and incomplete or malformed queues."""
        for state in ("queued", "in_progress", "waiting", "pending", "requested"):
            for active in ({"total_count": 1, "workflow_runs": [{"id": 1}]},
                           {"total_count": 1, "workflow_runs": [{"id": 2, "event": "push"}]},
                           {"total_count": 101, "workflow_runs": []},
                           {"total_count": True, "workflow_runs": [{"id": int(RID)}]}):
                def changed(endpoint, token):
                    """Return a deliberately altered in-memory API response for an admission test."""
                    if "actions/runs?" in endpoint:
                        self.assertNotIn("event=", endpoint)
                    return copy.deepcopy(active) if "status=" + state + "&" in endpoint else api(endpoint, token)
                with self.subTest(state=state), self.assertRaises(transport.Block):
                    gate.admit(context(), changed)

    def test_12_main_protection_and_workflow_identity(self):
        """Reject main drift, missing protection or a disabled workflow."""
        for mode in ("sha", "protection", "workflow"):
            def changed(endpoint, token):
                """Return a deliberately altered in-memory API response for an admission test."""
                value = api(endpoint, token)
                if mode == "sha" and endpoint == "branches/main": value["commit"]["sha"] = "b" * 40
                if mode == "protection" and endpoint == "branches/main": value["protected"] = False
                if mode == "workflow" and endpoint == "actions/workflows/" + gate.WORKFLOW_FILE: value["state"] = "disabled_manually"
                return value
            with self.subTest(mode=mode), self.assertRaises(transport.Block): gate.admit(context(), changed)

    def test_13_preflight_or_second_admission_failure_never_contacts_server(self):
        """Prove crypto preflight and repeated admission failures never invoke transport."""
        for phase in ("crypto", "second_admit"):
            with patch.object(gate, "admit", side_effect=[(SHA, RID), transport.Block("SECRET")]
                              if phase == "second_admit" else None, return_value=(SHA, RID)), \
                    patch.object(e, "prepare", side_effect=c.Block("SECRET") if phase == "crypto" else None,
                                 return_value=(self.cert, self.root)), patch.object(transport, "execute") as execute, \
                    redirect_stdout(io.StringIO()) as out:
                self.assertEqual(gate.main(), 2)
            execute.assert_not_called(); self.assertNotIn("SECRET", out.getvalue())

    def test_14_remote_block_interrupt_and_partial_storage_never_claim_success(self):
        """Ensure remote blocks, interruption and partial writes cannot claim success or replay."""
        for error in (transport.RemoteOutcome("C4_UNIT_BLOCK_OLD_HASH"), KeyboardInterrupt(),
                      subprocess.TimeoutExpired("SECRET", 1)):
            with patch.object(gate, "admit", return_value=(SHA, RID)), \
                    patch.object(e, "prepare", return_value=(self.cert, self.root)), \
                    patch.object(transport, "execute", side_effect=error), patch.object(e, "save") as save, \
                    redirect_stdout(io.StringIO()) as out:
                self.assertEqual(gate.main(), 2)
            save.assert_not_called(); self.assertNotIn("SECRET", out.getvalue())
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / e.NAME
            with patch.object(e.os, "write", side_effect=OSError("interrupted")), self.assertRaises(OSError):
                e.write_new(path, b"x" * 512)
            with self.assertRaises(FileExistsError): e.write_new(path, b"x" * 512)
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td)
            cipher = e.encrypt(e.canonical(receipt(), SHA, RID), self.cert)
            with patch.object(e, "encrypt", return_value=cipher), \
                    patch.object(e.os, "write", side_effect=OSError("CIPHERTEXT_WRITE_ERROR")), self.assertRaises(OSError):
                e.save(receipt(), SHA, RID, self.cert, folder, self.output)
            self.assertEqual((folder / e.NAME).stat().st_size, 0)
            self.assertEqual(self.output.read_text().splitlines()[-1],
                             "ciphertext_sha256=" + c.digest(cipher))
        # A failed output write must precede, never follow, ciphertext creation.
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td)
            with self.assertRaises(OSError):
                e.save(receipt(), SHA, RID, self.cert, folder, folder)
            self.assertFalse((folder / e.NAME).exists())
        # A late local read failure occurs only after the upload boundary.
        with tempfile.TemporaryDirectory() as td:
            env = dict(context(), RUNNER_TEMP=td)
            original = e.output_dir(env); original.mkdir()
            with patch.object(e, "regular", side_effect=OSError("LATE_READ_ERROR")), \
                    patch.object(gate, "admit", return_value=(SHA, RID)), \
                    patch.object(e, "prepare", return_value=(self.cert, original)), \
                    patch.object(transport, "execute", return_value=receipt()), \
                    patch.dict(os.environ, {"GITHUB_OUTPUT": str(self.output)}), \
                    patch("builtins.print", side_effect=BrokenPipeError("LOG_WRITE_ERROR")):
                self.assertEqual(gate.main(), 0)
            cipher = (original / e.NAME).read_bytes()
            env["C4_RECEIPT_CIPHER_SHA256"] = self.output.read_text().splitlines()[-1].split("=", 1)[1]
            self.assertEqual(self.decrypt(cipher), e.canonical(receipt(), SHA, RID))
            download = original.with_name(original.name + "-download"); download.mkdir()
            (download / e.NAME).write_bytes(cipher)  # isolated artifact upload/download
            with patch.object(e, "regular", side_effect=OSError("LATE_READ_ERROR")), \
                    self.assertRaises(OSError):
                e.verify_download(env)
            self.assertEqual((download / e.NAME).read_bytes(), cipher)
            e.verify_download(env)

    def test_15_workflow_exact_cipher_only_and_unchanged_reader_payload(self):
        """Verify workflow protections, ciphertext-only upload and unchanged reader bytes."""
        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github/workflows" / gate.WORKFLOW_FILE).read_text()
        for required in ("environment: staging", "needs: [isolated_unit_tests]", "cancel-in-progress: false",
                         "strigunov4-staging-nine-sql-apply", "if-no-files-found: error", "overwrite: false",
                         "unit-receipt.cms", "verify-download", "include-hidden-files: false"):
            self.assertIn(required, workflow)
        self.assertIn("C4_RECEIPT_CIPHER_SHA256: ${{ steps.receipt.outputs.ciphertext_sha256 }}", workflow)
        self.assertLess(workflow.index("Preserve only encrypted receipt"), workflow.index("Require exact encrypted readback"))
        for denied in ("contents: write", "actions: write", "continue-on-error", "PRIVATE_RECIPIENT_KEY",
                       "daemon-reload", "STAGING_DATABASE_URL", "c4_unit_transaction.py", "always()"):
            self.assertNotIn(denied, workflow)
        self.assertEqual(c.digest(reader.payload()), "514f6902f7bc57ff856f8fe7300016d605bba1844e3fd753399a3abaad65191f")
        for denied in (b"daemon-reload", b"restart", b"c4_unit_transaction", b"open_offline"):
            self.assertNotIn(denied, reader.payload())

    def test_16_offline_strict_decrypt_exclusive_output_and_github_denied(self):
        """Check bound offline recovery, exclusive output and refusal inside GitHub Actions."""
        original_recipient = e.recipient
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td); cipher = folder / e.NAME; output = folder / "verified.json"
            cipher.write_bytes(e.encrypt(e.canonical(receipt(), SHA, RID), self.cert))
            with patch.object(e, "recipient", side_effect=lambda raw: original_recipient(raw, self.fp)), \
                    patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}):
                e.open_offline(cipher, self.key, self.cert_path, SHA, RID, output)
                self.assertEqual(c.strict_json(output.read_bytes()), receipt())
                with self.assertRaises(FileExistsError): e.open_offline(cipher, self.key, self.cert_path, SHA, RID, output)
                with self.assertRaises(c.Block): e.open_offline(cipher, self.key, self.cert_path, SHA, "123", folder / "wrong")
            with patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}), patch.object(e, "command") as command, self.assertRaises(c.Block):
                e.open_offline(cipher, self.key, self.cert_path, SHA, RID, folder / "forbidden")
            command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
