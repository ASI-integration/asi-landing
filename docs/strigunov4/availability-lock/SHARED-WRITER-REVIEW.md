# Shared availability-writer correction

Status: candidate source reviewed; native cross-writer regression pending. The prospective nine-SQL restored-database set (six base migrations, purpose repair, canonical lock correction and shared-writer correction) is NOT VERIFIED. The earlier eight-SQL attempt timed out without a result. This document does not claim runtime application or completion of either rehearsal.

The review of PR473 at `43c4f10577b4da6e62ef0e675f4ef670f0c50040` identified a real gap beyond the previously proved setup-ID/direct-property race. Three service-role RPCs can insert availability holds. The account-scoped RPC now uses an account/property advisory lock with seed 7411, while the legacy RPC still used a setup/property-only key and the reservation-ledger RPC used an account/property/unit key with seed 0. The dashboard reservation path calls the ledger RPC. The application hold helper also retains an explicit legacy fallback when its optional account is absent. This is not evidence of an unauthenticated exploit.

The legacy RPC also omits account lineage on new rows. A shared lock alone would not correct this: account-scoped conflict reads exclude those NULL-account holds. The forward migration therefore preserves its signature and delegates to the canonical RPC after resolving the setup/property agreement and authoritative property account. Missing, blank or mismatched ownership cannot fall back to the unscoped writer. The canonical delegate revalidates the setup, property and optional booking before writing.

The ledger function changes only its advisory-lock expression to the same account/property key and seed. Its unit-sensitive conflict predicates and JSON return contract remain unchanged. Property-wide serialization ensures a unit-specific request also waits for a conflicting property-wide request; it does not prohibit nonconflicting units after the wait.

This correction covers the three atomic hold-creation RPCs. It does not backfill historical NULL-account holds, serialize all direct booking/block state changes, or redesign ledger idempotency. The authenticated ledger caller prefixes its key with its canonical account; reuse of a key across properties within the same account remains pre-existing behavior.

All three existing function signatures are prerequisites. This prevents CREATE OR REPLACE from silently creating a previously absent function with default PUBLIC permissions. Existing function owners and EXECUTE ACLs are retained. No grants, source data, historical migrations, executed rehearsal scripts or old receipts are rewritten.

The new version `20261016213000` was checked against the complete, untruncated tree `16b73faf0fbae2217d423836dcfdeade653c7d6f`: 133 migration files and no collision. It becomes migration 134. The older migration and its two-session PASS remain valid evidence only for their original scope.

The independently reviewed native test uses actual PostgreSQL 17 calls across writers, ledger unit/property-wide calls, observed advisory waiting followed by conflict, legacy account lineage, invalid legacy scope rejection, and owner/ACL preservation. A separate different-unit positive case verifies that serialization does not change unit filtering. It first demonstrates the old writers accepting concurrent overlapping holds, then requires the corrected writers to wait and report conflict. No database conflict decision is mocked. Execution remains pending until the exact-head CI receipt is recorded.

Separate operational limitation: an automation lease with an unknown external outcome remains held for privileged reconciliation. This migration does not introduce lease expiry, retry, or an operator reconciliation API.
