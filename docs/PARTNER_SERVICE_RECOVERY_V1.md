# Partner Service Recovery Loop v1

## Product flow

Guest Problem → ASI Detection → Action/Handoff → Operational Resolution → Guest Follow-up → Guest Confirmation → Recovery Outcome.

The v1 loop prevents a maintenance report from disappearing after an operator says that work is complete. A `maintenance_issue` decision opens one tenant-scoped `partner_service_recovery_cases` row. Operational updates move that row through `open`, `in_progress`, and `awaiting_guest_confirmation`. Only an explicit guest outcome moves it to `recovered` or `unrecovered`.

**Operationally resolved and guest recovered are different states.** `operation.updated` with `resolved` prepares a follow-up and leaves the case at `awaiting_guest_confirmation`. It does not close the guest issue. `guest.resolution.confirmed` with `satisfied: true` is the only v1 transition to `recovered`; `satisfied: false` produces `unrecovered` and keeps an operator required.

## Authenticated event boundary

`POST /api/partner/v1/communication/events` accepts a strict discriminated union:

- `guest.message.received` retains the existing Partner Communication Contract v1 shape.
- `operation.updated` requires the existing partner/property/booking/conversation identity, an opaque `actionRef`, and `requested | in_progress | resolved | blocked`.
- `guest.resolution.confirmed` requires the same identity, an opaque `recoveryRef`, and a `satisfied` boolean.

Recovery events use an adjacent durable inbox because the original inbox deliberately has message-only non-null fields. This avoids dummy guest messages while preserving authentication, canonical mapping checks, bounded normalization, tenant isolation, event replay semantics, and the existing endpoint.

The unique event identity is `(account_id, partner_id, external_partner_account_id, external_event_id)`. The normalized fingerprint distinguishes exact replay from a changed payload. Database uniqueness chooses one concurrent writer; the stored response is reused by exact replay. Changed content for the same identity fails with `partner_event_conflict`.

## Opaque references

`PartnerOperationalActionV1.actionId` now means the stable partner-facing action reference, not `partner_communication_actions.id`. It has the form `pact_<high-entropy random value>`. Recovery cases expose `prec_<high-entropy random value>` as `recoveryRef`. Neither reference encodes an account, property, booking, session, or database row ID. Internal UUIDs remain server-only.

## State and follow-up rules

| Input | Allowed recovery source state | Result |
| --- | --- | --- |
| operation `requested` | `open` | remains `open` |
| operation `in_progress` | `open`, `in_progress` | `in_progress`; set `work_started_at` once |
| operation `resolved` | `open`, `in_progress`, `awaiting_guest_confirmation` | `awaiting_guest_confirmation`; set resolution timestamps and one deterministic follow-up |
| operation `blocked` | `open`, `in_progress` | remains unresolved; action blocked; operator required |
| confirmation `satisfied: true` | `awaiting_guest_confirmation` | `recovered`, outcome `satisfied`, handoff resolved where present |
| confirmation `satisfied: false` | `awaiting_guest_confirmation` | `unrecovered`, outcome `not_satisfied`, active handoff reused/created, operator required |

Terminal cases do not silently reopen. Backward, stale, cross-tenant, wrong-reference, and conflicting transitions fail closed.

For the synthetic heating complaint, operational resolution stores exactly:

> Удалось решить проблему с отоплением. Подскажите, пожалуйста, сейчас всё в порядке?

The recommendation is deterministic and bounded. It contains no compensation promise, review request, review manipulation, or internal state. It is persisted only; it is never sent.

## Metrics foundation

The server-only `deriveRecoveryMetrics` helper derives, when timestamps exist:

- `resolutionLatencyMs`: complaint/opened time to operational resolution;
- `confirmationLatencyMs`: operational resolution to guest confirmation;
- `totalRecoveryLatencyMs`: complaint/opened time to guest confirmation.

The timestamps and terminal outcome also support later recovered/unrecovered pilot reporting without adding a review-specific table.

## Explicit boundaries

- No outbound messages or provider callback.
- No real Apart Sharing adapter.
- No Review Engine or review ingestion/reply.
- No automatic refund, discount, compensation, cancellation, or booking modification.
- No review manipulation.
- All partner references are opaque.
- All tenant authority and canonical property/booking bindings remain server-side.
- The additive migration is not applied persistently by this task.
