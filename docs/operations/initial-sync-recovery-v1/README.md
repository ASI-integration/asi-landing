# Initial Sync Recovery v1 production rollout

Status: **preflight only — no production action is authorized or executed by these artifacts**.

## Fixed identities

| Item | Authorized value |
| --- | --- |
| Repository | `ASI-integration/asi-landing` |
| Deploy commit | `6b9f022e423e1032f66286b9348160c4dd59f45c` |
| Migration | `supabase/migrations/20260805120000_channel_manager_live_core_synthetic_recovery_v1.sql` |
| Migration Git blob | `f56db2124b2e91782fcf05be7fb37b51998808b3` |
| Migration SHA-256 | `6fbc176b21006d258d4f0253d538c46b66862f0e7752137dda62bc8a88d811ba` |
| Observed production SHA / rollback target | `f5c7b91d7a6af87a07043673403aa44c56cf348a` |
| Runtime task cycle | `initial-sync-recovery-v1-production-rollout-20260806` |

The production identity was read from the public health/version endpoints at `2026-08-05T21:23:45Z`; see [`read-only-evidence.json`](read-only-evidence.json). Recheck it immediately before an approved dispatch. Any mismatch is a stop condition, not permission to update a SHA in place.

## Installation prerequisite

The dedicated migration workflow in this change must first exist on the repository default branch. Review and merge of this authorization-only change follows the repository's normal merge owner gate and is not migration or deploy approval. Merging it must not dispatch a workflow.

After that prerequisite, the rollout approvals are strictly sequential:

1. approve the exact production migration gate;
2. apply and verify the exact migration, then stop;
3. approve the separate exact production deploy gate;
4. deploy and verify the exact artifact, then stop;
5. run one read-only owner preview and stop.

Typed workflow inputs are technical guards and never count as owner approval.

## Runtime task envelope

Submit [`runtime-task-envelope.json`](runtime-task-envelope.json) only after confirming that its task cycle is still current. Its `baselineSha` and every operational identity are pinned to the required deploy commit. The Runtime executor must materialize one owner gate at a time and bind each explicit decision to the same `taskId`, gate ID, exact identity, and task cycle.

The tracked gate files are pending approval specifications. They intentionally have `status: "missing"` and `authorization: null`; do not edit them to `approved` based on a typed workflow phrase. A durable Runtime gate becomes approved only from Nikolay's explicit owner message and is consumed after its one matching action.

## Phase 1 — exact production migration

Owner gate: [`migration-owner-gate.json`](migration-owner-gate.json).

Established mechanism: a dedicated manual production migration workflow, following the repository's existing exact-file migration workflows. It checks out the authorized commit directly, verifies the exact migration bytes twice, confirms the current production application identity, obtains the database URL only inside the production VPS environment without logging it, verifies the Supabase project identity is self-consistent, runs the SQL transactionally, and verifies all three function signatures and grants.

Prepared dispatch command — do not run without the matching approved and unconsumed migration gate:

```powershell
gh workflow run apply-channel-manager-live-core-synthetic-recovery-migration.yml `
  --repo ASI-integration/asi-landing `
  --ref main `
  -f confirm_production_migration=APPLY_20260805120000_RECOVERY_V1_TO_PRODUCTION
```

The workflow is intentionally unable to select a migration, SHA, target environment, cleanup mode, or acceptance mode. It does not use `supabase db push`, so pending unrelated migrations cannot be swept into this action. It executes only the checksum-pinned SQL file and does not update or repair migration history.

Stop after Phase 1 unless all of these are true:

- repository and checked-out SHA match the fixed identities;
- public and VPS-local version checks report `environment=production` and the pre-migration SHA;
- migration SHA-256 matches;
- the production environment and database identities match;
- the workflow concludes with `MIGRATION_STATUS=applied_and_verified`;
- the production application is still healthy at the pre-deploy SHA.

Do not continue on a failed, cancelled, timed-out, skipped, or identity-mismatched run. Do not run recovery cleanup, Initial Sync acceptance, or ordinary Initial Sync.

## Phase 2 — exact production deploy

Owner gate: [`deploy-owner-gate.json`](deploy-owner-gate.json). It may be approved only after Phase 1 has passed and stopped.

Established mechanism: the existing manual artifact workflow [`.github/workflows/deploy.yml`](../../../.github/workflows/deploy.yml), which builds the selected ref, runs its configured build gates and artifact smoke, deploys through the `production` environment, atomically switches the release, and verifies the artifact SHA through `/api/version`.

Prepared dispatch command — do not run without the separate matching approved and unconsumed deploy gate:

```powershell
gh workflow run deploy.yml `
  --repo ASI-integration/asi-landing `
  --ref main `
  -f confirm_production_deploy=DEPLOY_PRODUCTION `
  -f sha=6b9f022e423e1032f66286b9348160c4dd59f45c
