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
- Smallest safe next step: the unused accountless availability summary/confirmation helpers can take the same server-owned account seam if activated.

## Accountless intake fail-closed matching

- Baseline HEAD: `fbd22c4a256009f960a79cb64f5ccf7ea1a10954`.
- Intake without a server-owned account or Channel Manager contour can create an unbound review item, but it cannot match/reuse an existing booking by contact or booking reference.
- Accountless duplicate-event, duplicate-target, and attach paths revalidate the linked booking and reject tenant-owned records; stale legacy unbound events cannot bridge into another account.
- Owner Telegram session object IDs remain local `OBJ-*` references, not canonical property authority; no account is inferred from payload/session labels.
- Verification: focused intake/owner-Telegram contour **32/32 PASS**; frozen Booking Ops + Channel Manager + reservation + owner-Telegram regression **142/142 PASS**; TypeScript **PASS**; changed-file ESLint **PASS**; `git diff --check` **PASS**.
- Smallest safe next step for Telegram: add a server-owned owner-Telegram session -> canonical property/account binding before allowing tenant matching. Until then, both secret-backed and owner-session Telegram intake remain unbound/fail-closed.

## Pre-checkin list account isolation

- Baseline HEAD: `761d17f2c55cb0a92a24971fe01fae894866f4e3`.
- The dashboard pre-checkin list now resolves the authenticated reservation account before listing and rejects the legacy/unresolved workspace path.
- `listBookingsByReadinessStatus` now requires `accountId` and passes it to `listBookingOpsRecords`, so the list query cannot silently fall back to a cross-tenant scan.
- Individual booking reads keep canonical booking identity checks and PlatformDecision remains advisory only.
- Verification: focused pre-checkin route/read contour **40/40 PASS**; frozen Booking Ops + Channel Manager + reservation + owner-Telegram + pre-checkin regression **156/156 PASS**; TypeScript **PASS**; changed-file ESLint **PASS**; `git diff --check` **PASS**.
- Next step: continue the remaining dashboard Booking Ops list/read route audit; do not add tenant authority where only payload/session labels exist.

## Confirm-action mutation TOCTOU hardening

- Baseline HEAD: `a499a5195bc40bb271612820b5dc218e0020225b`.
- The confirm-action route now carries the canonical booking account/property identity into the domain action engine instead of using the route check as the sole mutation authorization.
- `applyBookingOpsOperatorAction` verifies the loaded record against expected account/property and passes the same expected scope into `updateBookingOpsRecord`; the repository performs scoped SELECT and scoped UPDATE and returns `scope_mismatch` if ownership changes before mutation.
- PlatformDecision is not involved in execution authorization; domain scope/revalidation remains authoritative.
- Verification: focused route/action/repository scope contour **9/9 PASS**; route mock-isolation pair **31/31 PASS**; frozen Booking Ops + Channel Manager + reservation + pre-checkin/action regression **162/162 PASS**; TypeScript **PASS**; changed-file ESLint **PASS**; `git diff --check` **PASS**.
- Next step: audit other dashboard mutation handlers for route-only ownership checks followed by unscoped domain updates, prioritizing check-in/in-stay/pre-checkin actions.

## Check-in / in-stay / pre-checkin mutation scope revalidation

- Baseline HEAD: `101b72cbe103373a62fd35550fec51b5091999a3`.
- Check-in, in-stay/checkout, and pre-checkin mutation routes now use the shared Booking Ops API access helper and pass canonical account/property scope into the domain mutation layer.
- Domain entry points revalidate the booking scope before mutation; main Booking Ops record updates and task-sync reads carry the same expected scope instead of relying on the route check alone.
- Lifecycle event emission and checkout turnover-cleaning activation revalidate canonical scope before creating downstream side effects. Pre-checkin recompute preserves scope through nested recompute/draft/update paths.
- Post-action PlatformDecision projection remains advisory only; authorization is still enforced by domain guards and canonical revalidation. No guest auto-send policy was widened.
- Changed files: the three Booking Ops mutation routes, shared repository/action/check-in/in-stay/pre-checkin domain paths, lifecycle/turnover side-effect adapters, and focused scope tests.
- Verification: focused mutation/scope contour **117/117 PASS**; frozen Booking Ops + Channel Manager + reservation + owner-Telegram + pre-checkin/check-in/in-stay regression **243/243 PASS**; TypeScript **PASS**; changed-file ESLint **PASS**; `git diff --check` **PASS**.
- Next step: continue the remaining route-only mutation audit, prioritizing check-in release, legal/payment and guest-legal action routes, then physical-readiness mutations; keep any payload-only/unbound contour fail-closed.

## Guest intake / check-in release scope revalidation

- Baseline HEAD: `b99eeb48b54304802f67f88ad2dbe43a159a502c`.
- Guest-intake and check-in-release routes keep using the shared Booking Ops API access helper, then pass its canonical booking/account/property scope through every release/intake domain mutation and post-action snapshot.
- Guest-intake session/draft/submission/escalation and check-in-release draft/simulated-release writes revalidate canonical scope before side effects. Lifecycle emission keeps its independent scope guard.
- Nested legal readiness now carries the canonical account into availability checks and scoped Booking Ops summary updates; nested physical task initialization/recompute revalidates scope before task/readiness/lifecycle writes.
- Communication remains draft-only and simulated release performs no external guest send. PlatformDecision is not used as execution authorization.
- Changed files: the two release/intake routes and route tests, guest-intake/check-in-release domain, legal readiness bridge, physical readiness initialization/recompute, and focused scope test.
- Verification: focused release/legal/physical contour **66/66 PASS**; frozen Booking Ops + Channel Manager + reservation + owner-Telegram + check-in/in-stay + release/legal/physical regression **309/309 PASS**; TypeScript **PASS**; changed-file ESLint **PASS**; `git diff --check` **PASS**.
- Next step: audit `legal-payment` and dashboard guest-legal action routes, then move the physical-readiness route to the shared access helper and carry expected scope through its mutation dispatcher; do not grant authority from payload-only/unbound fields.

