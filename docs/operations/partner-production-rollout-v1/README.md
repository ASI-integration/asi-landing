# Partner production rollout v1

This runbook prepares the seven approved partner migrations for a controlled production rollout. It does not authorize a run. Production access, database mutation, secret configuration, application deploy, and acceptance remain separate owner-approved actions.

## Fixed scope

The source of truth is [`manifest.json`](manifest.json). The manifest pins exact migration filenames, canonical order, SHA-256 checksums, and the checksum of the migration-history registration SQL. The validator also refuses to proceed if the repository contains any additional `partner_` migration or if the history registration differs from the same seven versions and names.

The SQL dependency evidence is:

- durable state creates the account, session, action, and update-trigger foundations;
- authenticated inbox references the durable binding and update function;
- brain alters the durable and inbox tables and creates the decision/binding layer;
- recovery references brain decisions and durable actions/handoffs;
- the repository's reputation PostgreSQL integration applies recovery before reputation;
- revenue references brain property bindings and is a safe final step after reputation;
- the property-knowledge repair is SQL-independent, but the strict partner loader test requires its five added columns before application acceptance.

Canonical `main` at `27c733a67333fa4133a5bdff281ff5cd05b2414c` contains exactly these seven `partner_` migrations. The revenue migration also depends on the older non-partner pricing-profile migration already present in the canonical migration chain; it is a prerequisite checked on the target, not an eligible migration in this rollout.

## Operator sequence

### 1. PRECHECK

1. Choose one full 40-character commit SHA that is on `main`, contains this control workflow, and has green PR/CI validation.
2. From `main`, manually dispatch **Partner Production Rollout Control v1** with:
   - `operation=preflight`;
   - `rollout_sha=<exact full SHA>`;
   - empty `owner_confirmation`.
3. Download and retain the preflight artifact. It must report seven checksum-verified migrations, `mutationAllowed=false`, and no extra partner migration.
4. The apply job's database precheck is the authoritative first-rollout guard. It runs read-only immediately before mutation and requires the prerequisite relations, zero partner relations, and all seven history versions absent. Do not use a successful post-rollout audit artifact as permission to rerun.

The preflight operation checks out the exact SHA and performs no database connection, secret access, or mutation.

### 2. Explicit owner approval

Before any apply run:

- `PRODUCTION_MIGRATION_OWNER_LOGIN` must already identify the owner who will personally dispatch the run;
- the `production-migration-approval` environment must have that owner as a required reviewer and restrict deployments to `main`;
- the `production` environment must retain its independent protection;
- the owner reviews the preflight artifact, exact SHA, seven checksums, read-only audit, stop conditions, and atomic rollback behavior.

Configuring repository variables, environments, reviewers, or secrets is outside this PR and requires its own authorized settings change.

### 3. Seven migrations

The owner manually dispatches the same workflow from `main` with:

- `operation=apply`;
- the identical `rollout_sha`;
- `owner_confirmation=APPLY_PARTNER_MIGRATIONS_<exact full SHA>`.

The workflow fails unless the actor and triggering actor equal the configured owner. After the protected approval job, it revalidates the SHA, allowlist, order, checksums, and production database identity. A read-only guard requires all prerequisites, no partner relations, and none of the seven migration-history versions. It then invokes one `psql --single-transaction` command containing exactly the seven files in manifest order, the checksum-pinned history registration, and final schema/history verification. `ON_ERROR_STOP=1` aborts on the first error and PostgreSQL rolls back the entire transaction.

Stop immediately on any precheck, identity, approval, checksum, SQL, or verification failure. Do not repair, skip, reorder, or rerun without a new read-only diagnosis and owner decision.

### 4. Schema and migration-history verification

The same transaction verifies all 19 required partner relations, the five strict property-knowledge columns, forced RLS, absence of `anon`/`authenticated` read access, and all seven expected `(version, name)` rows in `supabase_migrations.schema_migrations` before commit. After success, manually run the separate read-only audit again and retain its artifact. The audit now fails unless schema and migration history both match; do not continue if it fails or reports any difference.

The repository has no pinned Supabase CLI package and no `supabase/config.toml`, so `supabase migration repair --status applied` would introduce an unpinned tool and a second database connection. Supabase documents that repair as a history-only operation and that pending migrations are identified by version. A separate repair could leave schema committed without history if the second step failed.

Instead, the controlled transaction writes the CLI-compatible columns `version`, `name`, and `statements` directly. It uses seven plain `INSERT` rows with the exact allowlist, canonical migration names, and empty statement arrays; there is no upsert, wildcard, broad push, delete, or repair command. The registration SQL first validates the canonical history-table column and primary-key contract and refuses any pre-existing allowlisted version. The final verifier requires all seven rows. Therefore:

- a migration error occurs before history registration and rolls the whole transaction back;
- a history collision or incompatible history table aborts and rolls schema changes back;
- a schema, RLS, access, strict-field, or history verification error aborts and rolls both back;
- PostgreSQL exposes neither schema nor history to other sessions until the single commit succeeds.

The only operational ambiguity is a client connection loss while PostgreSQL is returning the final commit result. Never rerun on that ambiguity: run the read-only audit. It will show either the complete schema plus all seven history rows, or the untouched pre-rollout state; the transaction cannot commit only one side.

### 5. `ADMIN_SECRET` configuration

After schema verification, an authorized operator configures the existing `ADMIN_SECRET` value in `/var/www/asi/shared/.env.production.live` through the approved production secret channel. Never paste, echo, or attach the value to a task, workflow input, log, artifact, or PR. Confirm only that the key is present and non-empty. Creating, reading, rotating, or changing this secret is not authorized by this runbook preparation.

### 6. Exact-SHA application deploy

Only after the database and `ADMIN_SECRET` gates pass, the owner separately dispatches `.github/workflows/deploy.yml` with:

- `confirm_production_deploy=DEPLOY_PRODUCTION`;
- `sha=<the same exact rollout SHA>`.

Deployment is a distinct production mutation and requires distinct owner approval. Verify `/api/health` and `/api/version` report a healthy production environment and the exact SHA.

### 7. Production acceptance

Run only the owner-approved, fail-closed partner acceptance scope. Start with read-only health/version and schema evidence. Any fixture creation, partner/provider call, real message, payment, or cleanup is a separate production mutation and must not be inferred from this rollout approval. Record the exact SHA, workflow run URLs, schema audit artifact, acceptance result, and any stop condition.

## Actions that modify production later

Only these later actions mutate production:

1. the `apply_migrations` job's single atomic `psql` invocation applies the seven SQL files, registers exactly seven Supabase migration-history rows, and commits only if schema and history verification succeeds;
2. the authorized `ADMIN_SECRET` update changes the production runtime environment file;
3. the separately approved exact-SHA deploy workflow changes the active application release;
4. any separately approved acceptance step that creates, updates, or deletes production data.

The preflight operation, local validator, PR checks, checksum review, and read-only schema audit do not modify production.
