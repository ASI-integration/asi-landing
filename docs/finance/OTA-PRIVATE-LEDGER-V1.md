# Strigunov OTA Finance — private persistence candidate V1

**Status: DESIGN / SOURCE CANDIDATE ONLY. NOT APPLIED.** This document and its companion
`docs/finance/sql/ota-finance-private-ledger-candidate.sql` are not production migrations.
The existing staging, protected `main`, live Supabase database, OTA connections, bank
accounts, and external APIs remain unchanged.

## Verified existing ASI database contracts (read-only inspection, 2026-11-16)

- The live Supabase project is PostgreSQL 17.
- `public.accounts.id` and `public.account_members.account_id` are UUIDs.
- `public.account_members.user_id` is UUID. Existing policy exposes membership
  only to service-role access; ordinary `authenticated` users do not have a
  usable account-membership SELECT policy.
- `public.booking_ops_records.account_id` and `property_id` are **text**, whereas `public.properties.id` and `account_id` are UUIDs.
- `public.dist_channel_reservations.account_id` is **uuid**.
- Existing reservation ingestion and reconciliation tables do not establish
  verified real OTA cash settlement or bank statements.

**Consequence:** the proposed ledger uses `account_id uuid` with FK to
`public.accounts(id)` and now records canonical `property_id uuid`, with a composite foreign key
to `public.properties(id, account_id)` to reject mismatched tenant ownership.
Legacy booking property references are **text** and must be resolved explicitly;
`booking_id` stays text. No automatic legacy cast or fallback to a first account
is permitted; missing/ambiguous mappings must be denied.

## Private schema and access

`ota_finance_private` is **not** a Data API exposed schema. Four proposed
append-only data families:

1. `fee_rule_versions`: effective contract fees, currency and evidence digest;
   a new row for every revision; overlap prevention is a **blocking future
   requirement** (the SQL currently only validates each individual range).
2. `statement_imports`: source digest and CSV provenance, always
   `UNVERIFIED_OPERATOR_IMPORT`; no raw guest details or original CSV payload.
3. `cash_events`: isolated cash claims in integer minor units, with composite
   FK to a matching tenant+property+provider+currency statement and an
   idempotency uniqueness constraint. No event can silently move accounts.
4. `statement_reviews`: immutable operator attestation; NOT a bank-confirmed
   settlement event. It references the same tenant and statement scope.

**No GRANT for `anon` or `authenticated`.** RLS enabled on every proposed
table, with no public policies. Only the backend's `service_role` gets SELECT
and INSERT. That role bypasses RLS, so the absence of direct client access is
not enough by itself: the server MUST authenticate the caller, verify
`public.account_members (account_id,user_id)` using a backend-only trusted
client and separately verify property/booking ownership **before each read
and write**. No service-role key may appear in browser bundles.

Review actors reference `public.users(id)` (the existing application identity model),
not `auth.users`. The migration adds one composite unique index to
`public.properties`; this shared-table change must be independently reviewed.

No `UPDATE` or `DELETE` privileges are granted to service_role on these
four financial tables; corrections are appended as new events. Privileged
database owners can still alter data, so this is not tamper-proof archival.

## Safety and correctness boundaries

- Status of an operator-supplied row is never promoted automatically to
  `bank_settled`; the word `claimed_settled_on` is deliberate.
- No real OTA terms are guessed. Contracts must be provided and verified by
  their owner. Taxes, payment processing, FX, chargebacks, complex cancellation
  policies and Channel Manager invoice settlement are **not included**.
- Dates, fee validity, duplicate IDs, case-sensitive external references and
  currency are checked again on the server before insert, using the
  `src/lib/ota-finance` read-only calculation code from PR #659.
- The schema checks identical event identity but does **not** supply a provider
  signature, prevent forged statements, attest banking settlement, or implement
  automatic matching/notifications.
- Source version `329fb772115069f0fa1892efcfe395f3f3d278ed` from
  draft PR #659 has five financial regression suites; no runtime database
  adapter exists yet.

## Required before ANY live migration

1. Generate an official migration with a verified Supabase CLI version
   (`supabase migration new`; this tool is not installed on the VPS). Never
   invent a migration timestamp or pretend this candidate was deployed.
2. Review exposed schemas, default privileges, auth roles and FK targets in
   the exact target project and run disposable PostgreSQL 17 syntax, FK,
   privilege, RLS and tenant-crossing integration tests.
