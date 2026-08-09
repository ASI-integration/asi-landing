# Guest Lifecycle Communications v1

## Architecture

Guest lifecycle communication extends the existing Booking Ops and Communication seams:

1. A provider adapter emits `GuestLifecycleEvent` into `handleGuestLifecycleEvent()`.
2. `guest_lifecycle_events` durably claims the canonical source event and stores scheduling/projection state.
3. Exact reservation, property, guest, and recipient binding is resolved before proactive delivery.
4. The planner uses verified Booking Ops dates and property knowledge plus allowlisted Guest Long-Term Memory preferences.
5. Safe messages use existing `booking_ops_communication_intents`, auto-send policy decisions, send scopes, durable delivery rows, channel adapters, and optional voice fallback.
6. Sensitive or blocked states use the existing operator handoff/reply/resume system.
7. The existing Communication dashboard reads a lifecycle projection; there is no separate operator product.

No OTA-specific contract is embedded in the planner. A future Bnovo, TravelLine, Booking, Airbnb, or Avito adapter only maps its source payload to the canonical event.

## Canonical event contract

```ts
type GuestLifecycleEvent = {
  eventType: GuestLifecycleEventType;
  reservationId: string;
  propertyId: string;
  guestId: string;
  occurredAt: string;       // ISO-8601
  scheduledFor?: string;    // ISO-8601; optional future delivery time
  source: string;           // adapter name, never provider logic
  sourceEventId: string;    // stable source identity
  language?: 'ru' | 'en';
  facts?: {
    operatorConfirmed?: boolean;
    feedbackAppropriate?: boolean;
    approvedUntil?: string;
  };
};
```

Supported events:

- `reservation.created`, `reservation.confirmed`, `reservation.cancelled`
- `arrival.due_24h`, `arrival.due_3h`
- `checkin.ready`, `guest.checked_in`
- `stay.active`, `stay.checkin_followup`, `stay.completed`
- `checkout.due_24h`, `checkout.due_3h`, `guest.checked_out`
- `late_checkout.requested`, `late_checkout.approved`, `late_checkout.denied`
- `incident.reported`, `incident.resolved`

Stages converge to `reservation -> arrival -> checkin -> stay -> checkout -> completed`. Cancellation is terminal for future arrival/check-in/stay/checkout reminders. Incident events are an urgent side path and do not wait behind normal lifecycle messages.

## Idempotency and replay

The deterministic key is SHA-256 over contract version, source, source event ID, event type, reservation, property, and guest. The ledger has unique constraints on both the deterministic key and `(source, source_event_id)`. Delivery also uses the same lifecycle key through the existing unique delivery idempotency key.

- repeated source events return the existing terminal outcome;
- scheduled events remain pending until due;
- failed events can retry;
- a recent `processing` claim blocks concurrent workers;
- a stale claim can recover after five minutes;
- a sent delivery is terminal and application restart/replay does not send it again.

The provider boundary is called only after a durable delivery claim. Text is always sent first. A preferred voice copy is optional and remains behind `VOICE_REPLY_ENABLED`; ElevenLabs/OpenAI fallback failure does not change successful text delivery.

## Personalization and memory

Language order is remembered language, then verified event/session language, then RU. Remembered communication mode selects text or an optional voice copy. Parking and accessibility preferences are used only when relevant and phrased without referring to a previous visit.

Only structured allowlisted history is written:

- `completed_stay` after `stay.completed`;
- `late_checkout_history` after an operator-confirmed approval;
- `operator_confirmed_resolution` after an operator-confirmed incident resolution.

Raw conversations, transcripts, voice files, access secrets, documents, and payment data are not written to lifecycle payloads or guest long-term memory.

## Operator and safety behavior

- unknown guests, wrong reservation/guest binding, and wrong property binding are blocked;
- access instructions require exact identity plus check-in and unit readiness;
- access-like secrets detected by the existing auto-send policy remain blocked;
- late checkout is never auto-approved and unconfirmed outcomes go to an operator;
- active handoff locks route lifecycle replies to the same operator queue;
- urgent incidents create an urgent operator review immediately;
- refunds, money, cancellation consequences, and booking modifications remain outside lifecycle automation;
- global actual-send controls remain disabled unless an approved narrow send scope already exists.

## Migration and deployment order

