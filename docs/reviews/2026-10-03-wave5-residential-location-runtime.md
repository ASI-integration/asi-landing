# Wave 5 — RU residential location runtime

Branch: `sol/wave5-residential-location-runtime-20261003`
Starting HEAD: `520eb93731e294162882f3f4439d54bcae892965`
Latest committed baseline before the final auto-send scope slice: `e08fa16ab34ee7405d061be61c3ad99b4bdc9b9c`.
Scope: canonical property-bound residential location evidence and advisory PlatformDecision reads.

## Implemented

- Added a dedicated server-owned `residential_property_spatial_snapshots` contract keyed by canonical `account_id + property_id`.
- Public address caches and location-report snapshots are not reused as canonical property truth.
- Added a pure read seam for persisted property SpatialValidation snapshots.
- Spatial snapshot freshness uses Wave 1's 24-hour evidence window rather than the generic 60-second operational window.
- Added authenticated Booking Ops location GET:
  - resolves booking account/property ownership before the read;
  - reads only the persisted property snapshot;
  - rechecks booking identity after the read;
  - returns an advisory residential `location` PlatformDecision.
- Added ops-admin-only location refresh:
  - reads the canonical property address from `properties`;
  - geocodes through the existing RU address pipeline;
  - fetches existing OSM spatial evidence;
  - validates through the existing Wave 1 spatial validator;
  - rereads canonical property location after provider awaits;
  - refuses to persist if ownership/address state changed;
  - persists only account/property-scoped SpatialValidation.
- Provider refresh forces `bypassMemoryCache: true`; process-local OSM cache entries without original observation timestamps cannot be relabeled as fresh evidence.
- Existing public/demo location routes were not modified into property-scoped truth sources.
- Existing PlatformDecision execution semantics remain advisory-only:
  `automaticActionAllowed=false`, `executionAuthority=domain_revalidation_required`.
- Hardened a legacy migration-order test so it no longer assumes a September migration must remain the newest migration forever.

## Files

- `supabase/migrations/20261003093000_residential_property_spatial_snapshots_v1.sql`
- `src/lib/location/residential-property-spatial-runtime.ts`
- `src/app/api/dashboard/booking-ops/[id]/location/route.ts`
- `src/lib/location/overpass.ts`
- `src/lib/platform/snapshot.ts`
- `src/lib/platform/location-decision.ts`
- `src/lib/location/__tests__/residential-property-spatial-runtime.test.ts`
- `src/lib/location/__tests__/residential-property-spatial-migration.test.ts`
- `src/app/api/dashboard/booking-ops/__tests__/location-platform-route.test.ts`
- `src/lib/platform/__tests__/adapters.test.ts`
- `src/lib/communication/__tests__/guest-long-term-memory-v1.test.ts`
- `src/app/api/dashboard/booking-ops/pre-checkin/recompute/route.ts`
- `src/app/api/dashboard/booking-ops/checkin-execution/route.ts`
- `src/app/api/dashboard/booking-ops/instay-checkout/route.ts`
- `src/app/api/dashboard/booking-ops/legal-payment/route.ts`
- `src/app/api/dashboard/booking-ops/[id]/confirm-action/route.ts`
- `src/app/api/dashboard/booking-ops/__tests__/route.test.ts`
- `src/app/api/dashboard/booking-ops/__tests__/confirm-action-scope.test.ts`

## Runtime action boundary

- Pre-check-in recompute/actions now resolve canonical account/property ownership before any domain mutation and return a post-action advisory `pre_checkin` decision.
- Check-in actions now enforce account/property ownership before mutation and return a fresh advisory `checkin` decision after the domain action and lifecycle emission.
- In-stay/checkout actions now enforce account/property ownership before mutation and return fresh advisory `in_stay`, `checkout`, `deposit`, `closeout`, and incident decisions after the domain action.
- Legal/payment GET and POST paths are account-scoped before their domain reads/mutations. No artificial legal PlatformDecision topic was introduced.
- The legacy `[id]/confirm-action` mutation route is now account/property-scoped before it can call the action-template update engine.
- PlatformDecision remains a projection, not authorization. Existing domain guards/revalidation execute first.
- A failure in post-action Decision projection never turns an already-successful mutation into an HTTP failure, avoiding unsafe client retries. Projection instead fails closed to `unavailable`.
- If booking identity changes between mutation and projection, the successful command response carries a `state_changed` unavailable decision rather than stale permissions.
- Runtime-focused contour: **202/202 PASS**.

