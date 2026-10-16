# G0 remediation — narrow supervised, no-send acceptance

Baseline: PR465 b1f7a110e6ab6234af198166e2a6608e89aeb57f. Prior Linux evidence 38868553610 remains 32 PASS / 1 FAIL / 3 BLOCK. This follow-up is a delta acceptance, not a full repeated suite or a deployment.

## Role contract

Owners are not central CRM staff. Global CRM requires an explicit allowlist in EVERY environment; no domain fallback. The manual pilot's Booking Ops / private knowledge routes remain staff-only and retain account/property checks. Owners cannot use those operational routes yet. No inferred ownership of legacy contacts. Staff access produces a structured actor-ID audit log; deployed log retention is an operational gate.

## Intake recovery

The existing unique account/key receipt still owns first-write admission. Before any matched-record mutation or new booking insert, it stores the exact reserved booking UUID in automation metadata. This is a reservation, not a claim of a committed booking. The status reader checks canonical account/property and only reports a found booking as confirmed. Interrupted parent/child writes stay durable manual HOLD, including after restart and force/retry; no automatic replay or lease takeover. Inspect the exact receipt and booking's events/intents before manual reconciliation. No automatic resume is implemented or claimed.

## Operator control

New append-only SQL migration adds monotonic alert revision and durable booking automation_paused. ACK checks membership, booking/property ownership, current revision and open state inside one transaction; membership revocation serializes against ACK. ACK atomically pauses automation. Changed acknowledged incidents reopen and invalidate old revisions. Old clients without a revision fail closed. No automatic resume or timeout clears takeover.

New worker starts and each booking-automation loop iteration consult pause; system lifecycle events also consult it. Explicit operator events retain mandatory prerequisite handling. Already executing operations are NOT transactionally cancelled by this change: supervised operation must drain in-flight workers before takeover is considered quiescent. No claim of global atomic cancellation, automatic owner workflow or live scheduler readiness.

## External effects

A one-way ASI_SYNTHETIC_NO_SEND=YES interlock denies and counts calls at email, Telegram adapter, guest voice, payment factory and Stripe/YooKassa payment boundaries. Seven positive canaries are recorded separately, proving denial before provider access. Scenario calls must remain zero. Native lab additionally denies network egress and exposes no production credentials. Other provider surfaces outside the tested Booking Ops contour are not certified. Live atomic quota PR423/424 remains outside this no-send pilot.

## Evidence and rollback

The updated harness uses real password sessions, Next production build, PostgREST and PostgreSQL17 on a fresh internal Docker network in a GitHub-hosted runner. Crash injections kill the actual Next process only after the database committed the parent/child write. Acceptance verifies counts and exact lineage across restart. Fixture cleanup and image/source hashes are retained in artifacts.

Migration is applied only inside the disposable database. No local/shared/production migration, deployment, merge or external messages. Rollback before deployment is discard this unmerged draft; no production rollback was needed. For future rollout, backup and compatibility review are required; reverting application code alone does not undo database columns/functions.

All gate statuses remain provisional until exact-head CI and independent acceptance. A passing delta suite does not remove the documented in-flight takeover limitation or establish deployed readiness.
