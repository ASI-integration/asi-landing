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

## Completion status — WAVE 2 COMPLETE

The remaining PARTIAL gaps are closed for the active fact-dependent guest Communication and proactive Booking Ops paths in scope.

1. Contextual and unclassified guest turns can no longer fall through to legacy LLM/passport/template factual generation without the knowledge boundary. Closed social acts such as greetings and thanks remain fact-free deterministic replies.
2. The legacy communication-autopilot entrypoint independently applies the same boundary before using session/passport/template context.
3. Active proactive Booking Ops guest-draft paths now use the canonical Booking Ops knowledge adapter. Missing, stale, synthetic, malformed or foreign evidence produces review-only state instead of asserted guest text.
4. Guest lifecycle messages are operator drafts only. The lifecycle runtime rechecks account/property/booking/recipient binding and does not execute automatic guest delivery.
5. Existing auto-send execution is additionally fail-closed for guest intents: metadata, old policy state or an enabled scope cannot bypass the Wave 2 operator-review boundary.
6. Unidentified conversations have an explicit platform-operator quarantine. Tenant APIs still cannot see unbound reviews; platform operators may only acknowledge or send the fixed identity-clarification question without assigning a tenant or releasing AI automation.
7. Non-Telegram fact bindings remain review-only until an equivalent authoritative binding adapter exists. This is an intentional safe manual boundary, not automatic trust.

Wave 2 does **not** enable autonomous guest messaging. Transport permission remains separate from fact validity, and operator-assisted first-pilot semantics are preserved.

## Verification

- Wave 2 completion boundary and proactive-path contour: 207/207 PASS across ten files.
- Communication safety regression (Wave 0 tenancy, memory, handoff, operator review and auto-send): 100/100 PASS across nine files.
- Frozen first-pilot regression: 124/124 PASS across eleven files.
- Wave 1 spatial / RU / paid-report / adversarial regression: 147/147 PASS across eight files, including the independently archived 44-case remediation suite.
- Broader changed-surface contour: 292 PASS; 13 failures remain in two legacy files. The same 13 failures reproduce on the frozen 8db402c8 baseline, so they are classified as pre-existing test debt rather than Wave 2 regressions.
- Full legacy orchestrator comparison: current completion code has 13 failures versus 14 on 8db402c8, with zero new failures; one prior failure now passes.
- Typecheck, ESLint on the changed TypeScript/TSX surface and diff-check: PASS.
- Full-repository acceptance is not claimed.

Known baseline debt remains in the legacy autopilot-intake and production-acceptance workflow test assumptions. It does not authorize weakening the new trust boundary.

No migrations or dependencies were added. No production/staging, live database, provider write, message, payment, secret, DNS, push, merge or deployment action was performed.
