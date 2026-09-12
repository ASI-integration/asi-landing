# Guest Long-Term Memory v1

## Architecture

Guest long-term memory is a durable layer keyed by the existing unified `guestId` in `tg_contacts` **and** a proven tenant `account_id`. It does not replace the 24-hour communication session and does not create another identity resolver.

- Every read, write, correction, deletion, and “forget guest” path requires both `account_id` and `guest_id`.
- Missing or unproven `accountId` fails closed (empty read / no write). It never falls back to a global guest search.
- `propertyId` is never used as a substitute for `accountId`.
- `guest_memory_profiles` stores bounded profile fields: preferred language, text/voice preference, stay count, and first/last-seen timestamps.
- `guest_memory_preferences` stores one replaceable row per supported operational preference, with source, confidence, and timestamps.
- `guest_memory_events` stores structured operational history. A database trigger keeps at most 50 active events per `(account_id, guest_id)`.
- Communication loads only facts relevant to the current request. Current verified booking and property data always remains authoritative over older memory.
- Late-checkout history is never an approval for the current stay.
- Operator corrections and deletions are available from the communication dashboard. “Forget” removes only the long-term profile for the proven `(account_id, guest_id)` pair.

The model has no columns for full conversation text, voice recordings, door codes, document contents, or payment-card data. The application also rejects sensitive values before persistence.

## Migration requirement

Additive migrations (apply separately from application deploy; do not apply via this PR):

1. `supabase/migrations/20260809120000_guest_long_term_memory_v1.sql` — base tables
2. `supabase/migrations/20260912000001_guest_memory_tenant_isolation_v1.sql` — `account_id` tenant scoping

Application deploy does not apply them automatically. The migrations create/extend service-role-only tables, indexes, timestamp triggers, bounded-retention trigger, RLS, and revoked client grants. They do not modify existing rows in `tg_contacts`. Pre-existing memory rows without `account_id` remain readable only through an explicit out-of-band repair; the application path never auto-assigns an account.

## Operator rollout

These are separate owner-controlled actions after the draft PR is reviewed and merged:

1. Record the merged full commit SHA and the SHA-256 of each migration file.
2. Confirm the exact target database and take the backup required by the production database runbook.
3. Apply the additive migrations through the approved production migration procedure. Do not use application deploy as a migration mechanism.
4. Verify read-only that all three tables have `account_id`, RLS is enabled, `anon` and `authenticated` have no table grants, and the event-retention trigger scopes by `(account_id, guest_id)`.
5. Build and deploy the merged application SHA through the existing manual artifact workflow.
6. Verify `/api/health` and `/api/version` report the expected application SHA.
7. In the operator communication dashboard, use a controlled guest record to verify language persistence, one explicit preference, correction, deletion, and full forget within one account. Do not send a real guest message for this verification.
8. Confirm that a current property parking answer overrides older guest history and that previous late checkout appears only as history.
9. Confirm that the same `guestId` under two accounts remains isolated, and that missing tenant evidence produces no memory read/write.

No new environment variable, subscription, external provider, or secret is required.

## Rollback

Application rollback uses the previous artifact SHA. The schema is additive and can remain in place during application rollback. Removing tables or stored guest memory is a separate destructive database action and must not be coupled to application rollback.
