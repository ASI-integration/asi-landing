# Strigunov4 C4 — targeted read-only deep diagnosis

**Status: SOURCE-ONLY. NO STAGING QUERY HAS BEEN EXECUTED BY THIS PR.**

Prior attempts:
- Physical booking run [39047710115](https://github.com/ASI-integration/asi-landing/actions/runs/39047710115): booking created; cleanup BLOCK.
- First atomic cleanup run [39056059835](https://github.com/ASI-integration/asi-landing/actions/runs/39056059835): `WRITE_UNCERTAIN_RECONCILE_BEFORE_RETRY`.
- Protected read-only census [39056502660](https://github.com/ASI-integration/asi-landing/actions/runs/39056502660): all original 13 fixture counters unchanged. No partial deletion detected across those categories.

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

The output excludes guest names/emails, passwords, message bodies, booking content and connection details. It does not delete, attempt cleanup, send anything, migrate or deploy. If the query fails due to missing tables/columns, it prints a sanitized BLOCK stage code instead of SQL stderr.

## What happens after review

1. Pass source tests, normal Linux CI and CodeRabbit independent review. Publish PR to protected main only after passing.
2. Owner separately triggers and approves `staging` **read-only** workflow. No existing protected run is replayed.
3. Interpret exact fixture dependent counters, identify the first likely failed SQL precondition or missing dependencies, preserve any audit trail.
4. Prepare a separately independently reviewed cleanup protocol that either retains audit-evidence records safely or explicitly refuses cleanup, based on observed data. No automatic mutation; zero effects remain unproven.

Production, Sentinel, current staging application and old branches must remain unchanged.

**Physical booking completion is NOT_READY.** The original 13 records remain the confirmed scope of the 17 October census.
