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

## Account-bound review and Channel Manager update checkpoints

- `eb91915a9c783aeebdcf5642379b221a228da914` (`fix(booking-ops): guard unbound review mutations`) commits the guarded property-attach and account-bound/property-unbound review-data seams. Unbound guest/data updates require the expected account and `property_id IS NULL`, remain review-only, and do not start task, guest-intake, lifecycle, or communication side effects before canonical property binding.
- `43a02c0f769fbb191474a7ab27052c808588e579` (`fix(booking-ops): scope channel sync updates`) closes the Channel Manager read-to-write race: live booking updates now persist only while the booking still matches the canonical `{ accountId, propertyId }`; a scope change fails closed as `account_scope_mismatch` and incremental cursor advancement is blocked.
- PlatformDecision remains advisory only. Domain guards/revalidation remain authoritative, and guest auto-send policy is unchanged.
- Verification for the latest checkpoint: focused Channel Manager contour **45/45 PASS (3 files)**; frozen regression **162/162 + 165/165 = 327/327 PASS (29 files)**; TypeScript, touched-file ESLint, and `git diff --check` **PASS**.
- Changed files in `43a02c0f`: `channel-manager-live-core.ts`, `channel-manager-live-incremental-sync.test.ts`, plus a test-only typing cleanup in `repository.expected-scope.test.ts`.
- No blocker at this checkpoint. Next safe step: audit remaining production callers that still invoke booking mutations without retaining canonical account/property/booking scope; change only a caller with a proven live path and a focused regression contour.

## Operational boundary

Wave 5 migration files are prepared and contract-tested but were **not applied to any live/local database** in this pass. No push, merge, deploy, live database mutation, DNS, secret, or package-install action was performed.
