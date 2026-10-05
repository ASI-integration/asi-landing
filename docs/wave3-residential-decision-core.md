# Wave 3 — RU residential decision core

Baseline: 484d0784158444a5f6f7cc0c36c925f77fe2de1b.
Worktree: asi-landing-wave3-residential-decision-core.
Branch: astra/wave3-residential-decision-core-20261002.

## Inventory recorded before implementation

| Existing contract | Adapter boundary; authority retained |
| --- | --- |
| Communication ProcessOutcome / ProcessResult | Transport history only; never evidence or permission. Do not copy reply/chat payload. |
| CommunicationFactsResult / FactDecision | Reuse evaluateCommunicationFacts for expiry and sensitivity; verified facts permit operator drafts only. Missing resolver scope cannot acquire tenant identity. |
| Escalation, operator review, auto-send policy | Existing handoff/persistence/executor remain authoritative; this envelope neither acknowledges nor releases reviews. |
| BookingReadinessResult / BookingOpsAutomationDecision | Draft/legal readiness and next-step recommendations, not access or closeout authorization. |
| PreCheckinReadinessSnapshot | Preserve hard blockers, warnings, required operator work; do not recompute lifecycle gates. |
| CheckinExecutionSnapshot | Existing lifecycleReady, blockers, access status plus canonical legal guard output. No new readiness engine. |
| InStayCheckoutSnapshot | Checkout, inspection, deposit and incident state. Prepared return is not actual return. |
| validateBookingClosePrerequisites | Additional authoritative guest/legal/lifecycle/incident checks. Its result is required for closeout, not replaced by ready_to_close status. |
| Ops v17 LaunchReadiness / OperationalReadiness | Existing launch checks, manual controls, owner verification and operator-assisted pilot. |
| RU commercial pilot lifecycle | Name describes the paid RU pilot funnel, not retail location. State machine remains unchanged; operational readiness above is the residential adapter source. |
| Wave 1 SpatialValidation | Residential/account-owned property only. Preserve blockers, warnings, manual controls, uncertainty and provenance without copying addresses/entities. |
| GuestStayIssueRow | Existing issue identity/status; eight representative categories map to operator review, never autonomous resolution. |

## Design boundary

Pure adapters consume existing canonical outputs with server-attested scope and observation time. Several legacy status getters initialize/recompute persisted state: adapters must NOT call them as supposedly read-only dependencies.
No runtime executor, endpoint, persistence, migration, provider call or transport change is introduced.
A scoped snapshot is a server-side input contract, not authentication. Never construct it from browser/guest metadata.
Booking Ops uses record.id as its workflow bookingId; do not substitute the external reservation bookingId.
Use original scope plus canonical revision checks around awaited reads. The envelope is advisory and cannot authorize future execution.
Reasons are fixed safe codes/text. Domain strings and metadata are never copied; indexed references locate original checks in the authenticated domain view.

## Validation plan

Local contract/adversarial tests; explicitly requested frozen first-pilot, Wave 2 and Wave 1 contours.
No npm test, live acceptance, package installation, push, merge or deployment.

## PlatformDecision v0 schema

- identity: identified accountId/propertyId with optional bookingId/guestId/sessionId; or unidentified sessionId with no tenant.
- domain/topic: communication, residential operations, residential location; a bounded lifecycle topic.
- status: allowed, blocked, review_required, unavailable. Not-ready maps to blocked; missing/failed reads map to unavailable.
- trust: verified, review_required, unavailable, conflicting. Trust never grants transport.
- evidence: safe source enum, source index, original observedAt, origin; incidents additionally retain canonical row UUID.
- blockers/limitations/manualControls: allowlisted reason codes. Unknown domain prose is represented by a generic safe reason and a domain reference.
- requiresHumanReview/review: what must be verified and a requirement to recompute through the canonical domain afterward.
- permission: exhaustive disjoint allowedActions/forbiddenActions; automaticActionAllowed is always false; executionAuthority always domain_revalidation_required.
- audit: creation time and safe reason codes, with fixed human-readable explanations via explainDecision.

isPlatformDecision / parsePlatformDecision are dependency-free runtime validation. They reject unknown fields, secret-bearing evidence payloads, malformed identity/time, empty reasons/evidence for allowed outcomes, conflicting permissions, unknown states and cross-domain actions. The constructor returns a deep immutable copy.

## Adapters and ownership

Communication consumes the resolver's exact authoritative scope. It reuses the Wave 2 evaluator to check facts at the current time, preserving missing/stale/conflicting/sensitive review. ProcessOutcome describes a past processing result and cannot grant transport. Unidentified conversation permission is clarification only; no tenant evidence is returned.

Ops consumes LaunchReadiness/OperationalReadiness, PreCheckinReadinessSnapshot, CheckinExecutionSnapshot plus the canonical legal guard, and InStayCheckoutSnapshot plus the canonical close-prerequisite list. It never invokes mutation-capable status getters. A valid check-in decision describes an eligible manual release, with automatic sending forbidden. Existing domain services and operator mechanisms remain the only executors. Manual pilot controls remain review_required, even when the pilot is otherwise ready.

Deposit preparation cannot become recorded resolution. Closeout deliberately uses validateBookingClosePrerequisites, which recognizes actual return on either the booking record or execution row, explicit waiver, and non-required deposits. Display status cannot bypass that check. Open incidents still block closeout.

