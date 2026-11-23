"""Independent offline rejection regressions; all archive bytes stay in memory."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import unittest
from unittest.mock import patch


def load_module(name):
    spec = importlib.util.spec_from_file_location(
        name, Path(__file__).with_name(name + ".py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


archive_validator = load_module("inspect_restore_archive")
preflight = load_module("restore_container_preflight")


class RestoreRejectionTests(unittest.TestCase):
    def inspect_members(self, members, limit=150):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
            for name, payload, kind in members:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.size = len(payload) if kind == tarfile.REGTYPE else 0
                member.linkname = "db.dump" if kind == tarfile.SYMTYPE else ""
                archive.addfile(member, io.BytesIO(payload))
        buffer.seek(0)
        real_open = tarfile.open
        # Redirect only archive input; parsing and every validation are real.
        with patch.object(archive_validator.tarfile, "open",
                          side_effect=lambda path, mode: real_open(
                              fileobj=buffer, mode=mode)):
            return archive_validator.inspect("memory-only.tar.gz", limit)

    def valid_members(self):
        return [("db.dump", b"PGDMP" + b"x" * 45, tarfile.REGTYPE),
                ("globals.sql", b"s" * 50, tarfile.REGTYPE),
                ("toc.txt", b"t" * 50, tarfile.REGTYPE)]

    def test_valid_structure_still_does_not_authorize_restore(self):
        self.assertEqual(self.inspect_members(self.valid_members()), {
            "archive_structure": "PASS", "restore": "NOT_RUN",
            "authorization": False,
        })

    def test_forbidden_archive_paths_are_rejected(self):
        for name in ("../db.dump", "/db.dump", "nested/db.dump", "./db.dump"):
            with self.subTest(name=name):
                members = self.valid_members()
                members[0] = (name, members[0][1], tarfile.REGTYPE)
                with self.assertRaisesRegex(archive_validator.InvalidArchive,
                                            "^UNEXPECTED_OR_DUPLICATE_MEMBER$"):
                    self.inspect_members(members)

    def test_missing_and_duplicate_members_are_rejected(self):
        for members, reason in (
            (self.valid_members()[:-1], "MISSING_MEMBER"),
            (self.valid_members() + [self.valid_members()[0]],
             "UNEXPECTED_OR_DUPLICATE_MEMBER"),
        ):
            with self.subTest(reason=reason):
                with self.assertRaisesRegex(archive_validator.InvalidArchive,
                                            "^" + reason + "$"):
                    self.inspect_members(members, limit=1000)

    def test_symlink_dump_is_rejected(self):
        members = self.valid_members()
        members[0] = ("db.dump", b"", tarfile.SYMTYPE)
        with self.assertRaisesRegex(archive_validator.InvalidArchive,
                                    "^NONREGULAR_MEMBER$"):
            self.inspect_members(members)

    def test_bad_dump_header_and_incomplete_member_are_rejected(self):
        for payload, reason in ((b"WRONG" + b"x" * 45, "INVALID_DUMP_HEADER"),
                                (b"PGDMP", "INCOMPLETE_MEMBER")):
            with self.subTest(reason=reason):
                members = self.valid_members()
                members[0] = ("db.dump", payload, tarfile.REGTYPE)
                with self.assertRaisesRegex(archive_validator.InvalidArchive,
                                            "^" + reason + "$"):
                    self.inspect_members(members)

    def test_invalid_and_exceeded_size_limits_fail_closed(self):
        for limit in (True, 0, -1, "150", None):
            with self.subTest(limit=limit):
                with self.assertRaisesRegex(archive_validator.InvalidArchive,
                                            "^INVALID_LIMIT$"):
                    archive_validator.inspect("must-not-be-opened", limit)
        with self.assertRaisesRegex(archive_validator.InvalidArchive,
                                    "^SIZE_LIMIT$"):
            self.inspect_members(self.valid_members(), limit=149)

    def test_binary_paths_reject_traversal_and_shell_input(self):
        self.assertEqual(preflight.absolute_binary("/usr/bin/psql"), "/usr/bin/psql")
        for value, reason in (("/usr/../bin/psql", "IMAGE_BINARY_PATH_INVALID"),
                              ("psql", "IMAGE_BINARY_PATH_MISSING"),
                              ("/bin/psql;id", "IMAGE_BINARY_PATH_MISSING"),
                              (None, "IMAGE_BINARY_PATH_MISSING")):
            with self.subTest(value=value):
                with self.assertRaisesRegex(preflight.Block, "^" + reason + "$"):
                    preflight.absolute_binary(value)

    def test_wrong_manifest_identity_is_rejected_before_file_access(self):
        for manifest in ({}, {"run_id": "wrong", "cipher_sha256": preflight.DIGEST},
                         {"run_id": preflight.RUN, "cipher_sha256": "0" * 64}):
            with self.subTest(manifest=manifest):
                with self.assertRaisesRegex(preflight.Block,
                                            "^WRONG_RUN_OR_CIPHERTEXT$"):
                    preflight.build_plan(manifest, "unused-parent", "unused-cipher")

    def test_malformed_manifest_json_cli_reports_block_without_restore(self):
        output = io.StringIO()
        with patch.object(sys, "argv", ["preflight", "manifest.json",
                          "--private-parent", "unused", "--ciphertext", "unused"]), \
                patch.object(preflight.Path, "read_text", return_value="{broken"), \
                contextlib.redirect_stdout(output):
            status = preflight.main()
        self.assertEqual(status, 2)
        self.assertEqual(json.loads(output.getvalue()), {
            "status": "BLOCK", "reason": "INVALID_INPUT",
            "restore": "NOT_RUN", "authorization": False,
        })


if __name__ == "__main__":
    unittest.main()
