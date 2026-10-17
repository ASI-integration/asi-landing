# Strigunov 4 — protected read-only staging admission

This package implements a **read-only staging preflight**, NOT a database apply or application deployment backend. It is stacked after reviewed source-integrity PR #475, and depends on G0 integration PR #473. All live operations remain explicitly **NOT_LIVE**.

## What is independently checked

The manual GitHub Actions job is constrained to `workflow_dispatch` from `refs/heads/main`, exact owner account/ID and triggering actor, single run attempt, identical reviewed and checkout SHA, same workflow source SHA and a fixed confirmation `VERIFY_STRIGUNOV4_STAGING_ONLY`. The job uses GitHub environment `staging`, where a required reviewer is configured. The environment's approval is external: manually supplying matching `GITHUB_*` strings locally is **not authorization**.

Before any SSH, the source guard hashes all nine exact ordered SQL candidates against the known 17 October rollback-rehearsal source hashes. It checks the frozen release commit `d912aec6663de90e5ca4293cc5a69e2e0ed9ff94` is an ancestor of the current reviewed source SHA. This does not claim a new nine-SQL rehearsal for a modified release.

The SSH host's ED25519 key is verified against an independently reviewed pinned fingerprint (not trust-on-first-use). Keys exist only in a transient private runner directory. The fixed remote program is sent on stdin and does not write files or use SQL connections. It verifies the Tailscale host's identity; current `asi-landing-staging` systemd unit digest, service user/group, cwd, health/version and release symlink; archive and manifest SHA-256, size and file permissions in the inactive quarantine; and seven flags from the **actual process environment**. The result prints only named PASS/BLOCK categories, not secret values.

## Current expected staging outcome

The live staging release is still `5c91b27bcde395f01cc078d1fbe454dd7436e1c6`. On 17 October the effective service environment contained six of seven expected synthetic safety flags; `ASI_SYNTHETIC_NO_SEND=YES` was missing. Therefore the read-only job is designed to return **BLOCK** until a separately authorized safe staging configuration change and effective process recheck. A report of `BLOCK` is a correct fail-closed outcome, not permission to install.

The quarantine contains the verified `asi-staging-d912aec6663de90e5ca4293cc5a69e2e0ed9ff94.tgz` (229060580 bytes, SHA256 `030880c750c8fb28cb61ebfbba85e0e23718279e4c165655fcae6a1c2d07c486`). This is a transfer/verification record only; it has NOT been extracted, installed or activated.

## Mandatory remaining authority and safety work

A *separate, reviewed* protected deployment procedure must still authenticate the actual GitHub reviewer/owner, preserve the required environment gates, ensure one-time execution/replay resistance and independent rollback readiness, verify the latest database catalog/history, commit selectively only the nine independently accepted SQL changes with history in one controlled transaction, preserve all seven staging-only migrations, and safely activate the immutable systemd release with tested application rollback. Database recovery is not equivalent to application rollback. No generic `db push`, PM2 deployment, real guest messages, OTA writes or payments.

**Environment policy caveat:** At inspection, the GitHub `staging` environment had required reviewers but did not enforce a protected-branch policy itself. This preflight explicitly refuses anything except main at multiple points; before ANY future database write/deployment, harden environment branch policy and independently review the final mutating workflow. Do not rely exclusively on a workflow's own editable conditions for credential protection.

## Source-only test

`python3 -m unittest discover -s scripts/strigunov4 -p test_protected_staging_preflight.py -v`

The `pull_request` workflow runs these tests on Linux without secrets. The `workflow_dispatch` job may become runnable only once its exact source has undergone normal required reviews and is included on protected main; it then requires GitHub's staging reviewer approval. No branch rename, old workflow alteration, main merge, server configuration change or SQL apply is part of this PR.
