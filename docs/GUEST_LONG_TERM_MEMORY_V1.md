# Guest Long-Term Memory v1

## Architecture

Guest long-term memory is a durable layer keyed by the existing unified `guestId` in `tg_contacts`. It does not replace the 24-hour communication session and does not create another identity resolver.

- `guest_memory_profiles` stores bounded profile fields: preferred language, text/voice preference, stay count, and first/last-seen timestamps.
- `guest_memory_preferences` stores one replaceable row per supported operational preference, with source, confidence, and timestamps.
- `guest_memory_events` stores structured operational history. A database trigger keeps at most 50 active events per guest.
- Communication loads only facts relevant to the current request. Current verified booking and property data always remains authoritative.
- Late-checkout history is never an approval for the current stay.
- Operator corrections and deletions are available from the communication dashboard. “Forget” removes the full long-term profile by the unified guest identity.

The model has no columns for full conversation text, voice recordings, door codes, document contents, or payment-card data. The application also rejects sensitive values before persistence.

## Migration requirement

The additive migration is:

`supabase/migrations/20260809120000_guest_long_term_memory_v1.sql`

Application deploy does not apply it automatically. The migration creates three service-role-only tables, their indexes, timestamp triggers, bounded-retention trigger, RLS, and revoked client grants. It does not modify existing rows in `tg_contacts`.

## Operator rollout

These are separate owner-controlled actions after the draft PR is reviewed and merged:

1. Record the merged full commit SHA and the SHA-256 of the migration file.
2. Confirm the exact target database and take the backup required by the production database runbook.
3. Apply only `20260809120000_guest_long_term_memory_v1.sql` through the approved production migration procedure. Do not use application deploy as a migration mechanism.
4. Verify read-only that all three tables exist, RLS is enabled, `anon` and `authenticated` have no table grants, and the event-retention trigger is present.
5. Build and deploy the merged application SHA through the existing manual artifact workflow.
6. Verify `/api/health` and `/api/version` report the expected application SHA.
7. In the operator communication dashboard, use a controlled guest record to verify language persistence, one explicit preference, correction, deletion, and full forget. Do not send a real guest message for this verification.
8. Confirm that a current property parking answer overrides older guest history and that previous late checkout appears only as history.

No new environment variable, subscription, external provider, or secret is required.

## Rollback

Application rollback uses the previous artifact SHA. The schema is additive and can remain in place during application rollback. Removing tables or stored guest memory is a separate destructive database action and must not be coupled to application rollback.