## Legal/payment execution scope checkpoint

- Preserved release checkpoint committed normally as `ec42957425a133f6ba4f029132cf8e69005a48ad`; repeated verification: **66/66 focused**, **309/309 frozen**, TypeScript / ESLint / staged and unstaged diff-check **PASS**.
- Baseline HEAD: `ec42957425a133f6ba4f029132cf8e69005a48ad`. Resulting HEAD: `2e6312a676078f5d9fa3cfb05545c1f2115dc045`.
- Files: `legal-payment/route.ts`, `legal-payment/__tests__/route-scope.test.ts`, `legal-payment-autopilot.ts`, `legal-payment-scope.test.ts`, this review.
- Shared API access supplies canonical booking/account/property; all 14 actions and status initialization carry expected scope. Domain guards run before documents, singleton upserts, lifecycle gates, scoped Booking Ops summary writes, and knowledge-reviewed communication persistence. No sending policy changed.
- Verification: **47/47 focused (3 files)**; frozen contour **309/309 (29 files)**; TypeScript / touched-file ESLint / diff-check **PASS**. Adversarial tests cover denied/unbound route access, all domain entries, ownership changes after reads/initialization/knowledge review, and scoped summary propagation.
- Remaining blocker: guest-legal action/status/explain and physical mutation routes still need scope propagation. Smallest next step: guest-legal route access plus all nested document/legal/readiness/event operations.

## Guest-legal execution scope checkpoint

- Baseline HEAD: `2e6312a676078f5d9fa3cfb05545c1f2115dc045`. Result: `49f15c709367ac3111fe35c8a9308b55245d6da4` (`fix(booking-ops): bind guest legal execution to canonical scope`).
- Files: guest-legal `action`, `status`, `explain`, `events` routes and `__tests__/route-scope.test.ts`; `guest-legal-deposit-mvd-execution.ts`; `guest-legal-scope.test.ts`; this review.
- Shared route access binds all 17 actions, status/explanation recompute, and event reads. Expected scope reaches documents, singleton legal writes, account-scoped availability, readiness, each lifecycle gate, scoped summary sync and legal execution events; guards repeat after asynchronous reads/checks and before writes.
- Verification: **65/65 focused (3 files)**; frozen contour **309/309 (29 files)**; TypeScript / touched-file ESLint / diff-check **PASS**. Adversarial tests include all action entries, unbound/cross-account routes, post-read ownership change, availability-time change, between-gate change and post-summary event rejection.
- Remaining blocker: physical readiness mutation route still uses account-only route authorization. Smallest safe next step: shared route access and expected scope through physical mutations, task closure, approval and lifecycle/event effects.

## Physical readiness execution scope checkpoint

- Baseline HEAD: `49f15c709367ac3111fe35c8a9308b55245d6da4`. Result: `5fb5e28e22e51e74ec7a9306fb780bda8a838147` (`fix(booking-ops): revalidate physical readiness execution scope`).
- Files: physical-readiness route and route test; physical-readiness execution; tasks; lifecycle-entry adapter and test; guest-legal execution; pre-checkin control center; new physical-readiness-scope, tasks-scope and pre-checkin-scope-propagation tests; this review.
- Shared route access carries canonical scope through all physical actions, initialization/recompute, cleaning/linen/supplies/maintenance, coordination drafts, final approval, task closure and lifecycle/audit events. Domain guards repeat before writes and after asynchronous reads; nested pre-checkin/legal/physical readiness and knowledge-reviewed draft preparation retain expected scope.
- Verification: **119/119 focused (11 files: physical/task/lifecycle 100 + pre-checkin 19)**; frozen contour **315/315 (29 files, original 309 plus 6 lifecycle scope cases)**; TypeScript / touched-file ESLint / diff-check **PASS**.
- Adversarial tests cover ownership changes before task writes, approval/event effects and knowledge-reviewed draft persistence. Guest sending, simulated release, provenance and readiness gates remain unchanged.
- Remaining blocker: task create/update/run routes still drop canonical scope before completion/communication effects; pre-checkin override/fallback paths need a separate execution-time scope audit.
- Smallest safe next step: trace task completion/action effects end to end, then bind task routes and domain effects to canonical scope; never accept source booking identity from payloads.

## Manual task creation and lifecycle scope checkpoint

- Baseline HEAD: `5fb5e28e22e51e74ec7a9306fb780bda8a838147`. Result: `4ee64c01bd257862c6c4e699b7d589314b7ce109` (`fix(booking-ops): bind manual tasks and lifecycle writes to scope`).
- Files: `[id]/tasks/route.ts`, `__tests__/task-create-scope.test.ts`, `tasks.ts`, `lifecycle.ts`, `tasks-scope.test.ts`, `lifecycle-task-scope.test.ts`, this review.
- Manual creation uses canonical shared-access ID and scope. The domain derives source booking from its final canonical record, ignores caller source identity, and refuses a corrupt duplicate source link. Task lifecycle propagation now retains expected scope through initialization, gate updates, exception writes and secondary maintenance/inspection gates.
- Verification: **62/62 focused (7 files)**; frozen contour **315/315 (29 files)**; TypeScript / touched-file ESLint / diff-check **PASS**.
- Remaining blocker: task update/run completion and communication effects still need end-to-end scope propagation. Existing legal/physical/pre-checkin gate callers need to pass scope into the newly guarded nested lifecycle write seam.
- Smallest safe next step: propagate lifecycle scope from the already scoped priority domains and pre-checkin override/fallback actions; then separately trace task completion/action communication effects.

## Nested priority lifecycle scope checkpoint