3. Add test cases for two accounts and two properties: deny `anon`,
   `authenticated` and cross-tenant access; allow only authorized backend
   calls, verify collision/idempotency, reject UPDATE/DELETE, reject
   forged `bank_settled` markers and contract-date overlaps.
4. Implement authenticated server-side account/booking owner resolution
   and audit logging; never let an untrusted client select an `account_id`.
5. Separate operator-reviewed evidence from genuine bank clearing receipts.
   Only then design the reconciliation and read-only owner dashboard.
6. Obtain explicit approval before applying migrations to the shared project.

References: Supabase *Row Level Security* and *Securing Your API* guides,
including the 2026 changes to automatic Data API table exposure.

## V1.2 consolidated server authorization and disposable PostgreSQL rehearsal

- One authorization helper remains: `src/lib/ota-finance/access.ts`. It accepts the
  application's own validated iron-session, then checks `public.account_members`
  and `public.properties` with a backend-only trusted client. It never trusts
  a request-body user ID or a guessed legacy account. `owner` can request
  read/import/review/fee-rule operations; `manager` can request read only;
  `operator`, missing or invalid membership, absent property and DB failures
  fail closed. No financial route or database adapter is activated.
- The incompatible `private-scope.ts` proposal using Supabase Auth access tokens
  has been removed together with its tests. The ASI application has its own
  `public.users` / iron-session auth model; mixing these would risk silently
  rejecting legitimate users or creating a second authorization surface.
- When a legacy booking reference is supplied, the guard accepts it only
  if exactly one matching `booking_ops_records` row has the exact canonical
  account and property string. Resolving arbitrary legacy aliases requires a
  future explicit, reviewed mapping table, never an implicit cast.
- `src/lib/ota-finance/__tests__/access.test.ts` tests unsigned callers,
  missing sessions, manager write denial, cross-tenant property checks,
  ambiguous booking identity, DB failures and exact membership authorization.
  These tests remain source-only until Vitest/CI results are confirmed.
- `scripts/finance/ota-private-ledger.pg.integration.test.mjs` checks real
  PostgreSQL 17 DDL, role privileges, RLS, FK tenant isolation, date exclusion,
  forged bank settlement markers, immutable review attribution, event
  idempotency and rejected UPDATE/DELETE. It refuses all databases except
  `localhost:5433/asi_ota_finance_test`, requires the database be empty,
  and tears down fixtures after the transaction.
- GitHub PR Validation now provisions a **separate database** with the name
  `asi_ota_finance_test` inside an existing disposable PostgreSQL 17 container,
  runs the integration suite, and drops only this dedicated database.
  Neither existing availability tests nor live Supabase data are reused.
- Static SQL contract tests: **12/12 PASS**, run through local Node.js on
  2026-11-16. Disposable PostgreSQL 17 succeeded in PR Validation run 43893513609;
  app-session access Vitest, lint and TypeScript typecheck succeeded in
  run 43893938615. Release-governance check currently blocks workflow changes
  pending verified owner attestation. No deployment claim is allowed.

## Next authorization gates

1. Observe successful disposable PG17 and real Vitest/typecheck CI results.
2. Review the exact private PostgreSQL access adapter before integrating
   the approved guard into any API handler. The schema is not exposed via Data API.
3. Review lifecycle and audit log of finance operations plus owner session
   revocation behavior, and resolve any pre-existing booking identifier aliases.
4. After independent approval and PG17 verification, generate an official SQL
   migration with a verified Supabase CLI version; **do not apply it** to
   staging or production without explicit authorization.

## Official migration file prepared (NOT applied)

- Prepared with `Supabase CLI 3.1.0`: `supabase migration new ota_finance_private_ledger_v1`
  produced the local filename
  `supabase/migrations/20261116151659_ota_finance_private_ledger_v1.sql`.
- The file was populated using the same PostgreSQL 17-tested DDL, omitting
  only candidate comments and manual `BEGIN/COMMIT` so the official migration
  runner controls the transaction. The candidate SQL and the migration have
  identical DDL text, confirmed by **13/13 Node static tests**.
- Real SQL DDL/RLS/FK/privilege validation passed on disposable PostgreSQL 17:
  GitHub PR Validation run **43893513609**, job
  `channel-manager-recovery-postgres`, including database teardown.
