# Wave 5 — RU residential location runtime

Branch: `sol/wave5-residential-location-runtime-20261003`
Starting HEAD: `520eb93731e294162882f3f4439d54bcae892965`
Inbound-intake checkpoint: `449ae1f2fe56a39dc9eecebd9e41bf799faecb1a` (built from `8826c5b25d2527e77563cc51efa8a1b48a0e84a8`).
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
- Inbound intake, reservation, and availability tenant-boundary follow-ups are recorded in the dedicated sections below.

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

## Inbound intake account isolation

- Dashboard intake events/status/process now resolve the authenticated Booking Ops account through the shared access helper.
- Dashboard processing passes a server-owned `accountId`; request-body account identity is never authoritative.
- Referenced dashboard property targets and duplicate booking targets are canonical-access checked before processing.
- `booking_inbound_intake_events` gains prepared account lineage and account-local idempotency (`account_scope_key + idempotency_key`); the migration is contract-tested only and was not applied.
- Account-scoped guest/booking matching cannot reuse another tenant's Booking Ops record; duplicate retries are isolated per account.
- Attach/duplicate flows revalidate the linked booking account before any mutation, so a stale/corrupt intake event cannot mutate a foreign booking before the post-action check.
- Public web intake remains unbound and cannot supply authoritative account/property/booking fields. Channel Manager intake keeps its existing canonical account/property contour.
- Changed files for this slice: dashboard intake routes/tests, `real-booking-intake-autopilot.ts` and tests, Channel Manager isolation harness, and `20261003141500_booking_inbound_intake_account_scope_v1.sql`.
- Verification: focused inbound/CM contour **34/34 PASS**; broader Booking Ops + Channel Manager contour **120/120 PASS**; TypeScript **PASS**; changed-file ESLint **PASS**; `git diff --check` **PASS**.
- Remaining blocker/next step: the secret-backed internal Telegram intake and older accountless callers still lack a canonical server-owned account resolver. Do not trust an account/property from their payloads; the smallest safe next step is to bind those callers to an existing canonical account source or keep them unbound/fail-closed for cross-tenant matching.

## Canonical reservation account isolation

- Dashboard reservation mutations now resolve the authenticated Booking Ops account through the shared access helper.
- Create, availability, and block actions require canonical property access; cancellation requires canonical booking access before domain execution.
- Direct reservation intake carries the server-owned account into `processInboundBookingRequest` before booking creation instead of assigning ownership afterward.
- Intake idempotency and source-link reuse are account-scoped and reused booking IDs are revalidated against the same account.
- Post-intake booking and availability-hold mutations include the canonical account predicate.
- Changed files: dashboard reservations route + scope tests, reservation ledger + account-scope contract test.
- Verification: focused reservation/intake contour **34/34 PASS**; broader Booking Ops + Channel Manager + reservation contour **136/136 PASS**; TypeScript **PASS**; changed-file ESLint **PASS**; `git diff --check` **PASS**.
- The next audited gap was the availability/overbooking contour; it is covered by the checkpoint below.

## Availability / overbooking account isolation

- Baseline HEAD before this slice: `75a21784dc031c6b31d3ef1694374ea8103e877d`.
- Availability action/status/conflicts/explain routes now resolve canonical account/property/booking scope through the shared Booking Ops access helper.
- Hold/block release and hold confirmation derive authorization from the stored target entity, not request-supplied property scope; execution revalidates canonical account plus expected property/setup scope.
- Conflict checks, holds, blocks, status reads, risk updates, and intake-created holds carry canonical account lineage. Existing unbound lower-level callers remain compatible but do not gain tenant authority from payload data.
- Prepared `20261003150000_booking_availability_account_scope_v1.sql` adds conflict-check account lineage and an account-bound atomic hold RPC; it was contract-tested only and not applied.
- Changed files: four dashboard availability routes, shared Booking Ops access helper, availability runtime/tests, intake availability initialization, route/access tests, and the prepared migration.
- Verification: focused availability contour **52/52 PASS**; frozen Booking Ops + Channel Manager + reservation regression **136/136 PASS**; TypeScript **PASS**; changed-file ESLint **PASS**; `git diff --check` **PASS**.
- Committed locally as `dadd3d4b` (`fix(booking-ops): isolate availability scope by account`); no push, deploy, or migration apply was performed.

## Availability internal caller hardening

- Baseline HEAD: `dadd3d4ba0ddcd740a7e345f1930be5b07035810`.
- Auto-send enqueue/execution now pass the server-resolved booking account into the availability communication guard; confirmation-like messages fail closed on account mismatch.
- Channel-import availability now derives canonical scope from `connection -> property setup -> property -> account`, rejects imported mappings outside that property, and evaluates conflicts with the canonical account.
- Changed files: availability runtime/test, auto-send executor, plus two Channel Manager fixtures updated with canonical property ownership.
- Verification: focused availability + auto-send contour **49/49 PASS**; frozen Booking Ops + Channel Manager + reservation regression **136/136 PASS**; TypeScript **PASS**; changed-file ESLint **PASS**; `git diff --check` **PASS**.
- Smallest safe next step: the unused accountless availability summary/confirmation helpers can take the same server-owned account seam if activated. Secret-backed Telegram intake still has no canonical account resolver and must remain unbound/fail-closed rather than trusting payload scope.

## Operational boundary

Wave 5 migration files are prepared and contract-tested but were **not applied to any live/local database** in this pass. No push, merge, deploy, live database mutation, DNS, secret, or package-install action was performed.