- Baseline HEAD: `4ee64c01bd257862c6c4e699b7d589314b7ce109`. Result: `8b85e8c1c5a0947e847f2603dfe1507cd19040c5` (`fix(booking-ops): retain scope through nested lifecycle mutations`).
- Files: `lifecycle.ts`, `legal-payment-autopilot.ts`, `guest-legal-deposit-mvd-execution.ts`, `physical-readiness-execution.ts`, `pre-checkin-control-center.ts`; corresponding legal-payment, guest-legal, physical-readiness, pre-checkin-scope-propagation and lifecycle-task-scope tests; this review.
- All priority lifecycle calls carry canonical expected scope into guarded initialization, gate and exception writes. Legal status initialization, MVD skip, pre-checkin override/clear/resolve/block/skip and fallback snapshots retain scope. Payload metadata remains non-authoritative.
- Verification: **187/187 focused (13 files)**; frozen contour **315/315 (29 files)**; TypeScript / touched-file ESLint / staged and unstaged diff-check **PASS**.
- Remaining blocker: `[id]/tasks/[taskId]/route.ts` and `run/route.ts` do not yet bind task completion/action downstream effects to canonical scope. Repository task sync currently scopes its initial record read but drops scope in `applyBookingOpsTaskSync`; communication and Telegram draft persistence need guards after policy/knowledge awaits.
- Smallest safe next slice: propagate scope through task completion effects and repository/task-sync writes, then communication intents/events and Telegram draft insertion/reuse before enabling the task update/run routes to use the complete guarded chain. Preserve existing readiness/provenance/manual-send policy; route-only changes are insufficient.
- The three requested priority mutation areas are hardened; Wave 5 remains **PARTIAL** until the remaining mutation/internal-caller scope audit is finished.

## Continuation verification ledger

Worktree: `C:\Users\Admin\Documents\GitHub\asi-landing-wave5-residential-location-runtime`.
Continuation starting HEAD: `b99eeb48b54304802f67f88ad2dbe43a159a502c`.
Current committed HEAD: `717781d4c52d6fb088ea2b2f850a71522e25dee0`.
Latest committed production HEAD: `fd1d135d1fc73cbe206b995476edb5743a00815e`.
All checkpoints below were committed normally; no safety-layer bypass was needed.

| Result HEAD | Slice | Focused | Frozen |
| --- | --- | --- | --- |
| `ec429574` | Preserved staged release checkpoint | 66/66, 7 files | 309/309, 29 files |
| `2e6312a6` | Legal/payment | 47/47, 3 files | 309/309, 29 files |
| `49f15c70` | Guest legal | 65/65, 3 files | 309/309, 29 files |
| `5fb5e28e` | Physical + nested pre-checkin | 119/119, 11 files | 315/315, 29 files |
| `4ee64c01` | Manual tasks + lifecycle writes | 62/62, 7 files | 315/315, 29 files |
| `8b85e8c1` | Priority nested lifecycle callers | 187/187, 13 files | 315/315, 29 files |
| `a0db5a16` | Task update/run and completion effects | green focused contour | 315/315, 29 files |
| `c5e6edc4` | Telegram draft canonical scope | green focused contour | 315/315, 29 files |
| `1dfa0d8e` | Recompute/communications + guest-intake scope | 42/42, 5 files | 315/315, 29 files |
| `f973f2ab` | Canonical record/task-list + lifecycle route/service scope | 62/62, 5 files | 315/315, 29 files |

TypeScript and touched-file ESLint passed at every production checkpoint. Staged/unstaged diff-check and the cumulative diff from the starting HEAD passed. Test counts describe separate contours and must not be summed as unique tests.

Changed paths through `8b85e8c1` (31 files, including the preserved staged work); later checkpoints are summarized below:

```text
docs/reviews/2026-10-03-wave5-residential-location-runtime.md
src/app/api/dashboard/booking-ops/[id]/tasks/route.ts
src/app/api/dashboard/booking-ops/__tests__/task-create-scope.test.ts
src/app/api/dashboard/booking-ops/checkin-release/route.ts
src/app/api/dashboard/booking-ops/guest-intake-release/__tests__/route.test.ts
src/app/api/dashboard/booking-ops/guest-intake-release/route.ts
src/app/api/dashboard/booking-ops/legal-payment/__tests__/route-scope.test.ts
src/app/api/dashboard/booking-ops/legal-payment/route.ts
src/app/api/dashboard/booking-ops/physical-readiness/__tests__/route.test.ts
src/app/api/dashboard/booking-ops/physical-readiness/route.ts
src/app/api/dashboard/guest-legal/__tests__/route-scope.test.ts
src/app/api/dashboard/guest-legal/action/route.ts
src/app/api/dashboard/guest-legal/events/route.ts
src/app/api/dashboard/guest-legal/explain/route.ts
src/app/api/dashboard/guest-legal/status/route.ts
src/lib/booking-ops/__tests__/guest-intake-checkin-release-scope.test.ts
src/lib/booking-ops/__tests__/guest-legal-scope.test.ts
src/lib/booking-ops/__tests__/legal-payment-scope.test.ts
src/lib/booking-ops/__tests__/lifecycle-entry-adapter.test.ts
src/lib/booking-ops/__tests__/lifecycle-task-scope.test.ts
src/lib/booking-ops/__tests__/physical-readiness-scope.test.ts
src/lib/booking-ops/__tests__/pre-checkin-scope-propagation.test.ts
src/lib/booking-ops/__tests__/tasks-scope.test.ts
src/lib/booking-ops/guest-intake-checkin-release.ts
src/lib/booking-ops/guest-legal-deposit-mvd-execution.ts
src/lib/booking-ops/legal-payment-autopilot.ts
src/lib/booking-ops/lifecycle-entry-adapter.ts
src/lib/booking-ops/lifecycle.ts
src/lib/booking-ops/physical-readiness-execution.ts
src/lib/booking-ops/pre-checkin-control-center.ts
src/lib/booking-ops/tasks.ts
```

## Task effects, Telegram drafts, and recompute/intake continuation