```

Stop after Phase 2 unless the workflow succeeds and both read-only checks pass:

```powershell
Invoke-RestMethod -Method Get -Uri https://asi-global.ru/api/health
Invoke-RestMethod -Method Get -Uri https://asi-global.ru/api/version
```

Required version fields:

```text
environment=production
sha=6b9f022e423e1032f66286b9348160c4dd59f45c
releasePath=/var/www/asi/releases/6b9f022e423e1032f66286b9348160c4dd59f45c
```

Do not substitute a branch, short SHA, newer `main`, staging workflow, or staging target.

## Rollback

Application rollback target: `f5c7b91d7a6af87a07043673403aa44c56cf348a`, the healthy production release observed immediately before preparation and the parent of the authorized deploy commit.

The existing deploy script automatically records the previous release and rolls back to it if post-switch version verification fails. After automatic rollback, stop and require:

```text
environment=production
sha=f5c7b91d7a6af87a07043673403aa44c56cf348a
releasePath=/var/www/asi/releases/f5c7b91d7a6af87a07043673403aa44c56cf348a
```

A manual rollback after a nominally successful deploy is a new red action. It requires a separate `production_rollback` owner gate. The established procedure is to copy the exact `scripts/rollback-artifact.sh` and `scripts/pm2-sync-ops-alert-scheduler.sh` from commit `6b9f022e423e1032f66286b9348160c4dd59f45c` to the production deploy temporary directory, then run:

```bash
ASI_BASE_DIR=/var/www/asi bash scripts/rollback-artifact.sh f5c7b91d7a6af87a07043673403aa44c56cf348a
```

The command must run on the production VPS as the established deploy user with both scripts in the same directory. It verifies that the target release exists, that its release metadata matches the full target SHA, and that health/version match after the atomic switch.

The database migration is additive and does not write application rows merely by being installed. Application rollback therefore leaves the three service-role-only functions installed. Do not drop them during this rollout. If database rollback is later required, prepare a new append-only rollback migration and obtain a new `production_migration` owner approval.

## Phase 3 — read-only recovery preview

Prerequisite: Phase 2 passed and the public version endpoint still reports the authorized deploy SHA.

Use the established owner-only GET path. In a browser already authenticated as the development owner, navigate directly to:

```text
https://asi-global.ru/api/dashboard/channel-manager/live-core-acceptance
```

This GET performs the schema probe and `previewLiveCoreSyntheticRecovery()` only. Record only:

- HTTP status and `ok`;
- `schemaReady`;
- `recoveryRequired`;
- `recoverySafeToCleanup`;
- `recoveryBlockerCode` and the safe summary;
- `recovery.expectedDeletionTotal`.

Then stop. Do not send POST, do not click acceptance or cleanup controls, do not enter a cleanup confirmation phrase, and do not run ordinary Initial Sync. A 401/403, non-200 response, missing recovery payload, version drift, unsafe blocker, or unexpected data is a stop condition and does not authorize another call mode.

## Required approvals and evidence order

1. Normal merge approval for this authorization-only change so the dedicated migration workflow exists on `main`; no production action follows automatically.
2. Explicit migration approval matching every field of [`migration-owner-gate.json`](migration-owner-gate.json).
3. Successful Phase 1 run evidence and an explicit stop.
4. Explicit deploy approval matching every field of [`deploy-owner-gate.json`](deploy-owner-gate.json).
5. Successful Phase 2 health/version evidence and an explicit stop.
6. Read-only owner preview; no mutation approval is implied or requested.

Secret names used by the established workflows are `VPS_HOST`, `VPS_PORT`, `VPS_SSH_KEY`, the production database URL key already present on the VPS, and the existing deploy environment keys. Values must never be copied into Runtime input, artifacts, logs, or reports.
