"""Source-only gate for a future clean one.com staging release.

This utility NEVER writes release-meta.json, checks out a branch, installs,
restarts or contacts a database. It produces a *proposal* for the protected
installer only after a reviewer has supplied an exact expected commit.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

SHA40 = re.compile(r"^[0-9a-f]{40}$")


class ReleaseIdentityBlocked(ValueError):
    pass


def git(checkout: Path, *args: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(checkout), *args],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ReleaseIdentityBlocked("GIT_UNAVAILABLE") from error
    if result.returncode != 0:
        raise ReleaseIdentityBlocked("GIT_IDENTITY_UNAVAILABLE")
    return result.stdout.strip()


def propose_release_meta(checkout: Path, expected_sha: str) -> dict:
    """Fail closed on head drift, dirty tracked sources or false metadata."""
    if not isinstance(expected_sha, str) or not SHA40.fullmatch(expected_sha):
        raise ReleaseIdentityBlocked("INVALID_REVIEWED_SHA")
    if not checkout.is_dir():
        raise ReleaseIdentityBlocked("CHECKOUT_MISSING")
    source_head = git(checkout, "rev-parse", "--verify", "HEAD")
    if source_head != expected_sha:
        raise ReleaseIdentityBlocked("GIT_HEAD_NOT_REVIEWED_COMMIT")
    # Include untracked source files. Only the independently verified
    # release-meta.json artifact may be untracked after installation.
    # Ignoring all untracked paths would permit an unreviewed executable route.
    status = git(checkout, "status", "--porcelain", "--untracked-files=all")
    if any(line != "?? release-meta.json" for line in status.splitlines()):
        raise ReleaseIdentityBlocked("CHECKOUT_UNREVIEWED_FILES")
    tree = git(checkout, "rev-parse", "HEAD^{tree}")
    if not SHA40.fullmatch(tree):
        raise ReleaseIdentityBlocked("GIT_TREE_INVALID")
    metadata = checkout / "release-meta.json"
    if metadata.is_symlink():
        raise ReleaseIdentityBlocked("RELEASE_METADATA_SYMLINK")
    if metadata.exists():
        try:
            payload = json.loads(metadata.read_text("utf8"))
        except (OSError, ValueError) as error:
            raise ReleaseIdentityBlocked("RELEASE_METADATA_INVALID") from error
        if type(payload) is not dict or payload.get("gitSha") != expected_sha:
            raise ReleaseIdentityBlocked("RELEASE_METADATA_SHA_MISMATCH")
    return {
        "schema": "asi.onecom.release-metadata-source-proposal.v1",
        "status": "SOURCE_PROVENANCE_VERIFIED_METADATA_PROPOSAL_ONLY",
        "reviewed_sha": expected_sha,
        "git_tree": tree,
        "metadata_file_exists": metadata.is_file(),
        "proposed_release_meta": {"gitSha": expected_sha},
        "live_staging_mutations": 0,
        "physical_g2_g6": "NOT_RUN",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkout", type=Path, required=True)
    parser.add_argument("--expected-sha", required=True)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(
            propose_release_meta(args.checkout, args.expected_sha),
            sort_keys=True, indent=2,
        ))
        return 0
    except ReleaseIdentityBlocked as error:
        print(json.dumps(
            {"status": "BLOCKED", "reason": str(error),
             "staging_mutations": 0, "physical_g2_g6": "NOT_RUN"},
            sort_keys=True,
        ))
        return 2


if __name__ == "__main__":
    sys.exit(main())