- `a0db5a16` binds task update/run, completion effects, task sync and communication side effects to canonical scope; `c5e6edc4` binds Telegram draft route create/reuse/update to the same scope.
- Baseline for the latest slice: `c5e6edc42408c39e52981263978635a414031c2e`; result: `1dfa0d8e0343edd902df67f4fb6edcc5587712f9` (`fix(booking-ops): retain scope through recompute and guest intake`).
- Latest changed files: `[id]/communications/route.ts`, `[id]/recompute/route.ts`, `guest-intake-autopilot.ts`, `lifecycle.ts`, two new scope tests, and a deterministic clock fix in the existing guest-intake test.
- Canonical account/property/booking scope now survives recompute, guest-intake session/token/task/event/lifecycle mutations and communication planning; ownership is revalidated around asynchronous reads and before persistence. External guest sending policy is unchanged.
- Verification: focused **42/42 PASS (5 files)**; frozen regression **315/315 PASS (29 files)**; TypeScript, touched-file ESLint and `git diff --check` **PASS**.
- `f973f2ab224ba637107fb60b2bb9e4c7ad9f99f8` closes the dashboard `[id]` record, task-list, lifecycle and lifecycle-summary scope gaps and adds execution-time revalidation inside lifecycle event persistence. Verification: focused **62/62 PASS (5 files)**; frozen **315/315 PASS (29 files)**; TypeScript, touched-file ESLint and `git diff --check` **PASS**.
- `1e46f5368a1ea28dd36df014f64d448228e8e8e9` commits the lifecycle-entry/operator-alert continuation: canonical scope is retained through lifecycle persistence, cleaning transitions, missing-data draft persistence and processed audit effects. Focused **33/33 PASS**; frozen contour remained green (**151/151 + 165/165**); TypeScript / touched-file ESLint / diff-check **PASS**. Guest auto-send policy is unchanged.

## Property-unbound authenticated intake seam

- Baseline HEAD: `1e46f5368a1ea28dd36df014f64d448228e8e8e9`. Result: `fd1d135d1fc73cbe206b995476edb5743a00815e` (`fix(booking-ops): defer unbound intake lifecycle effects`). Files: dashboard `intake/process`, `real-booking-intake-autopilot.ts`, their focused tests, Channel Manager isolation harness, and this review.
- Authenticated account-bound intake with no canonical property remains a review-only record: no tenant lifecycle, task/readiness stack or communication persistence runs until a property is resolved. Public/accountless inquiry behavior is unchanged.
- Once a property-bound record exists, the domain derives server-owned `{ accountId, propertyId }`, propagates it through automation/readiness/task/lifecycle/communication helpers, and revalidates scope after policy/knowledge awaits before persistence. Dashboard lifecycle emission re-resolves the booking through the shared access helper and uses canonical booking/property/account values.
- Verification: focused **37/37 PASS (3 files)**; frozen regression **318/318 PASS (29 files)**; TypeScript / touched-file ESLint / `git diff --check` **PASS**.
- The null-property -> canonical-property attach gap is closed in the verified staged checkpoint below; the next unbound mutation seam is guest/data attachment.

## Account-bound review and canonical mutation checkpoints