The already-applied migration `20260809160000_guest_lifecycle_communications_v1.sql` remains unchanged and owns only the durable lifecycle ledger and its original policy.
The additive migration `20260809220000_guest_lifecycle_synthetic_acceptance_cleanup.sql` adds the service-role-only cleanup function for the DB-backed synthetic acceptance. It accepts an exact manifest, validates every synthetic ownership marker, and refuses cleanup if a row could belong to another run. This new migration must be applied before deploying the PR #169 application artifact.

Exact post-merge order:

1. Take the standard production logical backup using the separately approved runbook.
2. Apply all outstanding migrations in numeric order, ending with `20260809220000_guest_lifecycle_synthetic_acceptance_cleanup.sql`; this is a separate owner-approved production mutation.
3. Verify the existing table, unique constraints, indexes, forced RLS, and service-role-only table grants, plus the cleanup RPC's service-role-only execute grant, without reading guest data.
4. Build the exact merged SHA and deploy the application artifact through the VPS/Timeweb production runbook; this is a separate owner-approved production deploy.
5. Verify `/api/health` and `/api/version` report the expected SHA.
6. Keep lifecycle actual-send scopes disabled.
7. Run the synthetic no-external-actions acceptance below.
8. Review the Communication dashboard projection and operator handoff rows.
9. Enable any narrow property/booking send scope only under a separate owner approval and existing rollout limits.

Rollback before actual sends: deploy the previous artifact and leave the additive ledger table in place. Do not drop the migration in production. Disable lifecycle send scopes if any were explicitly enabled.

## Synthetic acceptance

Local deterministic acceptance:

```powershell
npx.cmd tsx scripts/guest-lifecycle-synthetic-acceptance.ts
```

Expected marker: `GUEST_LIFECYCLE_SYNTHETIC_ACCEPTANCE_OK`.

Database-backed isolated acceptance:

```powershell
$env:GUEST_LIFECYCLE_ACCEPTANCE_ENABLED='true'
$env:GUEST_LIFECYCLE_ACCEPTANCE_CONFIRM='RUN ISOLATED GUEST LIFECYCLE SYNTHETIC ACCEPTANCE'
$env:GUEST_LIFECYCLE_ACCEPTANCE_NO_EXTERNAL_ACTIONS='true'
$env:GUEST_LIFECYCLE_ACCEPTANCE_TARGET_ID='<verified-target-id>'
$env:GUEST_LIFECYCLE_ACCEPTANCE_EXPECTED_TARGET_ID='<same-verified-target-id>'
npx.cmd tsx scripts/guest-lifecycle-db-acceptance.ts
```

The runner performs one bounded sequence:

1. Proves the cleanup RPC exists in dry-run mode before creating any fixture.
2. Generates a unique manifest and verifies that its exact IDs are vacant.
3. Creates only its synthetic property, guest/contact/memory profile, reservation, Booking Ops record, legal/physical-readiness fixtures, booking-scoped policies, and a `dry_run_only` send scope.
4. Runs the complete nine-event lifecycle with `dryRun: true` and sender functions that throw if reached.
5. Requires exactly nine `dry_run` delivery rows and verifies the Communication dashboard projection reaches `stay.completed` / `completed`.
6. Replays in the same process and requires all nine events to be duplicates with no row-count growth.
7. Starts a fresh Node process, replays the same manifest, and again requires all nine events to be duplicates with no row-count growth.
8. Calls the manifest-bound cleanup RPC in `finally`, including after a failed assertion.
9. The RPC deletes only rows matching the exact synthetic IDs and markers, then counts every touched table and requires `zeroResidue: true` with `residueCount: 0`.

Expected markers:

- `GUEST_LIFECYCLE_DB_SYNTHETIC_ACCEPTANCE_OK`
- `GUEST_LIFECYCLE_SYNTHETIC_ZERO_RESIDUE_OK`

The technical environment gates do not constitute production approval. Running this against production still requires separate approval for the temporary inserts and exact-manifest cleanup deletes.

Exact production-safe acceptance plan:

1. Prove the target SHA and database identity using the production runbook without printing secret values.
2. Obtain separate approval for the temporary synthetic inserts and exact-manifest cleanup deletes.
3. Run the DB-backed command above with matching verified target IDs; do not alter its generated manifest.
4. Preserve the machine-readable report proving dry-run-only delivery, same-process replay, fresh-process replay, dashboard projection, manifest cleanup, and zero residue.

No real guest reservation, channel-manager call, outbound provider call, refund, payment, secret change, DNS change, or deployment is part of the local acceptance.