Location consumes an account-owned RU residential SpatialValidation, reuses the Wave 1 pure validator at the current time, and preserves original failures/manual controls as well as current ones. Public map previews are not tenant ownership evidence. Neither scores nor commercial requirements are changed.

Incidents: cleaning, access/lock, maintenance, guest complaint, late checkout, lost item, noise and deposit dispute all map to operator review with existing issue identity retained. Resolving incidents, approving late checkout, discarding property, charging deposits and automatic guest messages are forbidden in v0.

## Freshness and server integration contract

Pure adapters do not perform awaited reads. readStableSnapshot is an optional dependency-injected read-only seam: immutable original identity, a copied payload, version/ownership verification before and after loading, 5-second bounded dependencies, and a final clock check. The revision MUST change for every ownership, readiness, deposit or incident change relevant to the aggregate, including ABA transitions. No production repository implementation is claimed.

A ScopedSnapshot must be created by an authenticated server-side canonical reader; TypeScript types and this schema do not authenticate data. Never accept a browser-supplied envelope as proof. A fetchedAt timestamp cannot replace the actual observation time. Ops snapshots are conservatively bounded to 60 seconds; original spatial source evidence retains Wave 1's 24-hour bound; Communication retains its existing key-specific lifetimes.

The envelope is NOT a lease or capability. It must not be used to execute a deferred action. Domain execution must reread current ownership and state, enforce its normal authorization and handle concurrency. Missing revision coverage means review/unavailable, not assumed stability.

## Sensitive data and explainability

No raw fact values, domain reason text, addresses, guest messages, metadata, provider errors, credentials or URLs are copied. Source indices are interpreted within the canonical source snapshot under the decision identity; a consumer retaining decisions must also retain an appropriately protected source reference/version if it needs durable drill-down. This v0 does not create an audit database.

Example: cleaning_incomplete plus access_unverified explains that cleaning is incomplete and access has not been verified. The operator sees request_operator_review/remediate as allowed; release_access and release_instructions remain forbidden. After corrections, canonical checks must run again.

## Remaining residential gaps outside this v0

- No production API/UI wiring, persisted decision history or operator-screen rendering.
- No production implementation of an aggregate version reader; callers must establish server-owned scope and complete revision coverage before adopting the optional read seam.
- Some legacy status getters initialize or recompute state; they cannot be wired into the read-only seam without an explicit domain change.
- Generic domain prose is intentionally not copied. Further safe reason-code mappings and retained versioned references can improve operator drill-down.
- No autonomous incident resolution, transport activation or new orchestration engine.
- Legacy Wave 2 test debt and real provider/database acceptance remain outside this local contour.

These are integration/product follow-ups, not claims of a deployed feature. Existing production code paths are unchanged.

## Pre-commit review completion: stage-aware advisory actions

| Canonical stage/state | Advisory permission |
| --- | --- |
| Pending check-in; instructions prepared or queued; canonical access ready/resolved; guards clear | Manual release proposals only; execution must re-read canonical state. |
| Access ready but instructions not_prepared | Prepare an operator draft / request review; neither release is permitted. |
| Instructions failed, or instruction status contradicts sent/queued aggregate status | Blocked; operator review/remediation only. Access readiness never proves preparation. |
| Instructions already sent, check-in still pending | No instruction release or new draft; access proposal only if canonical access permits it. |
| Check-in, execution row or pre-check-in already checked_in; pre-check-in closed | No obsolete check-in work. An access issue or canonical blocker still requires safe review. |
| Checkout confirmed or already at post-checkout stages | No repeated confirmation or obsolete checkout draft. Pending checkout remains operator review; this envelope does not independently confirm a guest event. |
| Deposit returned/waived | No repeated record_deposit_resolved action. Prepared/held deposits remain unresolved, never actual returns. |
| Booking closed by snapshot or execution row | No confirmation, deposit recording, draft or repeated close_booking. Open incidents block; unresolved deposit display requires review. |
| Nonterminal closeout | Canonical validateBookingClosePrerequisites remains required; an empty result at a pre-closeout stage cannot grant closure. |

Completed stages carry stage_complete with an empty allowedActions list. Safe review/no-op semantics never grant execution authority.
Display anomalies after closure are review evidence, not a second deposit/closeout readiness calculation. The canonical close guard still accepts actual return on the booking record, explicit waiver and non-required deposits.
Automatic guest sending remains forbidden in every case. No domain service, transport, provider, lifecycle gate engine, database or location scoring was changed.

### Completion evidence

The new adversarial cases reproduced 28 failures out of 86 adapter tests before the fix.
After the fix: 162/162 focused tests (platform 116; check-in 19; in-stay/checkout 27), first-pilot 135/135, Wave 2 240/240, Residential Location 110/110, safety 87/87, additional frozen 12/12.
There are 700 distinct passing tests across 42 files; 746 test executions across the contours include 46 repeated Booking Ops tests.
Typecheck, ESLint on all 9 touched TypeScript files, and full staged diff-check passed.
Wave 2 final adversarial tests were restored temporarily from the local b82f1583 Git object, verified byte-for-byte by Git blob hash, run unchanged, then removed; they are not part of this checkpoint.
Exact per-file counts and commands are recorded in docs/reviews/2026-10-02-wave3-verification.json.
No remaining gap within the requested local v0 scope. The production integration follow-ups listed above remain outside this checkpoint.