- `eb91915a9c783aeebdcf5642379b221a228da914` (`fix(booking-ops): guard unbound review mutations`) commits the guarded property-attach and account-bound/property-unbound review-data seams. Unbound guest/data updates require the expected account and `property_id IS NULL`, remain review-only, and do not start task, guest-intake, lifecycle, or communication side effects before canonical property binding.
- `43a02c0f769fbb191474a7ab27052c808588e579` (`fix(booking-ops): scope channel sync updates`) closes the Channel Manager read-to-write race: live booking updates persist only while the booking still matches canonical `{ accountId, propertyId }`; a scope change fails closed and blocks incremental cursor advancement.
- `f782b1178e0d0defa767f658e43a8446f0a3f988` (`fix(reservations): retain canonical mutation scope`) binds reservation cancellation/restoration to the shared canonical booking identity. Booking status mutation, hold release, availability checks, and repository side effects retain the same account/property scope; a moved or mismatched booking fails closed.
- `ae1f4602e4c15fc03f461bb52bec426c70e216e5` (`fix(booking-ops): scope guest intake mutations`) carries canonical account/property scope through token/session updates, guest record mutation, submission audit, intake automation, task reads, and communication planning. Account-bound records without a canonical property fail closed; legacy/accountless fallback behavior is unchanged.
- PlatformDecision remains advisory only. Domain guards/revalidation remain authoritative, and guest auto-send policy is unchanged.
- `ae1f4602e4c15fc03f461bb52bec426c70e216e5` verification: focused guest-intake contour **34/34 PASS (3 files)**; frozen regression **349/349 PASS (31 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**.
- `b3a7e171` (`fix(reservations): scope property transfers`) commits the property-transfer checkpoint. Dashboard reservation PATCH authorizes the old canonical booking scope, validates a different target property through the shared access helper, changes property + unit in one guarded repository mutation, revalidates the target immediately before persistence, and runs post-write effects under the new canonical scope. Verification: focused **19/19 PASS (3 files)**; frozen regression **356/356 PASS (32 files)**; TypeScript, touched-file ESLint, and diff-check **PASS**.
- The generic Booking Ops automation service no longer performs account-bound canonical writes by record id alone. When a record has a non-legacy account and canonical property, its automatic status patch now uses repository `expectedScope`; a moved/mismatched record fails closed into operator attention. Legacy/accountless fallback behavior is unchanged.
- Verification for this automation-service slice: focused **3/3 PASS**; frozen regression **172/172 + 187/187 = 359/359 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**.
- `b986a186` (`fix(booking-ops): scope automation runner effects`) commits the runner checkpoint from baseline `c7626546`. Snapshot reads revalidate canonical `{ accountId, propertyId }` before and after dependent reads; runner execution, audit, retry metadata, handoff reconciliation, guest-intake/communications, legal/payment, physical-readiness, and check-in prepare/queue/arrival-request effects retain that scope. Guest auto-send policy is unchanged.
- `c00a2df0` (`fix: scope checkin transitions`) commits instructions-sent, arrival confirmation, access-ready/access-issue, and guest-checked-in scope propagation. Lifecycle gates, communication intent creation, execution-row persistence, Booking Ops record updates, and final snapshots revalidate the same canonical scope instead of falling back to id-only writes.
- `944f4701` (`fix(booking-ops): scope remaining checkin mutations`) commits the remaining direct check-in mutation seams: `resolve_access_issue`, fallback creation, operator-note persistence, and check-in baseline initialization retain `expectedScope`; access-issue lifecycle failures stop before communication/execution/record side effects. Direct `booking_checkin_execution` mutation audit is now guarded; the real-intake occurrence is read-only.
- `21118504` (`fix(booking-ops): scope instay baseline`) commits the in-stay baseline checkpoint: account-bound inbound automation passes canonical `{ accountId, propertyId }`, baseline persistence revalidates immediately before write, and mid-flight scope changes fail closed. Public/accountless intake keeps the legacy fallback. Verification: focused **53/53 PASS (2 files)**; frozen **368/368 PASS (33 files)**; TypeScript, touched-file ESLint, and diff-check **PASS**.
- `42e8158a` (`fix(booking-ops): scope instay support mutations`) commits support-window and guest-issue create/triage/resolve scope propagation. Lifecycle initialization, `booking_guest_stay_issues`, guest-issue communication intents, and `booking_instay_checkout` writes revalidate canonical scope; moved/mismatched bookings fail closed before the affected write. Verification: focused **34/34 PASS (1 file)**; frozen **371/371 PASS (33 files)**; TypeScript, touched-file ESLint, and diff-check **PASS**.
- `b4762fa8` (`fix(booking-ops): scope instay checkout transitions`) commits checkout instruction/confirmation transitions and the in-stay `markGuestCheckedOut` path. Prepare/queue/sent/confirmation communication and execution writes, checkout lifecycle completion, task sync, and final snapshots retain canonical `expectedScope`. Verification: focused **36/36 PASS (1 file)**; frozen **373/373 PASS (33 files)**; TypeScript, touched-file ESLint, and diff-check **PASS**.
- `97746183` (`fix(booking-ops): scope instay closeout mutations`) commits post-checkout inspection, deposit-return readiness, booking close, fallback, and operator-note scope propagation. Lifecycle gates, communication intents, close-guard legal recomputation, execution persistence, and final snapshots retain canonical scope. Verification: focused **39/39 PASS (1 file)**; frozen **376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and diff-check **PASS**.
- `117be071` (`fix(booking-ops): revalidate controlled send scope`) hardens controlled communication delivery around the same canonical boundary. Account/property-bound delivery enqueue revalidates canonical scope after availability/policy awaits and immediately before persistence; execution revalidates again after policy/scope resolution before claiming the delivery and immediately before any provider call. Scope drift blocks the delivery instead of sending. Legacy/accountless fallback is unchanged, and the existing hard block on automatic guest sending remains intact. Verification: focused auto-send contour **55/55 PASS (6 files)** including **24/24** executor tests; frozen regression **172/172 + 204/204 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**.
- Current continuation closes the remaining exported delivery-status mutation seam. `recordDeliverySuccess`, `recordDeliveryFailure`, and `skipDelivery` can retain canonical `expectedScope` and refuse stale account/property writes. After a provider call succeeds, delivery completion and communication-intent completion are revalidated again; if scope moved after the irreversible provider call, stale persistence is suppressed and the result remains success-shaped so the message is not retried automatically. Communication orchestrator and pre-checkin direct intent writes were audited and already revalidate immediately before account-bound persistence.
- Verification for this continuation: focused auto-send contour **57/57 PASS (6 files)** including **26/26** executor tests; frozen regression **172/172 + 204/204 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. Baseline HEAD: `117be071`. Smallest safe next step after commit: scope the account-bound pilot autorun path, which still calls pre-checkin and other Booking Ops mutators without propagating canonical `{ accountId, propertyId }`; treat `initializeBookingOpsCoreLoop` / lifecycle orchestrator propagation as a separate coherent slice rather than partially bypassing it.
- The next continuation now carries canonical `{ accountId, propertyId }` through the account-bound pilot autorun path and `initializeBookingOpsCoreLoop`. Lifecycle, legal/payment/MVD drafts, check-in/in-stay baselines, pre-checkin recompute, task sync, safe communication planning, guest-intake/physical initialization, SLA persistence, lifecycle drafts/events/state, and lifecycle-run completion revalidate that same scope around asynchronous reads and immediately before account-bound persistence. Legacy/accountless behavior remains unchanged; no guest auto-send policy was relaxed.
- Dashboard lifecycle reads, manual runs, overrides and escalations now retain the authorized canonical scope; account-scoped due batches derive and propagate each booking's canonical account/property scope and fail closed for unbound rows. Pilot autorun booking/batch routes now require booking/account authorization, batch discovery and run refs are account-scoped, cross-account booking runs reject before autorun audit creation, and booking/batch status/explain/fallback paths cannot cross the authenticated account boundary. Lead/property-setup behavior is unchanged.
- Final verification for the pilot/core-loop/lifecycle slice: focused **39/39 PASS (5 files)**; frozen regression **172/172 + 204/204 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. The previously staged delivery-status checkpoint remains intact; local commit creation is still blocked by the execution safety gate, so no bypass was attempted.
- Unstaged continuation hardens event-reducer lifecycle convergence itself: scoped processing now passes canonical `{ accountId, propertyId }` into `convergeLifecycleEvent`, which revalidates before lifecycle projection persistence and again before worker-task completion. Legacy/accountless convergence keeps the existing fallback path.
- Verification for this convergence slice: focused **17/17 PASS (3 files)**; frozen regression **172/172 + 204/204 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. The earlier 14-file green checkpoint remains staged and untouched; this slice is intentionally left unstaged because local commit creation is blocked by the execution safety gate and no bypass was attempted.
- Lifecycle reconciliation now revalidates canonical `{ accountId, propertyId }` immediately before lifecycle-state repair, each worker-task repair, and reconciliation audit persistence. Dry-run remains read-only; account-bound mutation without a canonical property fails closed.
- Recovery of unprocessed domain events now derives canonical scope from the booking record before retrying account-bound events; unbound account-owned events remain unprocessed instead of advancing lifecycle state. Legacy/accountless recovery fallback remains unchanged. The admin lifecycle-bootstrap route now authorizes the canonical booking/account/property route scope, passes it through bootstrap processing, revalidates before its Booking Ops audit, and reads the lifecycle summary under the same scope.
- Public guest-intake lifecycle emissions now derive server-owned scope from the submitted Booking Ops record and pass it into `recordAndProcessBookingEvent`; scope drift therefore fails closed after guest submission instead of emitting lifecycle events against a moved account/property booking. Legacy/accountless guest intake keeps the existing fallback.
- Verification for this continuation: focused **31/31 PASS (6 files)**; frozen regression **85/85 + 87/87 + 118/118 + 86/86 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. The pilot/core-loop/lifecycle checkpoint is committed as `1a22fd78` (`fix(booking-ops): scope pilot runtime`), and the lifecycle reconciliation/recovery/bootstrap/guest-intake checkpoint is committed as `c883f105` (`fix(booking-ops): scope lifecycle recovery entrypoints`).
- Secure worker workspace token reads and mutations now derive canonical account/property scope from the server-owned booking record, reject account-bound task/object drift, revalidate before task mutation, constrain the task update by booking/property, carry scope into lifecycle event processing, and revalidate around worker-link audit/response boundaries. Legacy/missing-record task-link fallback remains unchanged. Verification: focused continuation **34/34 PASS (6 files)**; frozen regression **85/85 + 87/87 + 118/118 + 86/86 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. This checkpoint is committed as `f054593e` (`fix(booking-ops): scope worker workspace`).
- Worker-link issue/revoke/list operations and their dashboard route now carry canonical `{ accountId, propertyId }` from authorized access. Account-bound task lists are property-filtered and revalidated after reads; issuance constrains task assignment by booking/property and revalidates before link revocation/creation/audit; revocation rejects linked-task object drift before mutation. Legacy callers without expected scope keep the prior fallback. Verification: focused **5/5 PASS** for the new service contract plus the worker-workspace contour **11/11 PASS (2 files)**; frozen regression **85/85 + 87/87 + 118/118 + 86/86 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. The secure worker workspace checkpoint is committed as `f054593e` (`fix(booking-ops): scope worker workspace`); the 4-file worker-link-controls checkpoint is committed as `31cc819a` (`fix(booking-ops): scope worker link controls`).
- Operator-exception `assign_executor` for worker tasks now constrains the assignment write to canonical `booking_id + object_id + role + allowed status`, then revalidates booking scope before audit/reconciliation. A task that drifts to another property between the linked-object read and assignment write fails closed without assignment, audit, or reconciliation. Verification: focused **17/17 PASS (2 files)**; frozen regression **85/85 + 87/87 + 118/118 + 86/86 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. This operator slice is included in `1b606d76` (`fix(booking-ops): close worker link drift races`).
- Secure worker-workspace metadata is now guarded at the same boundary: `last_used_at` writes are constrained by `link_id + task_id`, canonical task/property scope is checked before and after the metadata write, and worker-link audit persistence revalidates the current task/property before and after the audit call. A link that drifts to another task is rejected without last-used persistence; a task that drifts after lifecycle processing is rejected before worker-link audit. Explicit link revocation is also constrained by the originally-read `link_id + task_id`, verifies that the exact link still exists after the write, and revalidates the canonical task/property before audit; a retargeted link therefore fails closed without revocation audit. Legacy/accountless behavior remains unchanged. Verification: focused **27/27 PASS (3 files)**; frozen regression **85/85 + 87/87 + 118/118 + 86/86 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, staged/unstaged `git diff --check` **PASS**. This metadata/audit/revocation slice is included in `1b606d76` (`fix(booking-ops): close worker link drift races`).
- Secure-link issuance now detects a zero-row canonical task assignment at the write boundary by selecting the guarded `id + booking_id + object_id` update result. After link creation it revalidates the canonical worker-task scope; if the task/property drifts before issuance audit, the just-created link is revoked by `link_id + task_id` and the operation fails closed without an issuance audit or returned token. Prior-link revocation semantics and legacy/accountless issuance remain unchanged. Verification: focused **29/29 PASS (3 files)**; frozen regression **85/85 + 87/87 + 118/118 + 86/86 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, staged/unstaged `git diff --check` **PASS**. Both worker-link checkpoints are committed: `31cc819a` for link controls and `1b606d76` for metadata/audit/revocation/issuance drift races and are now saved locally and no bypass was attempted.
- Availability/overbooking risk persistence is now property-guarded for account-bound writes. The guarded risk write now uses canonical `id + account_id + property_id`, so same-account property drift fails closed before the patch. Verification: focused **28/28 PASS**; frozen regression **85/85 + 87/87 + 118/118 + 86/86 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. Booking-bound conflict-check persistence now revalidates canonical `booking + account + property` immediately before the insert; scope drift fails closed without leaving a stale check row. `confirmAvailabilityHold` now revalidates an account-bound booking against the canonical property supplied by the shared availability access boundary, so a same-account property move fails closed before hold confirmation while accountless fallback remains unchanged. Verification: focused availability contour **43/43 PASS**; frozen regression **85/85 + 87/87 + 118/118 + 86/86 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. `mark_needs_review` now fails closed without a canonical property and constrains the booking mutation by `id + account_id + property_id`, preventing same-account property drift after route access. Verification: focused availability contour **44/44 PASS**; frozen regression **85/85 + 87/87 + 118/118 + 86/86 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. `add_note` now retains the canonical property returned by `requireBookingOpsApiAvailabilityCheckAccess` on both the conflict-check read and warning update; missing property scope fails closed, and same-account property drift cannot read or mutate the stale check row. Verification: focused availability contour **45/45 PASS**; frozen regression **85/85 + 87/87 + 118/118 + 86/86 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. `explainAvailabilityConflict` now retains canonical property scope from the shared access boundary on its post-access conflict read; same-account property drift therefore returns no explanation instead of exposing a stale property check. Verification: focused availability contour **46/46 PASS**; frozen regression **85/85 + 87/87 + 118/118 + 86/86 = 376/376 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. The availability action/read mutation contour has no further obvious account-bound property-scope gap from this audit. Post-availability Channel Manager continuation extracted the existing live-core connection scope resolver into shared `channel-manager-scope.ts` and kept `resolveIncrementalConnectionScope` as a compatibility wrapper. Object reconciliation now limits candidate property setups to the connection owner and guards imported-object writes by connection; booking reconciliation derives canonical property/account from the shared boundary, rejects conflicting caller-provided scope, fails closed without canonical property, and constrains matches/repairs to the canonical property plus account when available. Two isolation tests cover cross-owner object matching and same-account cross-property booking matching. Verification: focused **56/56 PASS (3 files)**; frozen regression **85/85 + 89/89 + 118/118 + 86/86 = 378/378 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. Follow-up admin reconcile hardening now requires a request connection, binds `ignore_imported_*` mutations and `create_booking_from_imported` to that connection at the service boundary, and scopes `booking_missing_in_cm` conflict reads to canonical property plus account when available. Cross-connection mutation/creation tests fail closed before side effects. Verification: focused **58/58 PASS (3 files)**; frozen regression **85/85 + 91/91 + 118/118 + 86/86 = 380/380 PASS (33 files)**; TypeScript, touched-file ESLint, staged/unstaged `git diff --check` **PASS**. The earlier 5-file canonical-reconciliation checkpoint remains staged because local commit creation was blocked by the execution safety gate; this follow-up remains unstaged. The canonical-reconciliation checkpoint is committed as `b8ca4657` (`fix(booking-ops): centralize channel manager scope`), and admin reconcile hardening is committed as `a6b9a813` (`fix(booking-ops): scope channel reconcile actions`). Manual/provider object, booking, calendar, and pricing snapshot upserts now resolve canonical connection scope before building rows and revalidate the same owner/property/account contour immediately before persistence; mid-flight property/account drift fails closed without an imported row. Focused Channel Manager verification **72/72 PASS (5 files)**; frozen regression **85/85 + 94/94 + 118/118 + 86/86 = 383/383 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. The import-upsert checkpoint is committed as `0106b357` (`fix(booking-ops): revalidate channel import scope`). Import runs now snapshot canonical owner/property/account scope at start and revalidate it before completion/failure state changes and connection status updates; property/account drift leaves the run unchanged instead of finalizing it under a stale connection. Focused Channel Manager verification **75/75 PASS (5 files)**; frozen regression **85/85 + 97/97 + 118/118 + 86/86 = 386/386 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. The final manual-snapshot receipt and owner notice now retain the same canonical connection scope: the receipt update is constrained by connection + owner/property, the current connection is re-read before metadata merge, and owner-notice persistence revalidates scope after policy evaluation. Mid-flight scope drift fails closed before stale metadata or communication persistence. Verification: focused Channel Manager contour **76/76 PASS (5 files)**; frozen regression **85/85 + 98/98 + 118/118 + 86/86 = 387/387 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. Channel Manager access/onboarding mutations now carry one canonical connection scope through request/receive/invalid access handling, property access-status writes, provider-stage transitions, operator notes, blocking, reconciliation completion, and owner notices. Mutable metadata is re-read before merge, canonical `accountId` cannot change inside the operation, connection writes are constrained by owner/property, and owner notices revalidate scope after policy evaluation. Two race tests cover account drift before access mutation and before onboarding status mutation. Verification: focused Channel Manager contour **78/78 PASS (5 files)**; frozen regression **85/85 + 100/100 + 118/118 + 86/86 = 389/389 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. The preceding 3-file manual-snapshot checkpoint remains staged because local commit creation is still blocked by the execution safety gate; this onboarding/status slice remains unstaged. `initializeChannelManagerConnection` now re-reads the property owner/property binding immediately before the connection upsert and validates the returned/new-or-existing connection against the same owner/property contour before returning; a race test covers owner drift before connection creation and leaves no connection row behind. Verification: focused Channel Manager contour **79/79 PASS (5 files)**; frozen regression **85/85 + 101/101 + 118/118 + 86/86 = 390/390 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. The read-only connection status/list surfaces were re-audited: their dashboard routes are intentionally protected by `requireCrmOperatorSession`, so widening those helpers with tenant filtering would incorrectly reduce operator visibility; no code change was made there. The preceding manual-snapshot checkpoint remains staged, while this initialization guard remains unstaged. The internal `getChannelManagerConnectionStatus` read-to-write audit is now complete for this contour: market-signal channel imports now require the shared canonical connection scope to match the requested property setup/property and revalidate that scope before calendar reads, signal writes, and run completion; an explicit cross-property connection test fails closed before source/run/signal creation. Pilot property autorun needs no extra status guard because the status lookup only decides whether to call the now-guarded connection initializer, while Live Core and reconciliation already derive canonical scope before scoped work. Verification: focused market/pilot/access contour **67/67 PASS (3 files)**; frozen regression remains **85/85 + 101/101 + 118/118 + 86/86 = 390/390 PASS (33 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. The earlier manual-snapshot checkpoint remains staged because local commit creation is still blocked by the execution safety gate and no bypass was attempted. Live Core connection mutations now retain canonical owner/property/account scope through stale-run recovery, guard acquisition, diagnostic lease writes, initial-sync finalization, incremental replay/commit, failure finalization, and status updates. Mutable connection writes go through atomic scoped RPC wrappers backed by a locked canonical-scope assertion; the Live Core readiness probe fails closed when that scope-guard migration is absent. A race test confirms that scope drift immediately before the final connection write leaves success metadata untouched. The migration is prepared only and was not applied. Verification: focused Live Core contour **73/73 PASS (4 files)**; frozen regression **85/85 + 103/103 + 118/118 + 86/86 = 392/392 PASS (33 files)**; TypeScript, touched-file ESLint, staged/unstaged `git diff --check` **PASS**. Import-run audit conclusion: ordinary Live Core progress/completion writes must move behind an atomic scoped run-update boundary that locks the canonical connection scope and constrains `run_id + connection_id`. Failure/stale-run cleanup is intentionally separate: it may mark the already-owned run failed after scope drift so the execution guard is not stranded, but it must not mutate connection/property/booking state. No production change was made for this boundary because extending the prepared migration with that atomic run-update RPC was blocked by the execution safety gate. Smallest safe next step: add the scoped run-update RPC to the prepared migration, wire normal `updateRunProgress` calls through it, and keep failure/stale cleanup as a narrow run-only evidence path.

- Live Core run progress/completion now uses the scoped `run_id + connection_id` RPC and guard acquisition is atomically tied to the same canonical owner/property/account contour. The prepared migration's run-update RPC was corrected to remain `SECURITY DEFINER` with `search_path=public`, matching the existing fail-closed readiness probe; a static migration contract test now covers both scoped RPC signatures/privileges. Direct stale/failure run cleanup remains intentionally run-only so scope drift cannot strand a `running` lock, and it does not mutate connection/property/booking state. Those cleanup/evidence writes are now also constrained by the original `connection_id`, so a run cannot be mutated after being retargeted while cleanup stays independent of current canonical scope. Verification: focused Live Core + migration **78/78 PASS (5 files)**; broader changed-Wave-5 regression **730/730 PASS (55 files)** after updating one stale task-list test expectation to the already-required canonical scope argument; TypeScript, touched-file ESLint, and staged/unstaged `git diff --check` **PASS**. The migration remains prepared only and was not applied. No further safe Live Core cleanup identity gap was found in this audit; the smallest safe next step is to move to the next Booking Ops canonical-scope seam rather than broaden cleanup semantics.
- Reconciliation stale-run cleanup now follows the same narrow identity rule: both stale-running recovery and stale-after-guard abort constrain the failure write by the original `run_id + connection_id + running status`, so a retargeted run cannot be modified while cleanup still remains independent of current canonical scope. Focused reconciliation verification **54/54 PASS (2 files)**; broader changed-Wave-5 regression **784/784 PASS (57 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**.

- Golden Path acceptance now derives canonical `{ accountId, propertyId }` once from the authorized booking and retains it through lifecycle summaries/events, worker-task/lifecycle/communication reads, safe draft synchronization, and the only Booking Ops status writes. Record mutations require `id + account_id + property_id`, revalidate through the shared `requireBookingOpsRecordScope` boundary, and fail closed on drift. Guest delivery policy is unchanged: the acceptance runner still prepares internal communication state only and does not invoke a delivery executor. Verification: focused acceptance **15/15 PASS (2 files)**; broader changed-Wave-5 regression **799/799 PASS (59 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. Smallest safe next step: continue the direct `booking_ops_records` mutation inventory and prefer existing shared scope helpers over local authorization logic.

- Direct reservation creation now retains the requested canonical property across idempotent-event reuse, external source-link reuse, post-intake enrichment, availability-hold binding, and creation audit. Existing/new booking identities are resolved through the shared residential booking scope helper; same-account cross-property reuse fails closed, the enrichment write requires `id + account_id + property_id`, and hold mutation is constrained to the same property. Cancellation/restoration scope behavior is unchanged. Verification: focused reservation scope **6/6 PASS**; broader changed-Wave-5 regression **802/802 PASS (59 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. Smallest safe next step: audit remaining direct account-only `booking_ops_records` mutations such as OPS v17 bootstrap for same-account property drift before persistence.

- OPS v17 pilot bootstrap now retains the eligible booking's canonical property across confirmation. Before enrichment it resolves the shared residential booking identity, the mutation requires `id + account_id + property_id`, and source-link creation revalidates the same booking/property contour. A race regression moves an eligible booking to another property of the same account immediately before persistence and verifies fail-closed behavior with no bootstrap mutation or source link. Verification: focused bootstrap tenancy **4/4 PASS**; broader changed-Wave-5 regression **806/806 PASS (60 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. Smallest safe next step: inspect the remaining legacy/account-adoption mutation separately; do not force ordinary canonical-property rules onto intentionally unbound migration/bootstrap data without proving the intended transition contract.

- Legacy reservation account adoption now treats property ownership as the eligibility boundary instead of adopting every `account_id IS NULL` row. Preview exposes only records whose existing `property_id` belongs to the target account; property-less and foreign-property rows stay unbound. Assignment revalidates target property ownership immediately before persistence and constrains the account adoption write by `id + account_id IS NULL + property_id`, so a record that changes property after preview is not adopted or audited. Verification: focused legacy-adoption scope **3/3 PASS**; broader changed-Wave-5 regression **809/809 PASS (61 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**. Smallest safe next step: finish the remaining direct Booking Ops insert/upsert inventory separately; do not alter test/acceptance cleanup helpers unless they participate in production authorization.

## Operational boundary

Wave 5 migration files are prepared and contract-tested but were **not applied to any live/local database** in this pass. No push, merge, deploy, live database mutation, DNS, secret, or package-install action was performed.
