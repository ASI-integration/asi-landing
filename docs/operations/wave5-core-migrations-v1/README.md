# Wave 5 core production migrations v1

This runbook prepares a controlled production rollout of five Wave 5 core migrations. It **does not authorize an apply**. The owner gate stays `missing` until Nikolay explicitly authorizes the production migration bundle after reviewing the exact preflight.

## Fixed scope

The checksum-pinned source of truth is `manifest.json`. Canonical order:

1. `20260930200000_guest_long_term_memory_account_scope.sql`
2. `20261003093000_residential_property_spatial_snapshots_v1.sql`
3. `20261003124500_booking_ops_auto_send_account_scope_v1.sql`
4. `20261003141500_booking_inbound_intake_account_scope_v1.sql`
5. `20261003150000_booking_availability_account_scope_v1.sql`

Explicitly excluded: `20261004123000_channel_manager_live_scope_guard_v1.sql`. Production is missing its prerequisite Live Core RPC functions, so Channel Manager gets a separate rollout.

## Why this rollout exists

The 2026-10-05 production pilot-readiness acceptance reached the live production database and failed on real schema drift: application code expected `booking_inbound_intake_events.account_id`, while the production schema did not have it. Read-only follow-up confirmed the wider Wave 5 core account-scope/spatial schema was also absent.

The acceptance cleanup succeeded: the synthetic property was removed, no synthetic booking remained active, and the test booking was retained only as `cancelled` audit history.

## Read-only production evidence collected before this PR

Target: Supabase project `jwinifeienvzejofmbua`.

- Guest memory: 2 profile rows, 1 preference row, 0 event rows. No inbound FK references the current guest-memory profile primary key. The migration intentionally preserves legacy NULL-account rows via `NOT VALID` checks.
- Auto-send: 1 scope, global only; 0 enabled non-global scopes; no duplicate `scope_type/scope_ref_key` pairs. 1246 historical runs; 0 delivery rows.
- Inbound intake: 1 row, and it resolves unambiguously to a canonical account through its booking.
- Availability: 1 hold and it resolves to account/property; 0 blocks. 31 historical conflict checks are resolvable and 218 legacy checks are not. The migration deliberately leaves unresolved historical checks nullable and does not impose `NOT NULL`.
- Channel Manager scope guard is excluded because the required baseline Live Core RPC functions are absent in production.

The apply workflow repeats the decisive compatibility checks immediately before mutation and fails closed if the target changes.

## Operator sequence

### 1. Merge preparation only

Merge the rollout-control PR only after CI is green. This creates the runbook/workflow; it does not mutate the database.

### 2. Non-mutating preflight

From `main`, manually dispatch **Wave 5 Core Migrations Production Rollout v1** with:

- `operation=preflight`
- `rollout_sha=<exact full 40-character main SHA>`
- empty `owner_confirmation`

The workflow validates the exact SHA, manifest allowlist/order, Git blob IDs, SHA-256 checksums, and owner-gate state, then uploads a non-mutating report.

### 3. Explicit owner approval

Review the preflight artifact and current production evidence. Only then update `migration-owner-gate.json` to:

- `status=approved`
- `authorization.source=explicit_owner_message`
- `authorization.owner=Nikolay`
- a precise production-migration `scope`
- a new `taskCycle`

Typed workflow confirmation is not owner approval.

### 4. Protected production apply

After the approved gate is on `main`, manually dispatch the same workflow with:

- `operation=apply`
- `rollout_sha=<exact full 40-character main SHA containing the approved gate>`
- `owner_confirmation=APPLY_WAVE5_CORE_MIGRATIONS_<rollout_sha>`

The workflow requires the configured owner actor, the `production-migration-approval` protected environment, exact DB project identity, a read-only DB precheck, and then the independent `production` protected environment.

The apply is one `psql --single-transaction` command containing exactly the five migrations, exact migration-history registration, and final verification. Any SQL/history/verification failure rolls back the whole transaction.

### 5. Post-apply acceptance

After schema verification:

1. verify public production health/version;
2. rerun the synthetic pilot-readiness acceptance;
3. verify synthetic cleanup leaves no active test property/booking/contact;
4. retain the workflow and acceptance evidence.

## Stop conditions

Stop without repair or retry if:

- target project identity is not exactly `jwinifeienvzejofmbua`;
- any migration checksum/blob differs from the manifest;
- any target migration history version is already present;
- partial target schema is detected;
- any existing inbound intake row cannot be canonically resolved;
- an availability hold/block cannot be canonically resolved;
- a non-global actual-send scope is enabled;
- owner gate is not approved for this exact bundle;
- SQL, history registration, or verification fails.

Do not add the Channel Manager migration to this rollout.
