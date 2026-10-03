# Wave 4 overnight progress — RU residential PlatformDecision integration

Branch: `sol/wave4-residential-decision-integration-20261003`
Starting HEAD: `aea51a1988f128ac67a024919225a500cea49fa4`
Previous green checkpoint: `ec7821242d86e33b957ab86e83d42cdf1681c3f0`
Scope: local RU residential authenticated/server-side reads only.

## Implemented

- Added canonical residential booking scope resolution from `booking_ops_records.id/account_id/property_id`.
- Authenticated account ownership is checked before readiness/status loading and rechecked after the read.
- Single-booking pre-check-in GET now returns advisory `platformDecision` built from the existing canonical readiness snapshot.
- In-stay/checkout GET now returns advisory `in_stay`, `checkout`, and `deposit` decisions from the already-loaded canonical snapshot.
- The same GET now maps already-loaded canonical `openIssues` through the existing incident adapter; no extra DB read or guard/recompute call is added.
- Existing readiness/status engines remain authoritative; no second readiness engine was introduced.
- No POST/action route consumes PlatformDecision as authorization.
- `automaticActionAllowed` remains false and `send_guest_automatically` remains forbidden.
- Check-in and closeout decisions were intentionally not wired: their current prerequisite/guard seams can recompute or write state.

## Changed files

- `src/lib/platform/residential-booking-scope.ts`
- `src/lib/platform/__tests__/residential-booking-scope.test.ts`
- `src/app/api/dashboard/booking-ops/pre-checkin/route.ts`
- `src/app/api/dashboard/booking-ops/instay-checkout/route.ts`
- `src/app/api/dashboard/booking-ops/__tests__/route.test.ts`
- `docs/reviews/2026-10-03-wave4-overnight-progress.md`

## Verification

- Previous focused Wave 4 checkpoint: **137/137 PASS**.
- Incident integration focused contour: **131/131 PASS**.
- TypeScript typecheck: **PASS**.
- Changed-file ESLint: **PASS**.
- `git diff --check`: **PASS**.
- Frozen Wave 3 groups, run once at final checkpoint:
  - focused: **162/162 PASS**
  - pilot: **135/135 PASS**
  - location: **110/110 PASS**
  - Wave 2 current contour: **220/220 PASS** across 10 present files
  - safety: **87/87 PASS**
  - additional-frozen: **12/12 PASS**
- Historical Wave 3 verification listed `wave2-final-adversarial.test.ts`; it is absent from this worktree, so it was not silently replaced or recreated.

## Blockers / next step

Current bounded Wave 4 slice has no failing blocker. Further check-in integration should first expose a pure read-only legal/readiness seam; closeout should first expose a pure read-only prerequisite seam. Until then, keep both out of PlatformDecision read integration rather than triggering stateful guards from GETs.

No push, merge, deploy, live DB/system, DNS, secret, package-install, or migration actions were performed.
