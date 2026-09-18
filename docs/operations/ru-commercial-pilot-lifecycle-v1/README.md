# RU commercial pilot lifecycle v1 — production migration authorization

Status: **preflight / scaffolding only — no production action is authorized or executed by these artifacts**.

## Fixed identities

| Item | Authorized value |
| --- | --- |
| Repository | `ASI-integration/asi-landing` |
| Migration source commit | `9701e0bcf05775671a910b74a68f29f754b128ba` |
| Migration | `supabase/migrations/20260918120000_ru_commercial_pilot_lifecycle_v1.sql` |
| Migration Git blob | `85ffdd88af474b8bb7403ffaf1b870b91aba995f` |
| Migration SHA-256 | `dcbfd3275a2ae7a8a9163f5de9114ee9a5fef3afacad52cea70358c32446f6cb` |
| Expected pre-migration production application SHA | `7c201dd973fc56d28272443ee072b9ab43dec6cc` |
| Expected production Supabase project ref | `jwinifeienvzejofmbua` |

Migration SHA-256 is derived from the exact Git blob bytes at the authorized commit:

```bash
git cat-file blob 9701e0bcf05775671a910b74a68f29f754b128ba:supabase/migrations/20260918120000_ru_commercial_pilot_lifecycle_v1.sql | sha256sum
```

Do not derive checksums from an edited working-tree copy. The checked-out file must still match Git blob `85ffdd88af474b8bb7403ffaf1b870b91aba995f` via `git hash-object`.

## Installation prerequisite

The dedicated migration workflow in this change must first exist on the repository default branch. Review and merge of this authorization-only change follows the repository's normal merge owner gate and is **not** migration or deploy approval. Merging it must not dispatch a workflow.

## Required sequence

1. Merge this authorization / workflow PR into `main`.
2. **STOP.**
3. Obtain explicit owner approval for the exact `production_migration` gate in [`migration-owner-gate.json`](migration-owner-gate.json). Typed confirmation is a technical guard only and never counts as owner approval.
4. Dispatch the exact migration workflow (command below) and wait for `MIGRATION_STATUS=applied_and_verified`.
5. Verify and **STOP**. Do not deploy the application in the same step.
6. Obtain a **separate** owner approval for production application deploy of the lifecycle application SHA.
7. Deploy the exact application SHA through the existing `deploy.yml` path.
8. Run production lifecycle smoke after deploy.

## Phase 1 — exact production migration only

Owner gate: [`migration-owner-gate.json`](migration-owner-gate.json).

Established mechanism: [`.github/workflows/apply-ru-commercial-pilot-lifecycle-v1.yml`](../../../.github/workflows/apply-ru-commercial-pilot-lifecycle-v1.yml).

The workflow is intentionally unable to select another migration, another source SHA, another target environment, or arbitrary SQL. It does **not** use `supabase db push`. It executes only the checksum-pinned SQL file with `psql` (`ON_ERROR_STOP=1`, single transaction), reloads PostgREST schema, verifies table/columns/constraints/RLS, and confirms `/api/version` still reports the pre-migration application SHA.

Prepared dispatch command — do **not** run without the matching approved and unconsumed migration gate:

```powershell
gh workflow run apply-ru-commercial-pilot-lifecycle-v1.yml `
  --repo ASI-integration/asi-landing `
  --ref main `
  -f confirm_production_migration=APPLY_20260918120000_RU_COMMERCIAL_PILOT_LIFECYCLE_V1_TO_PRODUCTION
```

Stop after Phase 1 unless all of these are true:

- repository and checked-out SHA match the fixed identities;
- public `/api/version` reports `environment=production` and `7c201dd973fc56d28272443ee072b9ab43dec6cc` before and after SQL;
- migration Git blob and SHA-256 from canonical blob bytes match;
- production `SUPABASE_DB_URL` identity matches `jwinifeienvzejofmbua`;
- the workflow concludes with `MIGRATION_STATUS=applied_and_verified`;
- public `/api/health` remains healthy;
- no application deploy was performed.

## Phase 2 — separate application deploy (out of scope for this folder until approved)

After Phase 1 succeeds and stops, a separate `production_deploy` owner gate and `deploy.yml` dispatch are required for the application SHA that contains the lifecycle API. That deploy must not be bundled into the migration workflow.

## Rollback semantics

This migration is additive DDL for a new table. Forward-fix / append-only owner-gated rollback is required if a compensating migration is needed. Application rollback target remains the pre-migration production SHA `7c201dd973fc56d28272443ee072b9ab43dec6cc` until a later approved deploy replaces it.