## Verification

- Wave 5 focused contour: **168/168 PASS**.
- TypeScript typecheck: **PASS**.
- Changed-file ESLint: **PASS**.
- `git diff --check`: **PASS**.
- Frozen regression contours:
  - focused: **165/165 PASS**
  - pilot: **137/137 PASS**
  - location: **110/110 PASS**
  - Wave 2 current contour: **225/225 PASS**
  - safety: **87/87 PASS**
  - additional: **12/12 PASS**

## Booking Ops tenant runtime boundary

- Added shared account/property/booking route-access helpers backed by canonical reservation/account resolution and canonical `booking_ops_records.account_id + property_id` identity.
- Account-scoped Booking Ops list/create now binds reads and creates to the authenticated workspace; property assignment is revalidated server-side before create.
- Existing per-booking dashboard routes for lifecycle, recompute, tasks, events, Telegram drafts, worker links, communications, and per-intent auto-send controls now reject foreign bookings before domain reads or mutations.
- Check-in release and guest-intake release now enforce the same booking/account boundary.
- Lifecycle Orchestrator GET/POST now resolves canonical booking scope before reads, overrides, escalations, or orchestration.
- Lifecycle Orchestrator due-batch now filters `booking_ops_records` by the authenticated account instead of scanning all tenants.
- Root auto-send queue/execute/dry-run paths now resolve the authenticated account, filter batch candidates by canonical `booking_ops_records.account_id`, require intent/delivery-to-booking access for direct operations, and recheck account ownership inside enqueue/execution before any delivery mutation or provider call.
- Guest actual-send remains hard-blocked by the existing `knowledge_operator_review_required` guard even when a narrow send scope is enabled.
- Auto-send scopes, runs, deliveries, queue/status APIs, and the internal scheduled runner are now account-explicit end to end. The prepared migration adds canonical `account_id` lineage, changes scope uniqueness to `account + type + ref`, and disables legacy non-global scopes before deterministic backfill.
- Booking/property send scopes require canonical account ownership. Legacy free-form owner/pilot scopes are fail-closed in the RU residential dashboard until they have their own canonical ownership seam; the UI exposes only booking/property scopes.
- The global emergency-stop intentionally remains a platform-admin kill switch and is not tenant-scoped.
- Inbound-intake root APIs remain the next tenant-boundary audit target.

## Additional verification

- Booking Ops focused route contour: **34/34 PASS**.
- Lifecycle Orchestrator route contour: **5/5 PASS**.
- Final auto-send account-scope focused contour: **53/53 PASS** across executor, policy, scope isolation, API access, route wiring, scheduled-runner, and migration-contract tests.
- TypeScript typecheck after tenant hardening: **PASS**.
- Booking Ops / route-access ESLint: **PASS**.
- `git diff --check`: **PASS**.

## Auto-send account isolation

- Added `supabase/migrations/20261003124500_booking_ops_auto_send_account_scope_v1.sql` (prepared and contract-tested only; not applied).
- `booking_ops_communication_auto_send_scopes`, runs, and deliveries gain canonical account lineage.
- Existing non-global scopes are disabled before backfill. Booking/property scopes are backfilled only when ownership resolves to exactly one canonical account; ambiguous/free-form legacy scopes remain disabled.
- Delivery lineage is backfilled through communication intent -> booking record ownership.
- Scope uniqueness becomes `account_scope_key + scope_type + scope_ref_key`, preventing cross-tenant collisions on identical external booking/property references.
- Operational status filters scopes/runs/delivery counts to the authenticated account while still surfacing the global emergency stop.
- Actual execution checks both delivery account lineage and the canonical booking record before any provider call.
- Internal scheduled auto-send now requires an explicit UUID `accountId`; there is no global cross-tenant scheduled batch.
- PlatformDecision semantics are unchanged; auto-send remains governed by its independent fail-closed policy and domain ownership checks.

## Operational boundary

The migration file is prepared and contract-tested but was **not applied to any live/local database** in this pass. No push, merge, deploy, live database mutation, DNS, secret, or package-install action was performed.
