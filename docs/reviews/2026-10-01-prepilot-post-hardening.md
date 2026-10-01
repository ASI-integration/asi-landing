# ASI first-pilot post-hardening packet — 2026-10-01

Historical source audit:
- `docs/reviews/2026-10-01-prepilot-audit.json`
- audited candidate: `5cc9b00681c23042cbcdb14fd6492be234732570`
- historical verdict: PRE-PILOT BLOCK

That audit is intentionally preserved as historical evidence. Its activation-readiness finding is superseded by the local hardening commits listed below and must not be read as the current candidate verdict without re-review.

## Candidate range for independent review

Base:
`35c6b9eccb65f4f93400a3f06951b4ef1ae32159`

Current code candidate after the pre-Astra hardening pass:
`15d66561`

Key commits after the audit:
- `d82459de` — gate pilot activation on operational readiness
- `ff0d2e0c` — bind readiness to canonical first-pilot property
- `4e7304a7` — expose canonical operator commercial-pilot launch controls
- `2356e4e8` — recheck readiness immediately before commercial start
- `1add19f4` — expose operator commercial-pilot completion control
- `f8ea9465` — surface critical pre-check-in load failures
- `6e0f5b16` — require actual deposit resolution before booking close
- `ecacff05` — enforce first-pilot safety regression in PR validation
- `15d66561` — allow explicit operator-assisted/manual booking intake without pretending live channel sync

No push, merge, deploy, production/staging DB action, external send, payment mutation, DNS change, or live-provider write was performed for this packet.

## Current first-pilot safety contour

### Activation and canonical identity

Owner activation no longer treats questionnaire completion as sufficient operational readiness.

The server computes machine-readable operational readiness and fails closed when:
- no canonical persisted property exists,
- the RU connect canonical first-pilot property is not the owned persisted object,
- canonical pilot-readiness data cannot be loaded,
- required property/operator readiness is absent,
- automatic messaging is requested without runtime proof.

Operator-assisted pilot mode is explicit and can remain manual for the first pilot.

### Commercial 14-day pilot

The canonical commercial lifecycle remains the SSOT for the 14-day clock.

Verified behavior:
- setup does not consume pilot time,
- start before readiness is blocked,
- readiness is rechecked at `start_pilot`,
- stale prior `ready` cannot start a pilot,
- entitlement reuse is blocked,
- retry does not restart the clock,
- concurrent starts keep one winning timestamp,
- completion before day 14 is blocked,
- completion is idempotent,
- restart after completion is rejected,
- account identity is derived server-side from the canonical property,
- forged account/property mismatch is rejected.

CRM exposes operator/admin controls for readiness derivation, 14-day start, status/end date, and completion. These actions call the canonical lifecycle service rather than setting UI-only state.

### Booking / pre-check-in / access safety

Operator UI exposes:
- guest-data release,
- legal/document/deposit/MVD state,
- physical readiness,
- pre-check-in blockers,
- check-in execution,
- operator alerts,
- maintenance exceptions,
- manual fallback actions.

Critical panel-load failures are now visible. A missing panel is not presented as successful/empty readiness.

Pre-check-in tests cover missing/rejected documents, contract/deposit exceptions, MVD submission, cleaning/linen/inspection, maintenance, physical readiness, check-in instructions, access issues, and operator escalation.

### Checkout / closeout

A booking can no longer close merely because deposit return is *prepared*.

For a required deposit, closeout now requires actual deposit resolution:
- `depositIntakeStatus === 'returned'`, or
- execution state explicitly `returned` / `waived`.

`deposit_return_ready` alone is insufficient to close the booking.

## Manual channel-manager fallback

The first pilot has an explicit honest manual fallback.

Verified contracts include:
- manual snapshot import for objects/bookings/calendar/pricing,
- safe credential reference instead of raw secrets,
- idempotent imported-booking intake,
- conflict surfacing,
- placeholder providers fail safely,
- provider-labelled connections may use manual fallback without claiming a real API,
- manual snapshot reconciliation remains available.

Focused channel/auto-send/checkout pass:
- 9 test files
- 159 tests PASS

## Auto-send boundary

The repository already has a canonical auto-send runtime with:
- global guard,
- emergency stop,
- explicit owner/property/booking/pilot scopes,
- safe channel/message allowlists,
- dry-run-only scope mode,
- duplicate-delivery prevention,
- retry/failure recording,
- access-code/document/payment-secret blocking,
- operator-review and unresolved-complaint blocking.