- The application-session authorization tests, lint and TypeScript typecheck
  passed in run **43893938615**. Protected release governance is separately
  blocked on `GOVERNANCE_CHANGE_NEEDS_VERIFIED_OWNER_ATTESTATION`, which must
  not be bypassed.
- No `supabase db push`, `apply_migration`, migration deploy, payment
  operation, or production/staging database write was performed.
- The migration MUST remain in Draft until owner-approved release controls,
  source diff review and strict target-identity verification are complete.

## V1.3 private read adapter (source only)

- `src/lib/ota-finance/private-reader.ts` introduces a server-only, injected
  PostgreSQL reader for the **non-exposed** `ota_finance_private` schema.
  It does not create a DB pool, connection string, API route, mutation, public
  Data API grant, secret, OTA call, or bank transfer.
- Every method performs fresh `requireOtaFinanceScope` authorization:
  tenant + property for statement/fee read; account + property + exact legacy
  booking reference for cash-event read. All SQL uses fixed table/column
  names with positional bind parameters; no interpolated user SQL.
- Read bounds are 1–100 rows, default 50. Returned account/property/booking
  identities are rechecked as a last fail-closed guard; no privileged
  cross-tenant response is accepted. Money is returned as decimal **text**
  rather than lossy JS Number conversion. Imported statements and cash events
  remain explicitly `UNVERIFIED_OPERATOR_IMPORT`.
- `src/lib/ota-finance/__tests__/private-reader.test.ts`: eight additional
  mock-boundary regressions. The normal PR Validation source job now runs both
  focused access and read-adapter suites alongside the static SQL tests.
- This is **not yet a production persistence integration**. The future adapter
  must obtain a separately controlled PostgreSQL connection, enforce
  authorized role/operation scope, and guarantee revocation-aware audit
  before exposing private data. Append/write operations remain disabled.
- The 2026-11-16 current-head CI and release-governance status must be checked
  independently; no merge, migration apply, or staging deployment is authorized.

## V1.4 atomic operator-import/audit proposal (still NOT applied)

- `src/lib/ota-finance/transactional-import.ts`: a **server-only, injected**
  PostgreSQL transaction processor. It does not construct a database pool,
  read a connection string or expose a route. It accepts bounded normalized
  CSV-derived statement/event input and stores only unverified operator claims.
- After secure iron-session authorization, every booking must resolve uniquely
  to the same canonical account/property. Inside the same PostgreSQL transaction
  it rechecks ownership with a row lock and every booking mapping, then
  inserts **one statement, up to 50 cash events, and one audit entry**.
  All statements are fixed/parameterized; currency, dates, integer minor units,
  SHA-256 source digest and external event IDs are strictly validated.
- `supabase/migrations/20261116153907_ota_finance_transaction_audit_v1.sql`
  was generated locally using Supabase CLI `migration new`. It introduces
  the fifth private family, `ota_finance_private.operation_audit`, linking
  actor `public.users`, statement, tenant, canonical property, payload SHA,
  count, unique operation ID and `COMMITTED_UNVERIFIED` status. RLS is on;
  only `service_role` SELECT/INSERT, no UPDATE/DELETE or direct client grants.
  The migration is a **proposal** and was never applied to connected Supabase.
- Any write or audit failure before COMMIT invokes ROLLBACK and propagates
  failure. If COMMIT itself loses its result, the processor explicitly returns
  `FINANCE_IMPORT_COMMIT_OUTCOME_UNKNOWN_NO_AUTOREPLAY`; no automatic
  duplicate transaction is attempted.
- `src/lib/ota-finance/__tests__/transactional-import.test.ts`: unit tests
  for all-or-none operations, denial before privileged DB connection,
  canonical booking/owner scope, invalid dates/money, duplicate events,
  rollback and unknown COMMIT handling.
- The disposable PG17 integration test now checks the fifth private RLS
  table, FK constraints, unique audit IDs, invalid actors, prevention of
  forged bank clearance and actual rollback of statement+event data when
  its audit insert is rejected.
- **Limits:** the new table captures **committed successful import audit**,
  not a tamper-proof external audit or guaranteed permanent recording of all
  rejected requests. A separate trusted denial-event logger and session
  revocation design are required before enabling public endpoints. The
  transaction processor is not wired to staging, routes, Supabase production,
  OTA or a bank. No claims of verified bank settlement are authorized.
- Modifying this PR changes its head SHA, so the previous exact-SHA owner
  attestation must not be represented as approving the new head. Protected
  governance and CI must be re-evaluated before any merge/release.
