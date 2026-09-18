# ASI Capability Inventory (v2)

Canonical, evidence-based inventory of every identifiable and every strategically-relevant-but-not-yet-built ASI capability, for the RU market. This is grounding material for `asi-website-editor` and for anyone deciding what the public site may claim. It is not itself public copy and is not a roadmap commitment.

## Three independent questions — do not collapse them

Every capability in this document answers three separate questions, tracked as three separate fields. Confusing them is the single most common way a product-intelligence document goes wrong:

1. **Maturity** — what is actually built, and how strong is the evidence? (`LIVE_PROVEN` / `PILOT` / `BUILT_NEEDS_ACCEPTANCE` / `PLANNED` / `IDEA_ONLY` / `UNKNOWN`)
2. **Public claim status** — what is the site currently, or in the future, allowed to say about it? This lives in `CLAIMS_REGISTER.md`, not here, but is cross-referenced per capability.
3. **Strategic intent** — do we even want to build or grow this? (`CORE_NOW` / `NEXT_BUILD` / `RESEARCH` / `PARTNER_OR_INTEGRATE` / `HOLD` / `NOT_STRATEGIC`)

**Strategic intent is never derived from maturity.** `IDEA_ONLY + NEXT_BUILD` is a normal, expected combination (something not yet built that we do want to build next). `BUILT_NEEDS_ACCEPTANCE + HOLD` is equally normal (something real that exists but that we've decided not to invest further in right now). The Website Editor must read both fields independently — a capability's maturity tells a visitor what to expect *today*; strategic intent tells an internal reader what to expect *next*, and the two must never be conflated in public copy (maturity governs public claims; strategic intent never does — see `ROADMAP_PUBLIC_BOUNDARY.md`).

### Strategic intent values

- **CORE_NOW** — part of the current product's core; actively maintained and central to what's sold today.
- **NEXT_BUILD** — a confirmed next direction. In this document, "confirmed" means either an explicit owner instruction in this task, or an explicit statement in an existing internal architecture/roadmap document (e.g. `docs/blueprints/ASI-OPS-CONTOUR-BLUEPRINT.md`'s "Next Implementation Targets"). Where no such confirmation exists, an entry is marked `NEXT_BUILD (proposed — requires direct owner confirmation)` rather than presented as already decided.
- **RESEARCH** — before building, the economics or market fit need investigation (e.g. would an external data provider actually pay for itself; is there real operator demand).
- **PARTNER_OR_INTEGRATE** — building this in-house is probably the wrong move; a real, working RU or global service already exists and the better play is to connect to it and let ASI's cross-module context be the differentiator, not the base function.
- **HOLD** — not now; revisit later, no active investment.
- **NOT_STRATEGIC** — deliberately outside ASI's intended scope.

### Maturity status model (unchanged from v1 — kept strict, explained further)

- **LIVE_PROVEN** — real integration, exercised against real infrastructure/users, with evidence of routine (not one-off) operation.
- **BUILT_NEEDS_ACCEPTANCE** — real, non-trivial logic exists and is unit-tested, but the strongest evidence available is a mocked dependency (mocked Supabase, mocked LLM, mocked provider), not a live system or real user traffic.
- **PILOT** — real integration against a live external system exists and has been exercised outside a mock, but only at small/manual/test scale, not yet at routine guest/production scale.
- **PLANNED** — a data model, UI, or provider-metadata registry exists, but the actual integration/adapter is explicitly absent or marked as a placeholder in the code itself.
- **IDEA_ONLY** — no repository implementation found; at most discussed as a hypothesis or roadmap idea (including ideas raised for the first time in this inventory).
- **UNKNOWN** — insufficient evidence either way after a real search.

**`LIVE_PROVEN = 0` across this entire inventory does not mean "ASI doesn't work" or "these functions don't run."** It means precisely: no evidence was found in this repository of routine production operation, at real-guest scale, for any single capability, sufficient to clear this document's evidence bar. A `PILOT` (Telegram send) and a large `BUILT_NEEDS_ACCEPTANCE` core (real, tested logic against mocked infrastructure) both represent genuine engineering work and, in several cases, code that is more careful about safety and honesty than most software gets — they are simply a different, lower rung on this specific evidence ladder than "proven at scale," which is a deliberately high bar. Do not let a reader conflate "not LIVE_PROVEN" with "not functional."

A recurring, load-bearing pattern found across the codebase: the code itself uses `_placeholder` suffixes and explicit `honest_label`/`honest_notice` strings to mark what is *not* real. Where the code says "placeholder," this inventory treats the capability as **not** live, regardless of surrounding scaffolding. Most files named `*acceptance*.test.ts` run against a hand-built in-memory Supabase mock — "acceptance" in this repo usually means "the internal contract behaves correctly under test," not "proven against production." Only `.pg.integration.test.ts` files, a handful of manually-dispatched `*-live-acceptance*` scripts/workflows, and Playwright specs under `tests/` touch anything genuinely live.

## Summary by maturity

| Status | Count | Capabilities |
|---|---|---|
| LIVE_PROVEN | 0 | — |
| PILOT | 1 | #4 Telegram guest messaging (send) |
| BUILT_NEEDS_ACCEPTANCE | 15 | #1, #2, #3 (workflow layer), #5, #7, #8, #9, #10, #12, #13, #14, #15, #16, #17, #24 |
| PLANNED | 4 | #11, #18, #19, #23 (unified layer) |
| IDEA_ONLY | 16 | #3 (real МВД/deposit execution), #6, #20, #21, #22, #25, #26 (contractor marketplace), #27, #28, #29 (execution), #30, #31, #32, #34, #35, #36 |
| UNKNOWN | 0 | — |

36 capabilities inventoried (23 from v1 + 13 added in this revision). Counts above split a few v1 entries (#3, #26, #29) across two maturity levels because the workflow/checklist layer and the "real execution against an external system" layer genuinely differ in maturity within the same named capability — see each entry.

## Summary by strategic intent

| Strategic intent | Count | Capabilities |
|---|---|---|
| CORE_NOW | 9 | #1, #2, #3 (checklist layer), #4, #8, #9, #14, #17, #24 |
| NEXT_BUILD (confirmed via internal doc) | 1 | #36 Security/sensor ingestion — named explicitly in `ASI-OPS-CONTOUR-BLUEPRINT.md`'s "Next Implementation Targets" |
| NEXT_BUILD (proposed — requires direct owner confirmation) | 6 | #3 (real МВД filing), #20 Smart locks, #21 OTA payout reconciliation, #26 (maintenance/contractor routing beyond ticket creation), #31 Optimal-OTA-mix analysis, #33 SLA control (already real — proposed to promote to CORE_NOW once acceptance-tested) |
| RESEARCH | 6 | #13/#15 (external market-data/weather/events provider economics), #16 dashboard e2e investment level, #23 unified `PlatformDecision` schema, #27 Guest CRM scope, #28 Loyalty programs, #22 guest-facing payments |
| PARTNER_OR_INTEGRATE | 7 | #11 Channel manager/OTA (RU vendors already commoditize this), #18/#19 payment rails, #20 Smart locks (hardware+RU middleware, not build), #14/#15 cartography data sources (already integrate OSM/geocode providers), #34 Fiscal receipts (RU cloud-kassa providers), #4/#5/#6/#7 message delivery rails (Telegram/MAX/SMTP providers, not building a messaging network) |
| HOLD | 4 | #29 Upsell/cross-sell execution, #30 Direct-booking tooling, #32 Owner-statement generation, #35 Energy/utility tracking |
| NOT_STRATEGIC | 0 | none confidently assigned in this pass — see individual notes; several `HOLD` entries may resolve to `NOT_STRATEGIC` after research |

(Some capabilities appear once but span two intent rows because a sub-piece is confirmed core while another sub-piece is only proposed — see the entry text, not just this table, before quoting a number publicly.)

---

# Part 1 — Capabilities identified from the current repository (#1–#23)

*(Unchanged findings from v1, now with a Strategic Intent field added to each. Evidence citations are unchanged from the v1 pass; see git history for the original if needed.)*

## 1. Booking-ops lifecycle & task engine
- **Pain addressed:** operators lose track of where each booking stands once portfolios grow.
- **What ASI actually does:** real state machine with SLA/escalation math, event-sourced automation, worker task board.
- **Maturity:** BUILT_NEEDS_ACCEPTANCE.
- **Repository evidence:** `src/lib/booking-ops/lifecycle.ts`, `lifecycle-orchestrator.ts`, `lifecycle-autopilot.ts`, `automation-engine.ts`, `tasks.ts`.
- **Tests/acceptance evidence:** `booking-ops-e2e-acceptance.test.ts`, `golden-path-acceptance.test.ts` — mocked Supabase.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #1/#12.
- **Strategic intent:** CORE_NOW.
- **Related/dependencies:** #2, #3, #4/#5.
- **Caveat:** at least four parallel "ops" task/board generations coexist without a declared canonical one.

## 2. Turnover / cleaning / linen / inspection coordination
- **Pain addressed:** coordinating cleaner/linen/supplies/inspection between checkout and next check-in.
- **What ASI actually does:** real status chain gating check-in-instruction release; auto-links next eligible booking on checkout.
- **Maturity:** BUILT_NEEDS_ACCEPTANCE.
- **Repository evidence:** `src/lib/booking-ops/turnover.ts`, `physical-readiness-execution.ts`, `turnover-cleaning-activation.ts`.
- **Tests/acceptance evidence:** `turnover.test.ts`, `physical-readiness-execution.test.ts` — mocked Supabase.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #8. Cleaner dispatch is a manual draft only — no real automated notification.
- **Strategic intent:** CORE_NOW for the tracking/gating engine; see #26 for automated contractor dispatch (separate, not-yet-built piece).
- **Related/dependencies:** #1, #3, #25, #26.

## 3. Legal / deposit / МВД readiness gating
- **Pain addressed:** guest-registration (МВД), deposit, contract are legally/commercially expected and easy to skip.
- **What ASI actually does:** a real checklist/gating engine; every status implying a real external integration is explicitly `_placeholder`; every status settable today is `_manual` (operator self-attestation). No document storage (privacy-safe by design).
- **Maturity:** BUILT_NEEDS_ACCEPTANCE for the checklist/gating layer; **IDEA_ONLY** for real МВД e-filing, real deposit payment capture, or document verification — none exist.
- **Repository evidence:** `src/lib/booking-ops/guest-legal-deposit-mvd-execution.ts`.
- **Tests/acceptance evidence:** `guest-legal-deposit-mvd-execution.test.ts` (15 cases, explicitly assert drafts ≠ done).
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #7.
- **Strategic intent:** CORE_NOW for the checklist layer; **NEXT_BUILD (proposed — requires direct owner confirmation)** for real МВД e-filing specifically — this is one of the highest-conviction RU-market gaps found (see `PAIN_MAP.md` P5), but building a ЕПГУ e-filing client is a nontrivial regulatory-integration decision the owner should make explicitly, not something this document can decide for them.
- **Related/dependencies:** #1, #18, #20 (real МВД filing and real deposit capture are the two concrete next steps here).

## 4. Guest messaging — Telegram (send)
- **Pain addressed:** answering repetitive guest questions around the clock.
- **What ASI actually does:** real HTTP integration to the Telegram Bot API.
- **Maturity:** PILOT.
- **Repository evidence:** `src/lib/telegram.ts`; send sites in `orchestrator.ts`.
- **Tests/acceptance evidence:** `.github/workflows/telegram-guest-concierge-smoke.yml` (manual, "not quality gate"), `scripts/telegram-*-live-acceptance.mjs` — real API calls, test-chat scale only.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #1/#2.
- **Strategic intent:** CORE_NOW.
- **Related/dependencies:** #8, #9.

## 5. Guest messaging — Email
- **Maturity:** BUILT_NEEDS_ACCEPTANCE. Draft-only by default (`isEmailDraftOnly()`), with regression tests protecting that default.
- **Repository evidence:** `src/lib/communication/channels/email.ts`, `email-outbound-safe-mode.ts`.
- **Strategic intent:** PARTNER_OR_INTEGRATE (SMTP delivery is a commodity rail; no reason to build more than the adapter already built).
- **Related/dependencies:** #4.

## 6. Guest messaging — WhatsApp (outbound)
- **Maturity:** IDEA_ONLY — no outbound send adapter exists anywhere in the repository.
- **Market note:** Russia blocked WhatsApp nationwide on 2026-02-12 — moot for RU regardless of build status.
- **Strategic intent:** NOT_STRATEGIC for WhatsApp specifically (superseded by market events); if any capacity is invested, it should go to MAX (see #36-adjacent note) rather than WhatsApp.
- **Related/dependencies:** #7.

## 7. Guest messaging — WhatsApp (inbound voice transcription)
- **Maturity:** BUILT_NEEDS_ACCEPTANCE. Real inbound webhook + STT.
- **Repository evidence:** `src/lib/whatsapp/webhook.ts`, `media.ts`, `stt.ts`.
- **Strategic intent:** HOLD — channel itself is moot in Russia post-block; the transcription capability could be redirected to MAX/Telegram voice notes if that becomes a real guest behavior, but that's a `RESEARCH` question, not a build decision yet.
- **Related/dependencies:** #6, #4.

## 8. Guest identity & repeat-guest memory
- **Pain addressed:** recognizing a returning guest and gating sensitive disclosures on real identity confidence.
- **What ASI actually does:** real, DB-backed identity resolution with confidence scoring and a security gate (`canRevealTelegramAccessDetails()`, verified + confidence ≥ 0.85) before disclosing access details.
- **Maturity:** BUILT_NEEDS_ACCEPTANCE.
- **Repository evidence:** `src/lib/communication/telegram-guest-memory.ts`.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #1.
- **Strategic intent:** CORE_NOW — this is also the foundation #27 (Guest CRM) and #28 (loyalty) would need to build on.
- **Related/dependencies:** #4, #10 (explicitly separate — do not conflate), #27, #28.
- **Correction preserved from v1:** `src/lib/crm/` is NOT a guest CRM; this module is the real guest-facing identity/history piece.

## 9. LLM reply guardrails & escalation routing
- **Maturity:** BUILT_NEEDS_ACCEPTANCE for the guardrail/routing layer; the underlying language model is never invoked in these tests (fully mocked/scripted).
- **Repository evidence:** `comm-agent-acceptance-100.test.ts` (100-phrase matrix).
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #1.
- **Strategic intent:** CORE_NOW.
- **Related/dependencies:** #4, #8.

## 10. Owner/lead CRM & pilot rollout
- **Maturity:** BUILT_NEEDS_ACCEPTANCE. Internal-facing only (ASI's own sales/rollout pipeline, not a customer-facing feature).
- **Repository evidence:** `src/lib/crm/types.ts`, `pilot-rollout.ts` (pilot-capacity gate, default 4).
- **Strategic intent:** CORE_NOW (as internal tooling).
- **Related/dependencies:** #17.

## 11. Channel manager / OTA sync (named platforms)
- **Maturity:** PLANNED (bordering IDEA_ONLY for the named adapters). Every named OTA is `planned`/`on_request`/`partner_access_required`/`unknown` in the code's own registries.
- **Repository evidence:** `src/lib/channel-manager/registry.ts`, `src/lib/channel-connections/providers.ts`.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #6 — REJECT for any live-sync claim.
- **Strategic intent:** **PARTNER_OR_INTEGRATE.** Market research (`POSITIONING_MAP.md`) confirms RU channel management is "the most mature and least fragmented layer" in the market, already commoditized by Bnovo/RealtyCalendar/TravelLine at low cost. Building a competing OTA-sync engine from scratch is very unlikely to be the right use of engineering effort; the better path is almost certainly integrating with (or through) an existing RU channel manager and differentiating on what ASI does with the synced data (readiness gating, pricing context), not on the sync itself.
- **Related/dependencies:** #12, #13.

## 12. Manual-import channel/booking reconciliation engine
- **Maturity:** BUILT_NEEDS_ACCEPTANCE, with one component verified against real (disposable) Postgres (self-gating).
- **Repository evidence:** `channel-manager-live-core.ts` (3,078 lines; explicit "no real provider APIs" header).
- **Strategic intent:** CORE_NOW as internal safety infrastructure; feeds whatever channel-manager integration path (#11) is chosen.
- **Related/dependencies:** #1, #11.

## 13. Pricing recommendation engine
- **Maturity:** BUILT_NEEDS_ACCEPTANCE for the recommendation engine; explicit `_placeholder` markers on weather/events/market-data sources; not connected to any live OTA price push.
- **Repository evidence:** `pricing-intelligence-autopilot.ts`.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #5.
- **Strategic intent:** CORE_NOW for the engine itself; **RESEARCH** for whether to pay for a real external market-data/weather/events feed — `docs/platform-90-percent-roadmap.md` independently rates this area's honest ceiling at ~30–45% without such a feed, and that's an economics question (is the feed's cost justified by the pricing lift) before it's an engineering one.
- **Related/dependencies:** #14, #11 (price push destination), #21 (net-of-commission pricing).

## 14. Location scoring & report — residential
- **Maturity:** BUILT_NEEDS_ACCEPTANCE, trending PILOT for the scoring core. Self-enforcing architectural guards, golden-fixture regression tests, one real external data feed (EIS public-procurement SOAP client).
- **Repository evidence:** `location-decision-contract.ts`, `location-decision-anti-bypass.test.ts`.
- **Strategic intent:** CORE_NOW.
- **Related/dependencies:** #13.

## 15. Location scoring & report — commercial/retail
- **Maturity:** BUILT_NEEDS_ACCEPTANCE, internally rated lower ceiling (55–70%) than #14, blocked on real footfall/pedestrian-graph data.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #4 — must reuse `docs/commercial-product-positioning-v1.md`'s mandated honesty framing verbatim.
- **Strategic intent:** RESEARCH — whether a real footfall-data provider is worth its cost is exactly the kind of question that should be answered before promising a stronger commercial product; the existing internal doc already flags this as "the main bottleneck."
- **Related/dependencies:** #14.

## 16. Owner/operator dashboard UI
- **Maturity:** BUILT_NEEDS_ACCEPTANCE. Real, extensive (20+ sections, 18 API route groups); Playwright configs exist but full e2e coverage of the dashboard itself wasn't confirmed in the v1 pass.
- **Strategic intent:** CORE_NOW for what exists; **RESEARCH** for how much further e2e-acceptance investment this specific surface needs relative to other priorities.
- **Related/dependencies:** all customer-facing modules.

## 17. Object / pilot readiness gating (onboarding)
- **Maturity:** BUILT_NEEDS_ACCEPTANCE. Field-level readiness engine, stricter in production than dev/test.
- **Public-claim ceiling:** matches the existing public site's framing well — one of the better-supported claims in the inventory.
- **Strategic intent:** CORE_NOW.
- **Related/dependencies:** #1, #11 (the channel-manager leg of the pilot chain is metadata-only, per #11).

## 18. ASI's own recurring subscription billing (1000₽/object/month)
- **Maturity:** PLANNED for the recurring-billing loop specifically (pricing constant and YooKassa provider are real; no recurring loop against it was found — currently wired to the location-report product's payment step instead). BUILT_NEEDS_ACCEPTANCE for the underlying provider/webhook code.
- **Strategic intent:** CORE_NOW — this is table-stakes for the existing pilot→continuation commercial model and should not wait on any of the more exploratory items in this document.
- **Related/dependencies:** #3, #22, #34.

## 19. International (non-RU) Stripe billing lifecycle
- **Maturity:** BUILT_NEEDS_ACCEPTANCE (state machine, tested); explicitly gated off; different product line, not applicable to RU claims.
- **Strategic intent:** NOT_STRATEGIC for the RU market inventory (kept only because it's a real, separate product line the repository also contains).
- **Positioning flag:** contributes to a real brand-fragmentation risk — see `POSITIONING_MAP.md`/`CLAIMS_REGISTER.md` #18, and the newly-found EN marketing pages `src/app/features/communication/page.tsx` and `src/app/ota/page.tsx` (see "New findings" note at the end of this document).

## 20. Smart access / lock control
- **Maturity:** IDEA_ONLY — zero implementation found anywhere in the repository; only a guardrail regex that *blocks* sending a message that looks like it contains a door code pending legal readiness.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #9 — REJECT.
- **Strategic intent:** **NEXT_BUILD (proposed — requires direct owner confirmation), and PARTNER_OR_INTEGRATE on execution mechanism.** RU market research is unusually decisive here: no Western smart-lock vendor (RemoteLock, Operto) has a practical RU hardware/support ecosystem; the real RU path is TTLock/Tuya hardware plus a middleware layer (RentySoft is the concrete example found, at 350–1,500₽/lock/month — the single largest per-unit software cost identified in the whole market scan). ASI almost certainly should not build lock firmware or hardware integration from scratch; it should integrate with an existing TTLock/Tuya-capable middleware (build vs. buy conclusion below) and add the one thing such middleware doesn't have: ASI's own readiness gates (#3's legal/deposit/document checklist, #2's physical/cleaning readiness) deciding *when* a code may be issued, not just *how*.
- **Build/buy/integrate:** **integrate.** Building a lock-hardware or even a lock-middleware layer from scratch would duplicate RentySoft/TTLock-adjacent RU tooling that already works; the plausible ASI-specific value is entirely in the readiness-gate decision layer above it (see cross-module connections below), not in reimplementing the lock protocol.
- **Related/dependencies:** #2, #3.

## 21. OTA payout & commission reconciliation
- **Maturity:** IDEA_ONLY — no implementation; schema-only types in `src/lib/distribution/domain.ts`.
- **Public-claim ceiling:** REJECT (`CLAIMS_REGISTER.md` #10).
- **Strategic intent:** **NEXT_BUILD (proposed — requires direct owner confirmation).** This is the single highest-conviction market gap found in the entire research pass — no RU vendor surveyed (RealtyCalendar, Bnovo, TravelLine, Контур.Отель) appears to own multi-OTA payout/commission reconciliation either. Unlike locks or channel management, there is no obvious existing service to integrate with here — this looks like a genuine build opportunity, not an integration decision, though that conclusion should be re-checked with a short, targeted vendor search (a full search for RU "финансовая сверка"/"reconciliation as a service" products was not exhaustively performed) before committing engineering time.
- **Build/buy/integrate:** build (tentative) — no partner candidate identified; flag for a short confirming search before committing.
- **Related/dependencies:** #11, #13 (net-of-commission pricing), #31, #32.

## 22. Guest-facing booking payment / deposit processing
- **Maturity:** IDEA_ONLY beyond #3's manual-attestation placeholder.
- **Strategic intent:** RESEARCH — whether ASI should ever collect guest-facing payments (vs. staying out of the property's own payment flow entirely) is a real strategic/liability question, not just an engineering one; the internal `docs/agent-os/PRODUCT_CONTRACT.md` invariants already treat payment logic and legally-significant flows with extra caution, which supports investigating before building.
- **Related/dependencies:** #3, #18.

## 23. Cross-module `PlatformDecision` orchestration
- **Maturity:** PLANNED for the unified system; individual pairwise links are BUILT_NEEDS_ACCEPTANCE (already counted under their own capabilities — see the Cross-Module Connections section below).
- **Repository evidence:** `docs/platform-90-percent-roadmap.md` (45–60% achievable, schema not built); `ASI-OPS-CONTOUR-BLUEPRINT.md`'s "Next Implementation Targets."
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #12.
- **Strategic intent:** **RESEARCH.** The schema and priority-policy design is a real design investment before it's a coding task; committing to `NEXT_BUILD` without that design pass risks building the wrong abstraction.
- **Related/dependencies:** effectively all capabilities; see Cross-Module Connections below.

---

# Part 2 — Capabilities added in this revision (#24–#36)

These extend the inventory to cover the full operational surface named in this task, including functions with no current ASI implementation. Several were checked directly against the repository in this revision (not carried over from v1's research); where a new, real finding emerged, it's called out explicitly.

## 24. Reputation & review-recovery-context analysis — NEW FINDING (not in v1)
- **Pain addressed:** knowing whether a mid-stay problem was actually resolved before it turns into a public review, and how severe/urgent a given review is.
- **What ASI actually does:** a genuinely real, previously-missed module. `src/lib/partner-reputation/` ingests review-received events (`PartnerReviewReceivedEventV1`) and computes sentiment, severity, category (18 categories including cleanliness/maintenance/access/safety/payment), reputation risk, and — the important part — a `PartnerRecoveryContext` (`no_recovery_case` / `recovered_before_review` / `unrecovered_before_review` / `awaiting_guest_confirmation` / `multiple_recovery_cases`) with timestamped recovery-latency facts. The migration header explicitly states this module does **not** publish review replies, call a review provider, manipulate reviews, send guest messages, create tasks, or apply compensation — it is an analysis/tracking layer only.
- **Maturity:** BUILT_NEEDS_ACCEPTANCE, with a real Postgres integration test (`partner-reputation.pg.integration.test.ts`) that, like the channel-manager recovery test, self-gates and reports unverified if no disposable Postgres URL is configured.
- **Repository evidence:** `src/lib/partner-reputation/contract.ts`, `policy.ts`, `repository.ts`; migration `20260815210000_partner_review_reputation_engine_v1.sql`.
- **Public-claim ceiling:** may say ASI tracks whether a mid-stay issue was resolved before a review was received, and classifies review severity/category. Must not say ASI responds to reviews, contacts review platforms, or issues compensation — the migration itself disclaims all of these.
- **Strategic intent:** CORE_NOW for the analysis layer (it already exists and is real); RESEARCH for whether to build the missing pieces (an actual review-response mechanism, or a genuinely *proactive* "detect distress before it becomes a review" trigger — the current module analyzes recovery context after a review arrives, it does not yet act during the stay).
- **Related/dependencies:** #1 (booking lifecycle, source of recovery-latency timestamps), #9 (an in-stay escalation could feed a "recovered before review" outcome earlier).
- **Cross-module connection status:** **already exists** — this module is itself evidence that "reputation informed by whether the mid-stay problem was solved" (one of the connections the task asked to investigate) is real, not merely hypothetical, in at least this one place.

## 25. Photo-proof of cleaning/readiness
- **Maturity:** IDEA_ONLY — confirmed absent. `report_payload` on cleaning/inspection tasks (see #2) is a free-form JSON field; no actual image-upload pipeline was found.
- **Strategic intent:** RESEARCH — a real, common feature in RU competitor tooling per market research (RealtyCalendar's maid app has photo evidence); worth a build-vs-integrate decision once #2's dispatch mechanism (see #26) is decided, since photo capture likely belongs on whatever channel actually reaches the cleaner.
- **Related/dependencies:** #2, #26.

## 26. Maintenance / contractor dispatch beyond ticket creation
- **Maturity:** BUILT_NEEDS_ACCEPTANCE for maintenance-ticket creation and routing (`booking_maintenance_tickets`, part of #2's physical-readiness engine); IDEA_ONLY for any actual contractor marketplace, automated dispatch, or scheduling beyond the internal ticket.
- **Strategic intent:** **NEXT_BUILD (proposed — requires direct owner confirmation)** for closing the "manual draft only" gap in cleaner/contractor communication specifically (this is the one concrete area where a named RU competitor — RealtyCalendar's Автопилот, which auto-dispatches to a maid app and auto-rotates lock codes post-checkout — is confirmed to already out-execute ASI's current implementation; see `PAIN_MAP.md` P13). **PARTNER_OR_INTEGRATE** on the actual dispatch mechanism if it makes sense to reuse an existing RU field-service/task tool rather than build one.
- **Related/dependencies:** #2, #25.

## 27. Guest CRM / full guest relationship management
- **Maturity:** IDEA_ONLY as a distinct product — this is the genuine gap between #8 (real identity/repeat-stay tracking) and #10 (owner/lead CRM, confirmed in v1 to be a different system entirely). Nothing currently tracks guest preferences, cross-stay notes, or a queryable guest profile beyond the identity/confidence fields #8 already has.
- **Strategic intent:** RESEARCH — worth scoping explicitly as "build on top of #8" rather than a new system, once retention economics (see `CLAIMS_REGISTER.md` #14, marked EVIDENCE_NEEDED) are actually investigated; building a full guest-CRM layer before knowing whether retention economics justify it would be premature.
- **Related/dependencies:** #8, #28.

## 28. Loyalty programs / repeat-guest incentives
- **Maturity:** IDEA_ONLY. The only related repository text found is a FAQ answer (`src/components/FaqAccordion.tsx`) describing a **future** global guest blacklist to screen out problematic repeat guests — this is a fraud/risk-screening idea, not a loyalty/incentive program, and is explicitly already framed as future ("в будущих обновлениях").
- **Strategic intent:** HOLD, pending the same retention-economics research as #27.
- **Related/dependencies:** #8, #27.

## 29. Upsell / cross-sell (detection vs. execution)
- **What exists (confirmed in this revision):** real intent-classification. `src/lib/communication/intent.ts` defines an `upsell_request` intent category; `src/lib/communication/knowledge.ts` has an `upsells` field on the property-knowledge model; `classifier.ts` includes upsell data in its prompt context.
- **What does not exist:** any execution/fulfillment of an upsell (charging for it, confirming it, tracking it) — this is detection/classification only.
- **Maturity:** BUILT_NEEDS_ACCEPTANCE for detection/classification; **IDEA_ONLY** for execution.
- **Overclaiming flag (important):** `src/app/features/communication/page.tsx`, a live EN marketing page for the international product, currently states ASI *"Executes in-chat: upsells, payments, access codes, task dispatch."* Against this inventory's evidence, three of those four claims are not built: upsell *execution* (only detection exists), *payments* execution (no guest-facing payment execution exists anywhere, per #22), and *access codes* (no lock integration exists at all, per #20). This is a real, current overclaiming instance on a live page — flagged here for correction even though this task does not authorize editing that page (it is not RU public copy and not `src/app/ru/page.tsx`).
- **Strategic intent:** HOLD for execution, pending the same retention/guest-relationship research as #27/#28 — an upsell-execution feature is a natural extension of a real guest-CRM, not a good candidate to build ahead of it.
- **Related/dependencies:** #8, #22, #27.

## 30. Direct booking / OTA-dependency reduction tooling
- **What exists:** a UI label only — `direct_bookings` appears as a selectable channel option in the Telegram owner-onboarding wizard (`telegram-owner-onboarding-wizard.ts`), with no supporting booking-capture or direct-booking-site functionality behind it.
- **Maturity:** IDEA_ONLY.
- **Also found:** `src/app/ota/page.tsx` (EN marketing page) claims OTA connection leads to *"more direct bookings over time — which means less paid commission"* — this is a forward-looking claim about an effect, not a claim of a built direct-booking feature, and is less clearly wrong than #29's claims, but it still rests on OTA connectivity (#11) that isn't live either.
- **Strategic intent:** HOLD — a real direct-booking capability (a bookable property page/widget) is a substantial build; not clearly justified without first knowing whether reducing OTA dependency is actually a priority pain for target customers (see `PAIN_MAP.md` P2/P4) versus a story ASI tells about itself.
- **Related/dependencies:** #11, #21.

## 31. Optimal OTA mix / per-channel net-profitability analysis
- **Maturity:** IDEA_ONLY — no implementation; would need #21 (payout/commission data) as its foundation.
- **Strategic intent:** **NEXT_BUILD (proposed — requires direct owner confirmation)**, but sequenced strictly after #21 — this analysis has no data to run on until reconciliation exists.
- **Related/dependencies:** #21, #13.

## 32. Owner statement generation / automated owner reporting
- **What exists:** the dashboard (#16) shows live metrics; no automated formal owner-statement (revenue split, management-company reporting) generation was found.
- **Maturity:** IDEA_ONLY for the specific "generate an owner statement" capability, distinct from #16's live dashboard views.
- **Strategic intent:** HOLD — relevant mainly for management-company customers with owner-split obligations, a customer segment this inventory did not confirm as a current priority.
- **Related/dependencies:** #16, #21.

## 33. Staff task SLA control
- **What exists (confirmed in this revision):** real, tested SLA-severity tracking. `src/lib/booking-ops/operator-alerts.ts` computes SLA obligation keys (`sla:${condition.severity}:${deadlineAt}`) and `lifecycle-orchestrator.ts` creates urgent SLA obligations for unresolved blocking conditions (e.g. maintenance), tested in `lifecycle-orchestrator.test.ts` ("keeps unresolved blocking maintenance blocked and creates an urgent SLA obligation").
- **Maturity:** BUILT_NEEDS_ACCEPTANCE — this should have been included in v1's booking-ops entry (#1) explicitly; called out here as its own line because SLA control is a distinct capability question from general lifecycle tracking.
- **Strategic intent:** CORE_NOW — already real and already part of the core lifecycle engine; the "NEXT_BUILD (proposed)" tag in the summary table above refers only to promoting this specific piece through a dedicated acceptance pass, not to building it from scratch.
- **Related/dependencies:** #1.

## 34. Fiscal receipts / 54-ФЗ compliance (чеки, возвраты)
- **Maturity:** IDEA_ONLY. Grep for fiscalization/54-ФЗ/online-kassa terms found no matches in ASI's own code; the only "receipt"-named code (`snapshotReceipt` in `channel-manager-live-core.ts`) is an internal audit/hash artifact for the import-reconciliation engine, unrelated to fiscal receipts.
- **Market context:** RU market research identifies cloud-kassa providers (CloudKassir, Лайтбокс, Робокасса, PayKeeper, Business.ru) as the standard way RU operators handle this today, as a separate subscription.
- **Strategic intent:** **PARTNER_OR_INTEGRATE** — fiscalization is a regulated, provider-specific function with existing RU-market solutions; there is no plausible case for ASI building its own fiscal-receipt engine rather than integrating with an existing cloud-kassa API (the same logic already applied to payments via YooKassa, #18).
- **Related/dependencies:** #18, #21.

## 35. Energy / utility cost tracking
- **Maturity:** IDEA_ONLY — no repository evidence, and no market or pain evidence gathered in this research pass either.
- **Strategic intent:** HOLD, leaning NOT_STRATEGIC — no pain, no market signal, and no owner instruction identified this as a priority; listed for completeness per the task's request, not because evidence supports pursuing it. Should not be pursued without a specific reason surfacing first.
- **Related/dependencies:** none identified.

## 36. Security / sensor monitoring (охрана)
- **Maturity:** IDEA_ONLY in the operational sense (no sensor ingestion exists), though it is worth noting this is the one item in this new-capabilities list that has an existing, explicit mention in an internal architecture document rather than being introduced fresh here.
- **Repository evidence:** `ASI-OPS-CONTOUR-BLUEPRINT.md`'s "Next Implementation Targets" names **"Sensor ingestion — normalize noise/smoke/door sensor events into `IncidentRecord` via dedicated mappers."**
- **Strategic intent:** **NEXT_BUILD (confirmed via internal doc)** — this is the one capability in this document that can be marked confirmed-next-build without the "(proposed)" qualifier, because it is already named as a target in the canonical OPS architecture document, not merely inferred by this research pass. Note this is still short of a direct owner chat confirmation and should be verified as such before being treated as final.
- **Related/dependencies:** #23 (the incident/decision engine this would feed), #20 (a sensor-and-lock combination is a natural pairing, e.g. door-sensor-informed access logic).

---

# Cross-Module Connections Registry

For each pairing, the question asked was: *what changes if this function has access to the rest of ASI's context?* Each connection is marked by its own status — **EXISTS** (real, tested, in code today), **POSSIBLE** (no technical blocker, not built), or **PLANNED** (named as a target in an internal doc, not built) — independent of either module's own maturity rating.

| Connection | Status | Evidence / reasoning |
|---|---|---|
| Pricing ← location/audience signals | **EXISTS** | `pricing-intelligence-autopilot.ts` calls `getAudiencePricingWeights()`, informed by `property-audience-intelligence`, itself location-derived. Real, tested. |
| Check-in-instruction release ← physical readiness (cleaning) | **EXISTS** | `computePhysicalReadiness()` gates `canReleaseCheckInInstructions` — #2. |
| Check-in-instruction release ← legal/deposit/МВД readiness | **EXISTS** | `computeGuestLegalReadiness()` independently gates the same release — #3. Note: these are two *separate* real gates on the same release point, not yet unified into one combined readiness signal — a small, concrete step toward #23's aspiration. |
| Reputation risk ← whether a mid-stay issue was resolved | **EXISTS** | `partner-reputation`'s `PartnerRecoveryContext` — #24. This is a genuinely important finding: one of the task's own example connections ("Репутация может знать, была ли проблема во время проживания и была ли она решена") is not hypothetical — it is real, shipped code. |
| Guest reply ← guest identity/history/booking/readiness | **EXISTS (partially)** | The reply-composition path (#4/#9) already consumes guest identity (#8); it does not yet consume cleaning-readiness state or a genuine guest-history/preference profile (#27 doesn't exist yet), so this connection is real for identity but only POSSIBLE for the fuller "history + readiness"-aware version the task describes. |
| Cleaning ← actual checkout event and next check-in timing | **EXISTS** | `turnover-cleaning-activation.ts`'s `selectEarliestEligibleUpcomingBooking()` — #2. |
| Lock/access ← readiness gates (legal + physical) | **POSSIBLE** | No lock integration exists (#20) to receive such a signal, but the gating pattern it would plug into (#3, #2) is already real and already produces exactly the kind of combined go/no-go signal a lock-release decision would need. This is arguably the cleanest "build the connective layer, integrate the base function" opportunity in the whole inventory. |
| OTA evaluation ← net profitability after commission/fees, not gross booking count | **PLANNED** | Requires #21 (not built) and #11 (not live) both. |
| Pricing ← demand forecast / events / weather / booking window / occupancy / competitors | **PARTIALLY EXISTS** | Day-of-week, seasonality, lead-time, competitor-median, and supply factors are real and computed (#13); weather/events/market-data sources are explicit code-level `_placeholder`s — real for four of roughly seven named signal types, placeholder for the rest. |
| Escalation/support ← full guest and booking context | **EXISTS** | The escalation path already carries booking/object context per #9's tested routing; it is the *reputation-before-the-fact* proactive trigger (detecting distress mid-stay and intervening before checkout, as distinct from #24's after-the-review analysis) that is **POSSIBLE**, not yet built. |

---

# New findings from this revision worth flagging beyond the capability list itself

1. **`src/app/features/communication/page.tsx`** (EN, international/guestautopilot marketing) claims ASI *"Executes in-chat: upsells, payments, access codes, task dispatch"* — three of four listed executions are not built per this inventory (#20, #22, #29). This is a live overclaiming instance on a real page, not a hypothetical risk.
2. **`src/app/ota/page.tsx`** (EN) claims OTA connection lets "ASI run bookings, pricing, and guest flows end-to-end" — inconsistent with #11's PLANNED status for any named OTA.
3. Neither page is RU public copy and neither is edited by this task (out of scope per instructions), but both should be treated as known claims-register violations for whoever next reviews the EN/international site, and reinforce `POSITIONING_MAP.md`'s existing observation that the EN site is systematically more aspirational than the RU site.