Current intentional first-pilot boundary:

**Ops v17 automatic activation is still fail-closed.**

The onboarding readiness evaluator does not yet treat its own boolean as proof of live auto-send readiness. Automatic mode remains blocked until activation is wired to the canonical auto-send operational status and a specific canonical pilot/property scope.

Minimum conditions for a future automatic-ready check should be derived from the real runtime, not an onboarding checkbox:
1. global guard row exists;
2. global emergency stop is false;
3. canonical property/pilot scope resolves;
4. scope has `actualSendEnabled=true`;
5. scope is not `dryRunOnly`;
6. safe channel/message allowlists are non-empty;
7. required sender/runtime health is available;
8. failed delivery state does not masquerade as readiness.

For the first real pilot, operator-assisted messaging remains the safe supported mode. This is not a pilot blocker.

## Observability / recovery

Verified locally:
- operator alerts and actions,
- recovery acceptance,
- duplicate outbound suppression,
- persistence fail-closed behavior,
- booking lifecycle recovery,
- critical UI panel-load failure visibility.

The booking UI now explicitly warns operators not to interpret an unavailable panel as readiness.

## Cross-tenant regression sweep

Focused tenancy/security sweep:
- 12 test files
- 79 tests PASS

Covered:
- owner/manager/operator role boundary,
- bootstrap tenancy isolation,
- canonical activation property/account,
- commercial pilot property/account binding,
- channel-manager create-path isolation,
- expected account scope,
- operator-review tenant isolation,
- guest-memory tenant isolation,
- legacy unbound review fail-closed behavior.

## CI gap closed

PR validation now includes a dedicated first-pilot regression step covering:
- Ops v17 owner route,
- owner-role adversarial boundary,
- activation readiness,
- bootstrap tenancy,
- RU commercial-pilot API,
- commercial lifecycle,
- pre-check-in readiness,
- check-in execution,
- in-stay / checkout closeout.

Local execution of that exact CI set:
- 9 test files
- 82 tests PASS

## Wider local evidence

Broad pre-pilot contour executed earlier in the same candidate line:
- 26 test files
- 236 tests PASS

Pre-check-in / operator / observability contour:
- 17 test files
- 177 tests PASS

Cross-tenant contour:
- 12 test files
- 79 tests PASS

Channel fallback + auto-send + checkout contour:
- 9 test files
- 159 tests PASS

Typecheck and changed-file ESLint were green for the relevant hardening commits. `git diff --check` was also green.

These are local/focused proofs, not a claim that all repository or live-environment acceptance has been completed.

## Explicit non-blocking manual/future boundaries

Can remain manual for first pilot:
- operator-assisted guest messaging,
- unidentified booking resolution,
- document review,
- access exceptions,
- physical inspection,
- deposit/refund confirmation,
- final post-pilot report preparation.

Known future work that does not block the first residential STR pilot:
- `report_ready` transition automation,
- Finance/Ledger v2,
- autonomous pricing,
- Commercial Location,
- broader international workflows,
- advanced cross-module decision engine.

The CRM text intentionally says the final report is operator-generated after pilot completion; it does not claim `report_ready` is automated.

## Recommended Astra task

Review the full range:

`35c6b9ec..15d66561`

Primary question:

> Can a real first RU residential STR pilot still enter an active or closed state while a required operational dependency, tenant boundary, commercial-pilot clock condition, access/check-in safety gate, or actual deposit-return condition is false or unavailable?

Attack specifically:
- questionnaire vs runtime readiness,
- stale readiness between derive/start,
- canonical RU-connect property identity,
- operator-assisted/manual boundaries,
- commercial start/complete races,
- account/property forgery,
- auto-send scope boundary,
- failed readiness lookups,
- pre-check-in panel failures,
- access release,
- deposit-return vs “ready to return” semantics,
- booking closeout,
- operator handoff/resume,
- cross-tenant reads/writes.

Do not spend the run re-implementing:
- Finance/Ledger,
- autonomous pricing,
- Commercial Location,
- international flows,
- report automation.

Ask Astra to classify only confirmed first-pilot blockers as P0/P1, prove them with focused tests, fix at most the highest-impact bounded issues locally, and avoid push/merge/deploy/live external actions.
