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

**Verified environment protection:** GitHub `staging` requires approval from its designated reviewer and has `custom_branch_policies=true` with the exact allowed branch pattern `main`. The repository's `main` is independently branch-protected with required reviews and the `validate` status check. This preflight redundantly refuses anything except exact `refs/heads/main`, workflow SHA, owner identity and first run attempt. Keep all these existing protections; do not reconfigure the environment or use an unreviewed branch.

## Source-only test

`python3 -m unittest discover -s scripts/strigunov4 -p test_protected_staging_preflight.py -v`

The `pull_request` workflow runs these tests on Linux without secrets. The `workflow_dispatch` job may become runnable only once its exact source has undergone normal required reviews and is included on protected main; it then requires GitHub's staging reviewer approval. No branch rename, old workflow alteration, main merge, server configuration change or SQL apply is part of this PR.

## Exact nine-SQL transactional candidate (source-only)

`scripts/strigunov4/staging_nine_sql_candidate.py` deterministically renders the **nine exact source files** in the reviewed order, recording their pinned byte digests. The original G0 migration's one inner `BEGIN` / `COMMIT` pair is removed for assembly inside a **single surrounding transaction**; unexpected embedded transaction markers and psql meta commands cause BLOCK. There is no SQL execution function. The generator's success output states `NINE_STAGING_SQL_CANDIDATE_NOT_AUTHORIZED`, includes its SHA256 fingerprint and does not create a database connection.

Before any change in that candidate, the SQL itself checks PostgreSQL17, compatible history table columns/primary key, all nine versions unregistered, seven protected historical versions present, no partial G0 execution, the expected existing purpose constraint, and the reviewed **14 missing staging columns** still absent. On any source schema drift it raises an error rather than guessing an upgrade path.

After the exact nine SQL payloads, within the **same transaction** it checks all 14 required columns, runtime_bridge definitions, non-global communication sending disabled, negative anon/authenticated privileges, and preserved staging-only history. Only then are the nine selected `supabase_migrations.schema_migrations` rows registered, and the final history checked, before `COMMIT`. Other repo-only missing history is never marked applied. A proper protected caller must still independently verify live staging identity, TLS, user-controlled reviewer authorisation, replay resistance, backup and rollback before ever executing this candidate. This PR **does not implement that caller**.

Offline validation: `python3 -m unittest discover -s scripts/strigunov4 -p test_staging_nine_sql_candidate.py -v`. The Linux workflow additionally runs the generator against the pinned real repository bytes. This is source verification only — **not** evidence that the SQL has been applied, or that a current schema can run it.
