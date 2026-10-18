# C4 operator UI automatic reads

Source baseline: main 1b874a5aef2f299b03a8525a8879843df83c5ba5.
This source repair is not deployed and is not a physical acceptance receipt.

## Confirmed defect and repair

Opening a booking loaded GET endpoints that initialized or recomputed persisted
state. That could change the evidence being inspected, even without an explicit
operator action. Existing POST/PATCH actions and their authorization remain intact.

| GET path under /api/dashboard | Previous side effect | Read path |
| --- | --- | --- |
| booking-ops/[id]/lifecycle | synchronize and initialize gates | existing readLifecycleStatus, scope before and after |
| booking-ops/guest-intake-release | create session, legal and physical prerequisites | readGuestIntakeReleaseSnapshot |
| booking-ops/checkin-release | same snapshot initialization | same pure reader |
| booking-ops/legal-payment | initialize lifecycle twice | readLegalPaymentStatus |
| booking-ops/pre-checkin (list) | recompute legal/physical state for each booking | existing readPreCheckinStatus, scope recheck |
| guest-legal/explain | recompute persisted legal readiness | existing readiness with scope recheck |
| guest-legal/status | recompute persisted legal readiness | existing readiness plus event list, scope recheck |
| booking-ops/lifecycle-orchestrator | initialize absent orchestrator | existing snapshot with initialize=false |

The two aggregate readers reuse existing SELECT seams. Missing intake or its
prerequisites returns a failed read; absent lifecycle remains null/not initialized.
No missing rows, successful gates, readiness, or historical evidence are fabricated.
Explicit initialization remains an operator mutation and needs its existing gate.

## Safe demonstration boundaries

- Consumed writer 39127850376 is failed/BLOCK, write outcome UNKNOWN.
- No repeat writer, fixture reuse, cleanup, live login or new staging writes.
- Fresh retained roots exist in the writer log, but booking/intake IDs and counts
  need the separately prepared protected read-only reconciliation.
- Deployed G0 d912aec6663de90e5ca4293cc5a69e2e0ed9ff94 is not changed by this PR.
- Login still calls ensureAccountForUser. A live login is not a read-only probe.
- This focused repair does not certify all UI routes or independent egress safety.
- Current operator admission and no-send configuration require the protected host
  configuration reader; provider/network evidence is a separate acceptance item.
- A safe future demonstration must bind reconciled IDs, deployed SHA, operator
  scope and no-send proof before entering the authorized UI scenario.

## Validation contract

Focused local tests cover aggregate SELECT-only behavior, missing state, ownership
drift, canonical scope, unauthenticated/foreign requests and the unchanged explicit
lifecycle mutation path. Existing route mocks are updated to the new read exports.
Typecheck, touched-file ESLint, diff checks and exact-head CI/CodeRabbit are required.
No external database, SSH, message provider, payment or live UI request is part of
these local tests.
