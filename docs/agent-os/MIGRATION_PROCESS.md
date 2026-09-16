# ASI Agent OS v0 — unified migration process (AO-004)

This is the canonical migration runbook. It does **not** introduce a second migration framework. It unifies the repository's existing mechanisms behind one machine-readable contract.

## Inventory (existing mechanisms only)

| Kind | What already exists | Registry role |
| --- | --- | --- |
| SQL chain | `supabase/migrations/*.sql` | source of truth |
| Staging CLI | `docs/BOOKING_OPS_STAGING_BOOTSTRAP.md`, `scripts/staging-booking-ops-schema-smoke.sh` | apply backend with dry-run |
| Python helpers | `scripts/apply-*migration*` | apply backends |
| Production workflows | `.github/workflows/apply-*.yml` | owner-gated apply backends |
| Partner rollout | `docs/operations/partner-production-rollout-v1/`, `.github/workflows/partner-production-rollout-control-v1.yml` | checksum-pinned controlled rollout |
| Reference SQL | `docs/migrations/`, `scripts/migrations/` | reference only — never apply |

Machine-readable registry: [`migration-mechanisms.json`](./migration-mechanisms.json).

## Shared contract

1. **Plan** — `asi.agent-os.migration-plan.v1`
2. **Result / verification evidence** — `asi.agent-os.migration-result.v1`
3. **CLI** — `node scripts/agent-os/migration-process.mjs`

The CLI never opens a database connection and never mutates staging or production. `mutationAllowed` is always `false` inside this contract. An approved apply only emits a **non-executing handoff** to an established backend listed in the registry.

### Target / environment identity

Every plan requires:

- `target.environment` ∈ `local` | `staging` | `production`
- `target.identity`
- `target.expectedIdentity`

The process **fails closed** unless `identity === expectedIdentity`.

### Dry-run / plan mode

```bash
node scripts/agent-os/migration-process.mjs plan \
  --mechanism supabase-migrations-chain \
  --environment local \
  --identity local-dev \
  --expected-identity local-dev

node scripts/agent-os/migration-process.mjs dry-run \
  --mechanism supabase-cli-staging-push \
  --environment staging \
  --identity "$STAGING_SUPABASE_PROJECT_REF" \
  --expected-identity "$STAGING_SUPABASE_PROJECT_REF"
```

Dry-run here means: build the plan, list checksummed SQL, prove identity match, stop. It does not run `supabase db push`. The staging smoke script remains the established backend when an operator later performs a real CLI dry-run against staging.

### Explicit apply gate

```bash
node scripts/agent-os/migration-process.mjs apply \
  --mechanism partner-production-rollout \
  --environment production \
  --identity <project-ref-or-exact-target> \
  --expected-identity <project-ref-or-exact-target> \
  --owner-gate docs/operations/.../migration-owner-gate.json \
  --confirm APPLY_...
```

Rules:

- production apply requires an approved `production_migration` owner-gate artifact;
- typed confirmation phrases in workflows are **not** owner approval;
- success emits `applyHandoff.executed=false` and the established path (workflow/script/runbook);
- operators then run only that established backend under its own protections.

### Verification evidence

A passing result must include:

- `targetMatch: true`
- `mutationPerformed: false` for plan/dry-run/handoff
- `verificationEvidence[]` describing what was checked

CI validates fixtures and regenerates a live dry-run plan over the tracked SQL chain.

### Rollback policy

Default policy for applied DDL:

1. treat schema history as append-only;
2. do not rewrite or drop applied migrations in place;
3. prepare a new forward-fix migration;
4. obtain a **new** owner gate before any production rollback DDL.

Partner controlled rollout additionally keeps its atomic single-transaction rollback-on-error behavior.

## Operator sequence

1. Create/review SQL under `supabase/migrations/` only (yellow).
2. Generate a plan / dry-run artifact with `migration-process.mjs`.
3. Stop on identity mismatch or missing gate.
4. For staging: use the established CLI/smoke backend after operator approval.
5. For production: satisfy owner gate, then dispatch the established workflow/rollout only.
6. Retain verification evidence from the backend (schema/history/audit artifact).
7. If rollback is required, start a new red cycle — never reuse a consumed gate.

## CI enforcement

`scripts/agent-os/check-migration-process.mjs` fails closed when:

- a discovered apply helper/workflow is missing from the registry;
- the canonical runbook is missing required topics;
- plan/result fixtures violate schema or safety invariants;
- target identity mismatch does not throw;
- contract bundle validation fails.

## Out of scope

- AO-005 (hard-coded migration counts in staging docs/scripts)
- AO-003 (homogenizing every production workflow owner-gate YAML)
- Performing any real database migration from this contract
