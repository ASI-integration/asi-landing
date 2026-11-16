# Strigunov OTA Finance ??? private persistence candidate V1

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
- `public.booking_ops_records.account_id` and `property_id` are **text**.
- `public.dist_channel_reservations.account_id` is **uuid**.
- Existing reservation ingestion and reconciliation tables do not establish
  verified real OTA cash settlement or bank statements.

**Consequence:** the proposed ledger uses `account_id uuid` with FK to
`public.accounts(id)` and keeps the original **text** property and booking
identifiers. No implicit cast from text to UUID is permitted; an explicit
account-resolution mapping and property-ownership check is mandatory at the
backend boundary.

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
