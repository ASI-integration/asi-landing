# Channel Manager Live Core production rollout v1

This rollout repairs the production Live Core baseline and installs the canonical connection-scope guard.

## Exact bundle

1. `20260804120000_channel_manager_live_core_initial_sync_v1.sql`
2. `20260805120000_channel_manager_live_core_synthetic_recovery_v1.sql`
3. `20260806170000_channel_manager_live_incremental_sync_v1.sql`
4. `20260807120000_channel_manager_reconciliation_recovery_v1.sql`
5. `20260808041000_channel_manager_live_core_recovery_fk_expectation_fix_v1.sql`
6. `20260808051000_channel_manager_live_core_acceptance_cleanup_v2.sql`
7. `20261004123000_channel_manager_live_scope_guard_v1.sql`

The first two migrations are deliberately replayed even though their current semantic effects are already visible in production. They are idempotent and replaying them in the same transaction establishes the exact canonical definitions before migration history is registered.

## Production preflight observed on 2026-10-05

- initial Live Core schema probe: ready;
- existing import rows: four, all `initial_sync`;
- incremental RPC layer: absent;
- reconciliation tables: absent;
- scoped Live Core guard: absent;
- all seven target migration versions: absent from Supabase migration history.

The apply path must re-run a read-only precheck immediately before mutation. This document is not permission to apply production DDL.

## Safety

The workflow is checksum-pinned, main-SHA-bound, owner-gated, production-environment-gated, and applies schema + history + verification in one PostgreSQL transaction. If any migration or verification step fails, PostgreSQL rolls the transaction back.

No provider call, OTA publishing, application deploy, DNS change, secret change, or unrelated data mutation is part of this rollout.
