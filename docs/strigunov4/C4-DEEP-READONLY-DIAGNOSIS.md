# Strigunov4 C4 — targeted read-only deep diagnosis

## 18 October 2026: complete staging schema results and conservative read-only follow-up

Approved read-only run [39104867696](https://github.com/ASI-integration/asi-landing/actions/runs/39104867696) confirms **10 absent optional feature tables**: `public.guest_lifecycle_events`, the three partner binding tables, and the six partner communication tables (`actions`, `decisions`, `handoffs`, `inbox`, `sessions`, `turns`). The other 15 relations in the fixed schema allowlist exist. This DOES NOT prove any columns, rows, or foreign-key restrictions are safe to delete.

The 10 absent tables belong to separate August guest-lifecycle/partner migrations, outside the nine C4 staging SQL changes. No migration is automatically justified. This revision of the read-only witness treats absent optional modules as **null/NOT_DEPLOYED**, while preserving row counts for present tables, FAIL-CLOSED rejection of missing core tables, exact incident identity, read-only connection and all protected GitHub gates. There is NO authority to clean test records or replay physical booking. The existing C4 cleanup contains direct references to missing optional tables and remains BLOCKED until separately reviewed and fixed.

## 18 October 2026: confirmed schema mismatch, not permission for migration

Approved GitHub staging-only read-only run [39103410182](https://github.com/ASI-integration/asi-landing/actions/runs/39103410182) passed source and owner gates, then failed closed with `MISSING_RELATION_GUEST_LIFECYCLE_EVENTS`. The schema object `public.guest_lifecycle_events` is absent in this staging database. No writes or cleanup occurred.

That table is created by the separate historical migration `supabase/migrations/20260809160000_guest_lifecycle_communications_v1.sql`, **not** one of the nine specifically approved Strigunov4 staging migrations. The evidence does not establish whether its absence is expected by the staging scope or an unaddressed migration; **do not apply an unrelated migration without first deciding scope**.

The C4 cleanup source also refers directly to this table, so cleanup must remain blocked. Prior schema preflight returned only the first missing relation; this source-only revision reports a sorted bounded list of **all** absent, fixed-allowlist relation names in one protected read-only run and stops before all row counts. No table creation, cleanup, booked fixture replay, or environment changes. A fresh owner-authorized, protected-main SHA bound workflow run is required to learn the actual full set.


**Status: protected read-only deep diagnosis #39103410182 returned MISSING_RELATION_GUEST_LIFECYCLE_EVENTS, without mutation. This revision is SOURCE-ONLY until independently reviewed and separately dispatched.**

Prior attempts:
- Physical booking run [39047710115](https://github.com/ASI-integration/asi-landing/actions/runs/39047710115): booking created; cleanup BLOCK.
- First atomic cleanup run [39056059835](https://github.com/ASI-integration/asi-landing/actions/runs/39056059835): `WRITE_UNCERTAIN_RECONCILE_BEFORE_RETRY`.
- Protected read-only census [39056502660](https://github.com/ASI-integration/asi-landing/actions/runs/39056502660): all original 13 fixture counters unchanged. No partial deletion detected across those categories.
- Protected deep read-only run [39061146150](https://github.com/ASI-integration/asi-landing/actions/runs/39061146150): main/owner and SQL-history gates passed, census command blocked. No new counts were obtained; stderr deliberately hidden. No staging mutation.

## Concrete source evidence

The deployed G0 source `d912aec6663de90e5ca4293cc5a69e2e0ed9ff94` includes `recordBookingOpsEvent` in the successful intake automation. `public.booking_ops_events` references the booking with `ON DELETE CASCADE`, yet the old 13-count witness and the cleanup's early precondition do not explicitly count this table. This is a material audit-evidence preservation risk.

G0 additionally has `ensurePhysicalTasks` that can create `booking_cleaning_tasks`, `booking_linen_tasks`, `booking_supplies_tasks` and `booking_physical_readiness` if invoked. Their direct FK relationships are `ON DELETE CASCADE`. We do **not** assert they were created by this particular physical booking; staging must be queried to know.

The reviewed cleanup has additional defensive blockers for physical readiness, partner records and outbound deliveries. These blockers can abort a transaction without modifying any row. Previous logs hid PostgreSQL stderr; we cannot yet distinguish a blocked precondition, another FK, or SQL execution error. **Do not rerun any mutation based on inference.**

## Read-only witness proposed here

Adds a separate GitHub `staging`-protected, main-only workflow:
- owner SHA-bound confirmation, current main, first attempt, fixed prior incident;
- previously reviewed PostgreSQL17/TLS verify-full connection and exact 99/7/9 schema history;
- single `REPEATABLE READ READ ONLY` transaction plus PostgreSQL `default_transaction_read_only=on`;
- numeric counts for 25 fixed categories, including booking audit events, physical-readiness rows, guest lifecycle, deliveries and send attempts, pristine versus non-pristine Telegram drafts and direct partner descendants;
- PostgreSQL catalog's **schema-only names** from a depth-limited recursive foreign-key dependency map rooted at users/accounts/properties/bookings/intents/tasks. It follows cascade relationships to indirect descendants and separately lists `NO ACTION`/`RESTRICT` blockers and `SET NULL`/`SET DEFAULT` side-effect relationships. This is a diagnostic map, not proof that rows exist in every listed table or that the dependency inventory is exhaustive for every possible schema path.

On command failure, the proposed revision sets PostgreSQL psql `VERBOSITY=sqlstate` and emits only a five-character SQLSTATE or UNKNOWN; raw stderr remains suppressed. The output excludes guest names/emails, passwords, message bodies, booking content and connection details. It does not delete, attempt cleanup, send anything, migrate or deploy. If the query fails due to missing tables/columns, it prints a sanitized BLOCK stage code instead of SQL stderr.

## What happens after review

1. Pass source tests, normal Linux CI and CodeRabbit independent review. Publish PR to protected main only after passing.
2. Owner separately triggers and approves `staging` **read-only** workflow. No existing protected run is replayed.
3. Interpret exact fixture dependent counters, identify the first likely failed SQL precondition or missing dependencies, preserve any audit trail.
4. Prepare a separately independently reviewed cleanup protocol that either retains audit-evidence records safely or explicitly refuses cleanup, based on observed data. No automatic mutation; zero effects remain unproven.

Production, Sentinel, current staging application and old branches must remain unchanged.

**Physical booking completion is NOT_READY.** The original 13 records remain the confirmed scope of the 17 October census.
