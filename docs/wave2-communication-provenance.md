# Wave 2 — Communication provenance

Baseline: `5189aca5f86aea4c13689064f9f0ed3535eae89f`.
Branch: `astra/wave2-communication-provenance-20261001`.

## Architecture inventory before edits

- `context.ts` combines conversation clues, `reservation.ts` matching and `knowledge.ts` property passport strings.
- `reservation.ts` currently falls back to an embedded mock store after missing/failed DB matching. This is not a safe runtime source.
- `knowledge.ts` reads `tg_property_knowledge`; it distinguishes missing/read failure but does not retain provenance or freshness.
- `object-knowledge.ts` reads richer entries with source, verification time, visibility and sensitivity. Query errors currently collapse into empty rows; unknown verification is not a trustworthy proof.
- `orchestrator.ts` has deterministic, operational intake, guest-agent, autopilot and LLM branches, including early sends. One late check alone would not cover them all.
- `communication-autopilot-v1-orchestrator.ts` also sends deterministic answers directly. Its passport/object/memory inputs need the same boundary.
- `knowledge-resolver.ts` renders operational object facts. Booking verification alone is not evidence that a fact is current.
- `classifier.ts` assembles an LLM prompt from passport, session and template strings without fact-level trust.
- Guest long-term memory is account scoped; historical preferences/events are not current booking, access, payment or maintenance proof.
- Conversation memory, CRM clues and guest-provided identifiers help resolve candidates; they must not authorize an account/property.
- Booking Ops builds proactive communication intents from booking/task state. Existing auto-send policy, scopes and emergency stop remain authoritative and must not be broadened.
- Booking/check-in/cleaning/legal/deposit state has its own canonical runtime. Missing source integration must require review rather than manufacture a negative/positive fact.
- Location evidence remains governed by frozen Wave 1; no scoring or paid-report changes are planned.

No live services, databases, messages or payments are used by this work.

## Implemented contract

`knowledge-provenance.ts` defines scoped scalar facts, origin, source/reference, original observation timestamp, optional validity interval, verification and sensitivity. Decisions are automatic-data eligibility, operator review or unusable. Data eligibility NEVER authorizes transport.

Identity includes account, property, booking, guest and session. The async resolver snapshots identity independently, passes frozen copies to dependencies, snapshots returned evidence and rechecks ownership. Each dependency has a five-second bound. Failed reads remain explicit failures; a verified ownership scope can still route a failure to the correct operator.

A foreign or malformed evidence item invalidates its batch. Missing is distinct from a negative boolean. Public property facts require nonempty strings. Unknown, synthetic, inferred, guest and cached origins cannot authorize operational truth. Guest memory cannot replace current canonical facts.

Freshness is measured from observation/verification time, never fetch time. Public property facts have a maximum 30-day lifetime, shortened by source expiry. Volatile state has a 60-second maximum, but still requires a dedicated authoritative adapter and review in this increment. Future observations and invalid dates fail closed.

Fresh verified sources with different values conflict. Canonical precedence applies only among equal, usable values; old guest memory never wins. Sensitive keys, sensitivity labels and obvious sensitive contents require review. Review summaries contain keys/reasons, not values, credentials, raw provider exceptions or guest messages.

## Runtime integration

- `knowledge-boundary.ts` resolves a unique persisted Telegram chat-to-reservation binding, verifies the exact property owner, and reads `object_knowledge_entries` with exact object/property identity.
- Public, high-confidence, explicitly verified owner/operator/system/provider entries retain their observation time and source validity. Unsupported/malformed/unknown entries cannot produce an approved factual draft.
- No alias, guessed account, name-only match, caller-supplied booking reference or legacy unbound property substitutes for binding.
- `orchestrator.ts` intercepts recognized operational fact requests before its normal guest answer branches.
- The eight specified questions are exercised through the actual orchestrator. Missing evidence creates an existing handoff-lock review and sends only a non-factual acknowledgement.
- Even eligible public facts become account-scoped suggested replies for the operator. This increment does NOT enable factual auto-send or change emergency-stop/scope policy.
- Review persistence must succeed before acknowledgement. The verified account is retained; Telegram reservation references are not misinterpreted as Booking Ops IDs.
- `reservation.ts` no longer contains or falls back to embedded demo bookings. Failed matching remains unresolved.

## Remaining completion blockers — WAVE 2 PARTIAL

This is NOT a complete Communication-wide guarantee and is NOT a rollout recommendation.

1. The request-to-fact router is a bounded RU/EN topic mapper. Unclassified operational wording and context-only follow-ups can still enter legacy generation. It is not a complete declaration of every fact used by every generator.
2. `classifier.ts:buildIntelligentPrompt` still assembles legacy passport/session/template strings outside this boundary. All such generators need approved-fact projections or an enforced review-only outcome.
3. Proactive `booking-ops/communication-orchestrator.ts` intents and their approval path are not yet integrated with this provenance contract. Their existing auto-send guards remain unchanged.
4. Non-Telegram binding, operational Booking Ops state, CRM notes, provider reservations, cleaning, legal and deposit adapters are not verified sources in this increment. Recognized requests require operator review; no missing state is promoted to ready/paid/refunded.
5. Unresolved ownership produces an unbound locked review, never a guessed tenant. Tenant operator APIs intentionally hide unbound records. A safe unidentified-conversation operational path still needs explicit acceptance.
6. The pre-existing orchestrator suite is not fully green. The frozen baseline independently reproduces 14 failures / 9 passes in 23 tests; this work does not repair unrelated routing-test assumptions.

Future integration must preserve operator-assisted first-pilot mode and must not treat these limitations as authorization to enable automated sending.

## Verification

- New provenance/resolver/source/delivery-comparison tests: 79/79 PASS (45 + 34).
- Actual orchestrator Wave 2 cases: 9/9 PASS, 23 unrelated cases excluded by the focused selector.
- Existing intelligence, handoff, operator review, memory tenancy and auto-send policy/executor tests: 84/84 PASS.
- Combined focused Communication set: 163/163 PASS across nine files; new orchestrator cases run separately.
- Frozen first-pilot regression: 124/124 PASS across eleven files.
- Wave 1 spatial / RU / paid-report / adversarial regression: 147/147 PASS across eight files.
- Total selected non-overlapping passing checks: 443 tests. This is not full-repository acceptance.
- Typecheck, changed-file ESLint and diff-check: PASS.
- The two prior untracked Wave 1 verification files were preserved and excluded from commits.
- Standard preflight initially included those pre-existing files. The same preflight builder on the exact Wave 2 change set is READY/yellow, with no protected paths or external actions.

No migrations or dependencies were added. No production/staging, live database, provider write, message, payment, secret, DNS, push, merge or deployment action was performed.
