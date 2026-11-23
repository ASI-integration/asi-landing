"""Disposable Git repository tests; never touch real staging or GitHub."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from scripts.strigunov4.onecom_release_identity import (
    ReleaseIdentityBlocked, main, propose_release_meta,
)


class OnecomReleaseIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="asi-onecom-release-")
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        self.command("init", "-q")
        self.command("config", "user.name", "ASI Release Test")
        self.command("config", "user.email", "asi-test@localhost.invalid")
        (self.repo / "app.js").write_text("export const ok = true;\n", "utf8")
        self.command("add", "app.js")
        self.command("commit", "-q", "-m", "controlled test commit")
        self.sha = self.command("rev-parse", "HEAD")

    def command(self, *args):
        result = subprocess.run(
            ["git", "-C", str(self.repo), *args],
            text=True, capture_output=True, check=True, timeout=10,
        )
        return result.stdout.strip()

    def test_clean_exact_commit_generates_proposal_without_any_write(self):
        proof = propose_release_meta(self.repo, self.sha)
        self.assertEqual(proof["proposed_release_meta"], {"gitSha": self.sha})
        self.assertEqual(proof["live_staging_mutations"], 0)
        self.assertEqual(proof["physical_g2_g6"], "NOT_RUN")
        self.assertFalse((self.repo / "release-meta.json").exists())

    def test_reviewed_head_mismatch_refuses_to_stamp_release(self):
        with self.assertRaisesRegex(
            ReleaseIdentityBlocked, "GIT_HEAD_NOT_REVIEWED_COMMIT"
        ):
            propose_release_meta(self.repo, "f" * 40)

    def test_dirty_tracked_source_refuses_to_stamp_release(self):
        (self.repo / "app.js").write_text("mutated source", "utf8")
        with self.assertRaisesRegex(
            ReleaseIdentityBlocked, "CHECKOUT_UNREVIEWED_FILES"
        ):
            propose_release_meta(self.repo, self.sha)

    def test_untracked_source_refuses_to_stamp_reviewed_sha(self):
        (self.repo / "unreviewed_handler.py").write_text(
            "print('unsafe')\\n", "utf8"
        )
        with self.assertRaisesRegex(
            ReleaseIdentityBlocked, "CHECKOUT_UNREVIEWED_FILES"
        ):
            propose_release_meta(self.repo, self.sha)

    def test_missing_checkout_blocks(self):
        with self.assertRaisesRegex(
            ReleaseIdentityBlocked, "CHECKOUT_MISSING"
        ):
            propose_release_meta(self.repo / "not-existing", self.sha)

    def test_invalid_sha_blocks(self):
        with self.assertRaisesRegex(
            ReleaseIdentityBlocked, "INVALID_REVIEWED_SHA"
        ):
            propose_release_meta(self.repo, "latest")

    def test_existing_different_release_metadata_blocks(self):
        (self.repo / "release-meta.json").write_text(
            json.dumps({"gitSha": "f" * 40}), "utf8"
        )
        with self.assertRaisesRegex(
            ReleaseIdentityBlocked, "RELEASE_METADATA_SHA_MISMATCH"
        ):
            propose_release_meta(self.repo, self.sha)

    def test_existing_matching_metadata_accepted_read_only(self):
        value = json.dumps({"gitSha": self.sha}) + "\n"
        (self.repo / "release-meta.json").write_text(value, "utf8")
        self.assertTrue(propose_release_meta(
            self.repo, self.sha
        )["metadata_file_exists"])
        self.assertEqual((self.repo / "release-meta.json").read_text("utf8"), value)

    def test_cli_failure_is_sanitized_and_exit_is_nonzero(self):
        from contextlib import redirect_stdout
        from io import StringIO
        stream = StringIO()
        with redirect_stdout(stream):
            status = main([
                "--checkout", str(self.repo),
                "--expected-sha", "bad",
            ])
        response = json.loads(stream.getvalue())
        self.assertEqual(status, 2)
        self.assertEqual(response["status"], "BLOCKED")
        self.assertNotIn(str(self.repo), stream.getvalue())


if __name__ == "__main__":
    unittest.main()
