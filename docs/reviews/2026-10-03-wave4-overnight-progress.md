# Wave 4 overnight progress — RU residential PlatformDecision integration

Branch: `sol/wave4-residential-decision-integration-20261003`
Starting HEAD: `aea51a1988f128ac67a024919225a500cea49fa4`
Previous green checkpoint: `305da37ce3958659102b72a7517c27b437182613`
Scope: local RU residential authenticated/server-side reads only.

## Implemented

- Added canonical residential booking scope resolution from `booking_ops_records.id/account_id/property_id`.
- Authenticated account ownership is checked before readiness/status loading and rechecked after the read.
- Single-booking pre-check-in GET now returns advisory `platformDecision` built from the existing canonical readiness snapshot.
- In-stay/checkout GET now returns advisory `in_stay`, `checkout`, and `deposit` decisions from the already-loaded canonical snapshot.
- The same GET maps already-loaded canonical `openIssues` through the existing incident adapter; no extra DB read or guard/recompute call is added.
- Check-in GET now uses pure lifecycle/physical/pre-check-in/check-in readers and returns an advisory `checkin` PlatformDecision without lifecycle initialization, readiness recompute, physical writes, or `checkin_blocked` event writes.
- Pure physical and pre-check-in readers reuse the existing domain compute functions; no second readiness engine was introduced.
- In-stay/checkout GET now also uses a pure persisted-state reader and exposes advisory `closeout`; the existing close-prerequisite calculation is shared between pure GET reads and the mutating command guard.
- `close_booking` is proposed only when pure canonical prerequisites are empty; the POST close command still recomputes legal readiness and revalidates the canonical guard.
- No POST/action route consumes PlatformDecision as authorization.
- `automaticActionAllowed` remains false and `send_guest_automatically` remains forbidden.

## Changed files

- `src/lib/platform/residential-booking-scope.ts`
- `src/lib/platform/__tests__/residential-booking-scope.test.ts`
- `src/app/api/dashboard/booking-ops/pre-checkin/route.ts`
- `src/app/api/dashboard/booking-ops/instay-checkout/route.ts`
- `src/app/api/dashboard/booking-ops/checkin-execution/route.ts`
- `src/app/api/dashboard/booking-ops/__tests__/route.test.ts`
- `src/lib/booking-ops/lifecycle.ts`
- `src/lib/booking-ops/physical-readiness-execution.ts`
- `src/lib/booking-ops/pre-checkin-control-center.ts`
- `src/lib/booking-ops/checkin-execution-autopilot.ts`
- `src/lib/booking-ops/guest-legal-deposit-mvd-execution.ts`
- `src/lib/booking-ops/__tests__/physical-readiness-read.test.ts`
- `src/lib/booking-ops/__tests__/pre-checkin-pure-read.test.ts`
- `src/lib/booking-ops/__tests__/checkin-execution-autopilot.test.ts`
- `src/lib/booking-ops/__tests__/lifecycle.test.ts`
- `src/lib/booking-ops/instay-checkout-autopilot.ts`
- `src/lib/booking-ops/__tests__/instay-checkout-autopilot.test.ts`
- `docs/reviews/2026-10-03-wave4-overnight-progress.md`

## Verification

- Previous focused Wave 4 checkpoint: **137/137 PASS**.
- Incident integration focused contour: **131/131 PASS**.
- Pure check-in integration focused contour: **214/214 PASS**.
- Pure closeout integration focused contour: **167/167 PASS**.
- TypeScript typecheck: **PASS**.
- Changed-file ESLint: **PASS**.
- `git diff --check`: **PASS**.
- Frozen Wave 3 groups, run once at final checkpoint:
  - focused: **164/164 PASS**
  - pilot: **137/137 PASS**
  - location: **110/110 PASS**
  - Wave 2 current contour: **220/220 PASS** across 10 present files
  - safety: **87/87 PASS**
  - additional-frozen: **12/12 PASS**
- Historical Wave 3 verification listed `wave2-final-adversarial.test.ts`; it is absent from this worktree, so it was not silently replaced or recreated.

## Blockers / next step

Current bounded Wave 4 Booking Ops read slice has no failing blocker. Next step: inventory remaining RU residential PlatformDecision adapters/read paths (especially location/communication) and integrate only where canonical authenticated evidence already exists; otherwise stop rather than inventing a new state engine.

No push, merge, deploy, live DB/system, DNS, secret, package-install, or migration actions were performed.
