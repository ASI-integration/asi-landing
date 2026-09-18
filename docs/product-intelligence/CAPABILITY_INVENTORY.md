# ASI Capability Inventory (v3)

Canonical, evidence-based inventory of every identifiable and every strategically-relevant-but-not-yet-built ASI capability, for the RU market. This is grounding material for `asi-website-editor` and for anyone deciding what the public site may claim. It is not itself public copy and is not a roadmap commitment.

## Four independent questions — do not collapse them

Every capability in this document answers four separate questions, tracked as four separate fields. Confusing them is the single most common way a product-intelligence document goes wrong:

1. **Maturity** — what is actually built, and how strong is the evidence? (`LIVE_PROVEN` / `PILOT` / `BUILT_NEEDS_ACCEPTANCE` / `PLANNED` / `IDEA_ONLY` / `UNKNOWN`)
2. **Public claim status** — what is the site currently, or in the future, allowed to say about it? This lives in `CLAIMS_REGISTER.md`, not here, but is cross-referenced per capability.
3. **Strategic intent** — do we even want this, and by what mechanism (build it, integrate someone else's, research first, hold, or explicitly not)? (`CORE_NOW` / `NEXT_BUILD` / `ROADMAP_CONFIRMED` / `RESEARCH` / `PARTNER_OR_INTEGRATE` / `HOLD` / `NOT_STRATEGIC`)
4. **Roadmap horizon** — separately from *whether* we want it, *when* is it realistically expected to move? (`NOW` / `NEXT` / `LATER` / `RESEARCH` / `UNDECIDED`)

**None of these fields is derived from another.** `IDEA_ONLY + NEXT_BUILD + NEXT` is a normal, expected combination (nothing built yet, confirmed as the next thing to build, expected soon). `BUILT_NEEDS_ACCEPTANCE + HOLD + UNDECIDED` is equally normal (something real that exists but that we've decided not to invest further in, with no revisit date set). `IDEA_ONLY + ROADMAP_CONFIRMED + LATER` is also normal (the owner has confirmed it belongs in the target system, but it is explicitly not next in the development sequence). The Website Editor must read all four fields independently — Maturity tells a visitor what to expect *today*; Strategic Intent and Roadmap Horizon tell an internal reader what to expect, and by when, but **neither of them ever governs public copy** (only Maturity, via Public Claim Status in `CLAIMS_REGISTER.md`, does — see `ROADMAP_PUBLIC_BOUNDARY.md`'s explicit warning against leaking strategic intent or timing into present-tense or even beta claims).

### Strategic intent values

- **CORE_NOW** — part of the current product's core; actively maintained and central to what's sold today.
- **NEXT_BUILD** — genuinely next in the development sequence — not merely desirable, but confirmed (by explicit owner instruction, in this task or a later one) as what gets worked on next. Do not use this value for every capability that would eventually be nice to have; that is what `ROADMAP_CONFIRMED` is for.
- **ROADMAP_CONFIRMED** — the owner confirms this capability should become part of ASI's target system, but it is **not** necessarily next in the development sequence. Use this for "yes, eventually, this belongs" decisions that are not yet sequencing decisions.
- **RESEARCH** — before building (or even before confirming it belongs on the roadmap at all), the economics, market fit, or a specific technical/regulatory question needs investigation.
- **PARTNER_OR_INTEGRATE** — building this in-house is probably the wrong move; a real, working RU or global service already exists (or could exist) and the better play is to connect to it and let ASI's cross-module context be the differentiator, not the base function.
- **HOLD** — not now; revisit later, no active investment, no confirmed roadmap placement either way.
- **NOT_STRATEGIC** — deliberately outside ASI's intended scope.

### Roadmap horizon values

- **NOW** — already live, or actively being worked on as part of the current core.
- **NEXT** — the next thing in the actual development sequence once current work clears.
- **LATER** — confirmed as wanted, but explicitly not next; a later phase.
- **RESEARCH** — the open question is timing-blocking: horizon cannot be set until a research question is answered.
- **UNDECIDED** — no sequencing decision has been made yet, and none should be inferred from Strategic Intent alone.

**This inventory does not invent owner confirmations.** Where the owner has explicitly confirmed a Strategic Intent or Roadmap Horizon value (in this task or a prior one), the entry says so and cites the instruction. Where no such confirmation exists, the entry is marked with an explicit `(proposed — requires direct owner confirmation)` qualifier rather than presented as decided. As of this revision, six capabilities carry an owner-confirmed Strategic Intent/Roadmap Horizon pair (see the "Owner-confirmed reclassifications in this revision" note before Part 1); everything else remains proposed.

### Maturity status model (unchanged since v1 — kept strict, explained further)

- **LIVE_PROVEN** — real integration, exercised against real infrastructure/users, with evidence of routine (not one-off) operation.
- **BUILT_NEEDS_ACCEPTANCE** — real, non-trivial logic exists and is unit-tested, but the strongest evidence available is a mocked dependency (mocked Supabase, mocked LLM, mocked provider), not a live system or real user traffic.
- **PILOT** — real integration against a live external system exists and has been exercised outside a mock, but only at small/manual/test scale, not yet at routine guest/production scale.
- **PLANNED** — a data model, UI, or provider-metadata registry exists, but the actual integration/adapter is explicitly absent or marked as a placeholder in the code itself.
- **IDEA_ONLY** — no repository implementation found; at most discussed as a hypothesis or roadmap idea (including ideas raised for the first time in this inventory).
- **UNKNOWN** — insufficient evidence either way after a real search.

**`LIVE_PROVEN = 0` across this entire inventory does not mean "ASI doesn't work" or "these functions don't run."** It means precisely: no evidence was found in this repository of routine production operation, at real-guest scale, for any single capability, sufficient to clear this document's evidence bar. A `PILOT` (Telegram send) and a large `BUILT_NEEDS_ACCEPTANCE` core (real, tested logic against mocked infrastructure) both represent genuine engineering work and, in several cases, code that is more careful about safety and honesty than most software gets — they are simply a different, lower rung on this specific evidence ladder than "proven at scale," which is a deliberately high bar. Do not let a reader conflate "not LIVE_PROVEN" with "not functional."

A recurring, load-bearing pattern found across the codebase: the code itself uses `_placeholder` suffixes and explicit `honest_label`/`honest_notice` strings to mark what is *not* real. Where the code says "placeholder," this inventory treats the capability as **not** live, regardless of surrounding scaffolding. Most files named `*acceptance*.test.ts` run against a hand-built in-memory Supabase mock — "acceptance" in this repo usually means "the internal contract behaves correctly under test," not "proven against production." Only `.pg.integration.test.ts` files, a handful of manually-dispatched `*-live-acceptance*` scripts/workflows, and Playwright specs under `tests/` touch anything genuinely live.

## Owner-confirmed reclassifications in this revision

The following six decisions were given explicitly by the owner in this task and are treated as confirmed, not proposed. **None of these is a public promise or a scheduling commitment beyond what's stated** — several are explicitly qualified by the owner as not implying immediate development.

| # | Capability | Strategic intent | Roadmap horizon | Owner's own caveat |
|---|---|---|---|---|
| #20 | Smart locks/access | PARTNER_OR_INTEGRATE (ASI owns the access-decision layer: when/who/how long/under what readiness conditions; physical execution belongs to an integrated lock provider) | LATER | — |
| #3 (МВД sub-piece) | Real МВД e-filing | PARTNER_OR_INTEGRATE (research existing APIs/providers/integration routes first; do not assume ASI must build the whole government-facing transport layer itself) | RESEARCH | — |
| #21 | OTA payout/commission reconciliation | NEXT_BUILD | UNDECIDED | explicitly **not** a promise of immediate development, pending a separate task/roadmap sequencing decision |
| #26 | Cleaner/contractor dispatch (continuation of the existing Booking Ops/turnover contour) | NEXT_BUILD | UNDECIDED | no explicit horizon given; treated the same as #21 rather than assumed to be scheduled |
| #31 | Optimal OTA mix / channel economics | RESEARCH | RESEARCH | needs confirmed data and economics first (depends on #21 existing) |
| #36 | Security/sensor ingestion | split: hardware/sensors = PARTNER_OR_INTEGRATE; the interpretation/decision/escalation software layer = NEXT_BUILD (already named in `ASI-OPS-CONTOUR-BLUEPRINT.md`'s "Next Implementation Targets," which the owner's own carve-out ("unless an existing approved internal architecture requires a narrower classification") explicitly covers) | hardware: LATER; software layer: NEXT | — |

## Summary by maturity

| Status | Count | Capabilities |
|---|---|---|
| LIVE_PROVEN | 0 | — |
| PILOT | 1 | #4 Telegram guest messaging (send) |
| BUILT_NEEDS_ACCEPTANCE | 15 | #1, #2, #3 (workflow layer), #5, #7, #8, #9, #10, #12, #13, #14, #15, #16, #17, #24 |
| PLANNED | 4 | #11, #18, #19, #23 (unified layer) |
| IDEA_ONLY | 16 | #3 (real МВД/deposit execution), #6, #20, #21, #22, #25, #26 (contractor marketplace), #27, #28, #29 (execution), #30, #31, #32, #34, #35, #36 |
| UNKNOWN | 0 | — |

36 capabilities inventoried. Counts split a few entries (#3, #26, #29) across two maturity levels because the workflow/checklist layer and the "real execution against an external system" layer genuinely differ in maturity within the same named capability — see each entry.

## Summary by strategic intent

| Strategic intent | Count | Capabilities |
|---|---|---|
| CORE_NOW | 9 | #1, #2, #3 (checklist layer), #4, #8, #9, #14, #17, #24 |
| NEXT_BUILD | 3 | #21 OTA payout reconciliation (owner-confirmed), #26 Cleaner/contractor dispatch (owner-confirmed), #36 software layer (named in internal architecture doc, owner-reaffirmed) |
| ROADMAP_CONFIRMED | 0 | none currently assigned this exact value alone — the owner's six decisions this revision each paired a more specific mechanism (`PARTNER_OR_INTEGRATE`, `NEXT_BUILD`, `RESEARCH`) with a horizon, rather than leaving a capability at the generic "confirmed but no mechanism decided" level. This value remains available for future owner decisions that confirm direction without yet deciding build-vs-integrate. |
| RESEARCH | 6 | #13/#15 (external market-data/weather/events provider economics), #16 dashboard e2e investment level, #23 unified `PlatformDecision` schema, #27 Guest CRM scope, #28 Loyalty programs, #31 Optimal-OTA-mix analysis (owner-confirmed) |
| PARTNER_OR_INTEGRATE | 8 | #3 real МВД filing (owner-confirmed), #11 Channel manager/OTA, #18/#19 payment rails, #20 Smart locks (owner-confirmed), #14/#15 cartography data sources, #34 Fiscal receipts, #4/#5/#6/#7 message delivery rails, #36 hardware/sensors (owner-confirmed) |
| HOLD | 4 | #29 Upsell/cross-sell execution, #30 Direct-booking tooling, #32 Owner-statement generation, #35 Energy/utility tracking |
| NOT_STRATEGIC | 1 | #19 International Stripe billing (different product line, not applicable to the RU inventory) |

(Some capabilities appear once but span two intent rows because a sub-piece is confirmed core while another sub-piece follows a different mechanism — see the entry text, not just this table, before quoting a number publicly. #22 guest-facing payments, previously listed under RESEARCH, remains RESEARCH — no owner instruction changed it this revision.)

## Summary by roadmap horizon

| Horizon | Count | Capabilities |
|---|---|---|
| NOW | 22 | every `CORE_NOW` capability (#1, #2, #3 checklist layer, #4, #8, #9, #14, #17, #24) plus every `PARTNER_OR_INTEGRATE` capability whose integration is already built and live-ish (#5, #7 as channel rails, #11's manual-import path via #12, #18's YooKassa code, #14/#15's OSM/geocode integrations) plus #10, #12, #16 |
| NEXT | 1 | #36 software/interpretation layer (owner-confirmed) |
| LATER | 3 | #20 Smart locks (owner-confirmed), #29, #30, #32 (informally leaning later, not owner-confirmed — see individual entries) |
| RESEARCH | 8 | #3 real МВД filing (owner-confirmed), #13/#15 external data-provider economics, #16 e2e investment level, #22, #23, #27, #31 (owner-confirmed) |
| UNDECIDED | 2 | #21 (owner-confirmed as explicitly not scheduled), #26 (treated the same way), plus #6, #28, #35 and #19 which have no forward horizon at all (moot/not-strategic) |

(This table double-counts a little by design — a few entries have a horizon for one sub-piece and a different one for another, exactly as with the strategic-intent table above; read the entry, not just the count, before quoting a specific number.)

---

# Part 1 — Capabilities identified from the current repository (#1–#23)

## 1. Booking-ops lifecycle & task engine
- **Pain addressed:** operators lose track of where each booking stands once portfolios grow.
- **What ASI actually does:** real state machine with SLA/escalation math, event-sourced automation, worker task board.
- **Maturity:** BUILT_NEEDS_ACCEPTANCE.
- **Repository evidence:** `src/lib/booking-ops/lifecycle.ts`, `lifecycle-orchestrator.ts`, `lifecycle-autopilot.ts`, `automation-engine.ts`, `tasks.ts`.
- **Tests/acceptance evidence:** `booking-ops-e2e-acceptance.test.ts`, `golden-path-acceptance.test.ts` — mocked Supabase.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #1/#12.
- **Strategic intent:** CORE_NOW.
- **Roadmap horizon:** NOW.
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
- **Roadmap horizon:** NOW for the tracking engine; see #26 for the dispatch piece.
- **Related/dependencies:** #1, #3, #25, #26.

## 3. Legal / deposit / МВД readiness gating
- **Pain addressed:** guest-registration (МВД), deposit, contract are legally/commercially expected and easy to skip.
- **What ASI actually does:** a real checklist/gating engine; every status implying a real external integration is explicitly `_placeholder`; every status settable today is `_manual` (operator self-attestation). No document storage (privacy-safe by design).
- **Maturity:** BUILT_NEEDS_ACCEPTANCE for the checklist/gating layer; **IDEA_ONLY** for real МВД e-filing, real deposit payment capture, or document verification — none exist.
- **Repository evidence:** `src/lib/booking-ops/guest-legal-deposit-mvd-execution.ts`.
- **Tests/acceptance evidence:** `guest-legal-deposit-mvd-execution.test.ts` (15 cases, explicitly assert drafts ≠ done).
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #7.
- **Strategic intent:** CORE_NOW for the checklist layer. **For real МВД e-filing specifically — owner-confirmed this revision: `PARTNER_OR_INTEGRATE`.** The owner's instruction is explicit: ASI should eventually close this process for the RU operator, but must first research existing APIs/providers/integration routes, and must not assume it needs to build the entire government-facing transport layer itself (see `POSITIONING_MAP.md`'s build/buy/integrate map, updated to match).
- **Roadmap horizon:** NOW for the checklist layer; **RESEARCH** for the real-filing piece (owner-confirmed — the provider/API landscape must be understood before any build-vs-integrate mechanism can even be chosen, let alone sequenced).
- **Related/dependencies:** #1, #18, #20 (real МВД filing and real deposit capture are the two concrete next steps here).

## 4. Guest messaging — Telegram (send)
- **Pain addressed:** answering repetitive guest questions around the clock.
- **What ASI actually does:** real HTTP integration to the Telegram Bot API.
- **Maturity:** PILOT.
- **Repository evidence:** `src/lib/telegram.ts`; send sites in `orchestrator.ts`.
- **Tests/acceptance evidence:** `.github/workflows/telegram-guest-concierge-smoke.yml` (manual, "not quality gate"), `scripts/telegram-*-live-acceptance.mjs` — real API calls, test-chat scale only.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #1/#2.
- **Strategic intent:** CORE_NOW.
- **Roadmap horizon:** NOW.
- **Related/dependencies:** #8, #9.

## 5. Guest messaging — Email
- **Maturity:** BUILT_NEEDS_ACCEPTANCE. Draft-only by default (`isEmailDraftOnly()`), with regression tests protecting that default.
- **Repository evidence:** `src/lib/communication/channels/email.ts`, `email-outbound-safe-mode.ts`.
- **Strategic intent:** PARTNER_OR_INTEGRATE (SMTP delivery is a commodity rail; no reason to build more than the adapter already built).
- **Roadmap horizon:** NOW (already integrated, in draft-only mode).
- **Related/dependencies:** #4.

## 6. Guest messaging — WhatsApp (outbound)
- **Maturity:** IDEA_ONLY — no outbound send adapter exists anywhere in the repository.
- **Market note:** Russia blocked WhatsApp nationwide on 2026-02-12 — moot for RU regardless of build status.
- **Strategic intent:** NOT_STRATEGIC for WhatsApp specifically (superseded by market events); if any capacity is invested, it should go to MAX (see #36-adjacent note) rather than WhatsApp.
- **Roadmap horizon:** UNDECIDED (moot pending any future decision to invest in MAX instead).
- **Related/dependencies:** #7.

## 7. Guest messaging — WhatsApp (inbound voice transcription)
- **Maturity:** BUILT_NEEDS_ACCEPTANCE. Real inbound webhook + STT.
- **Repository evidence:** `src/lib/whatsapp/webhook.ts`, `media.ts`, `stt.ts`.
- **Strategic intent:** HOLD — channel itself is moot in Russia post-block; the transcription capability could be redirected to MAX/Telegram voice notes if that becomes a real guest behavior, but that's a `RESEARCH` question, not a build decision yet.
- **Roadmap horizon:** UNDECIDED.
- **Related/dependencies:** #6, #4.

## 8. Guest identity & repeat-guest memory
- **Pain addressed:** recognizing a returning guest and gating sensitive disclosures on real identity confidence.
- **What ASI actually does:** real, DB-backed identity resolution with confidence scoring and a security gate (`canRevealTelegramAccessDetails()`, verified + confidence ≥ 0.85) before disclosing access details.
- **Maturity:** BUILT_NEEDS_ACCEPTANCE.
- **Repository evidence:** `src/lib/communication/telegram-guest-memory.ts`.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #1.
- **Strategic intent:** CORE_NOW — this is also the foundation #27 (Guest CRM) and #28 (loyalty) would need to build on.
- **Roadmap horizon:** NOW.
- **Related/dependencies:** #4, #10 (explicitly separate — do not conflate), #27, #28.
- **Correction preserved from v1:** `src/lib/crm/` is NOT a guest CRM; this module is the real guest-facing identity/history piece.

## 9. LLM reply guardrails & escalation routing
- **Maturity:** BUILT_NEEDS_ACCEPTANCE for the guardrail/routing layer; the underlying language model is never invoked in these tests (fully mocked/scripted).
- **Repository evidence:** `comm-agent-acceptance-100.test.ts` (100-phrase matrix).
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #1.
- **Strategic intent:** CORE_NOW.
- **Roadmap horizon:** NOW.
- **Related/dependencies:** #4, #8.

## 10. Owner/lead CRM & pilot rollout
- **Maturity:** BUILT_NEEDS_ACCEPTANCE. Internal-facing only (ASI's own sales/rollout pipeline, not a customer-facing feature).
- **Repository evidence:** `src/lib/crm/types.ts`, `pilot-rollout.ts` (pilot-capacity gate, default 4).
- **Strategic intent:** CORE_NOW (as internal tooling).
- **Roadmap horizon:** NOW.
- **Related/dependencies:** #17.

## 11. Channel manager / OTA sync (named platforms)
- **Maturity:** PLANNED (bordering IDEA_ONLY for the named adapters). Every named OTA is `planned`/`on_request`/`partner_access_required`/`unknown` in the code's own registries.
- **Repository evidence:** `src/lib/channel-manager/registry.ts`, `src/lib/channel-connections/providers.ts`.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #6 — REJECT for any live-sync claim.
- **Strategic intent:** **PARTNER_OR_INTEGRATE.** Market research (`POSITIONING_MAP.md`) confirms RU channel management is "the most mature and least fragmented layer" in the market, already commoditized by Bnovo/RealtyCalendar/TravelLine. Building a competing OTA-sync engine from scratch is very unlikely to be the right use of engineering effort; the better path is almost certainly integrating with (or through) an existing RU channel manager and differentiating on what ASI does with the synced data (readiness gating, pricing context), not on the sync itself.
- **Roadmap horizon:** UNDECIDED (no specific integration target chosen yet).
- **Related/dependencies:** #12, #13.

## 12. Manual-import channel/booking reconciliation engine
- **Maturity:** BUILT_NEEDS_ACCEPTANCE, with one component verified against real (disposable) Postgres (self-gating).
- **Repository evidence:** `channel-manager-live-core.ts` (3,078 lines; explicit "no real provider APIs" header).
- **Strategic intent:** CORE_NOW as internal safety infrastructure; feeds whatever channel-manager integration path (#11) is chosen.
- **Roadmap horizon:** NOW.
- **Related/dependencies:** #1, #11.

## 13. Pricing recommendation engine
- **Maturity:** BUILT_NEEDS_ACCEPTANCE for the recommendation engine; explicit `_placeholder` markers on weather/events/market-data sources; not connected to any live OTA price push.
- **Repository evidence:** `pricing-intelligence-autopilot.ts`.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #5.
- **Strategic intent:** CORE_NOW for the engine itself; **RESEARCH** for whether to pay for a real external market-data/weather/events feed — `docs/platform-90-percent-roadmap.md` independently rates this area's honest ceiling at ~30–45% without such a feed, and that's an economics question before it's an engineering one.
- **Roadmap horizon:** NOW for the engine; RESEARCH for the external-feed question.
- **Related/dependencies:** #14, #11 (price push destination), #21 (net-of-commission pricing).

## 14. Location scoring & report — residential
- **Maturity:** BUILT_NEEDS_ACCEPTANCE, trending PILOT for the scoring core. Self-enforcing architectural guards, golden-fixture regression tests, one real external data feed (EIS public-procurement SOAP client).
- **Repository evidence:** `location-decision-contract.ts`, `location-decision-anti-bypass.test.ts`.
- **Strategic intent:** CORE_NOW.
- **Roadmap horizon:** NOW.
- **Related/dependencies:** #13.

## 15. Location scoring & report — commercial/retail
- **Maturity:** BUILT_NEEDS_ACCEPTANCE, internally rated lower ceiling (55–70%) than #14, blocked on real footfall/pedestrian-graph data.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #4 — must reuse `docs/commercial-product-positioning-v1.md`'s mandated honesty framing verbatim.
- **Strategic intent:** RESEARCH — whether a real footfall-data provider is worth its cost is exactly the kind of question that should be answered before promising a stronger commercial product; the existing internal doc already flags this as "the main bottleneck."
- **Roadmap horizon:** RESEARCH.
- **Related/dependencies:** #14.

## 16. Owner/operator dashboard UI
- **Maturity:** BUILT_NEEDS_ACCEPTANCE. Real, extensive (20+ sections, 18 API route groups); Playwright configs exist but full e2e coverage of the dashboard itself wasn't confirmed.
- **Strategic intent:** CORE_NOW for what exists; **RESEARCH** for how much further e2e-acceptance investment this specific surface needs relative to other priorities.
- **Roadmap horizon:** NOW for existing functionality; RESEARCH for the e2e-investment question.
- **Related/dependencies:** all customer-facing modules.

## 17. Object / pilot readiness gating (onboarding)
- **Maturity:** BUILT_NEEDS_ACCEPTANCE. Field-level readiness engine, stricter in production than dev/test.
- **Public-claim ceiling:** matches the existing public site's framing well — one of the better-supported claims in the inventory.
- **Strategic intent:** CORE_NOW.
- **Roadmap horizon:** NOW.
- **Related/dependencies:** #1, #11 (the channel-manager leg of the pilot chain is metadata-only, per #11).

## 18. ASI's own recurring subscription billing (1000₽/object/month)
- **Maturity:** PLANNED for the recurring-billing loop specifically (pricing constant and YooKassa provider are real; no recurring loop against it was found — currently wired to the location-report product's payment step instead). BUILT_NEEDS_ACCEPTANCE for the underlying provider/webhook code.
- **Strategic intent:** CORE_NOW — this is table-stakes for the existing pilot→continuation commercial model.
- **Roadmap horizon:** NOW (the underlying provider code is live; finishing the recurring loop is treated as ordinary current-core work, not a separate roadmap decision).
- **Related/dependencies:** #3, #22, #34.

## 19. International (non-RU) Stripe billing lifecycle
- **Maturity:** BUILT_NEEDS_ACCEPTANCE (state machine, tested); explicitly gated off; different product line, not applicable to RU claims.
- **Strategic intent:** NOT_STRATEGIC for the RU market inventory (kept only because it's a real, separate product line the repository also contains).
- **Roadmap horizon:** UNDECIDED/not applicable to the RU roadmap.
- **Positioning flag:** contributes to a real brand-fragmentation risk — see `POSITIONING_MAP.md`/`CLAIMS_REGISTER.md` #18, and the EN marketing pages `src/app/features/communication/page.tsx` and `src/app/ota/page.tsx` (see "New findings" note at the end of this document).

## 20. Smart access / lock control
- **Maturity:** IDEA_ONLY — zero implementation found anywhere in the repository; only a guardrail regex that *blocks* sending a message that looks like it contains a door code pending legal readiness.
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #9 — REJECT.
- **Strategic intent:** **Owner-confirmed this revision: `PARTNER_OR_INTEGRATE`.** ASI should not build its own lock hardware or a low-level lock ecosystem. ASI is to own the decision layer — when access may be opened, for whom, for how long, and under what readiness conditions (see #3's legal/deposit checklist and #2's physical/cleaning readiness) — while physical execution is delegated to an integrated lock provider. RU market research supports this direction independently: the real RU path is TTLock/Tuya hardware plus a middleware layer (RentySoft is the concrete example found).
- **Roadmap horizon:** **LATER (owner-confirmed).**
- **Build/buy/integrate:** integrate — see `POSITIONING_MAP.md`'s build/buy/integrate map.
- **Related/dependencies:** #2, #3.

## 21. OTA payout & commission reconciliation
- **Maturity:** IDEA_ONLY — no implementation; schema-only types in `src/lib/distribution/domain.ts`.
- **Public-claim ceiling:** REJECT (`CLAIMS_REGISTER.md` #10).
- **Strategic intent:** **Owner-confirmed this revision: `NEXT_BUILD`.** The owner's own framing: this is strategically important precisely because it connects booking, OTA, commission, payout, and actual property income — one of the clearest examples in this whole inventory of a function whose value comes from linking several data points that already sit in different parts of ASI (or would, once #11's channel data exists). **The owner explicitly cautions this is not a promise of immediate development** — actual scheduling is a separate task/roadmap sequencing decision.
- **Roadmap horizon:** **UNDECIDED (owner-confirmed as explicitly not yet scheduled).**
- **Build/buy/integrate:** build (tentative) — no RU vendor surveyed (RealtyCalendar, Bnovo, TravelLine, Контур.Отель) appears to own this either; still worth a short confirming search before committing.
- **Related/dependencies:** #11, #13 (net-of-commission pricing), #31, #32.

## 22. Guest-facing booking payment / deposit processing
- **Maturity:** IDEA_ONLY beyond #3's manual-attestation placeholder.
- **Strategic intent:** RESEARCH — whether ASI should ever collect guest-facing payments (vs. staying out of the property's own payment flow entirely) is a real strategic/liability question, not just an engineering one; the internal `docs/agent-os/PRODUCT_CONTRACT.md` invariants already treat payment logic and legally-significant flows with extra caution, which supports investigating before building. No owner instruction changed this in this revision.
- **Roadmap horizon:** RESEARCH.
- **Related/dependencies:** #3, #18.

## 23. Cross-module `PlatformDecision` orchestration
- **Maturity:** PLANNED for the unified system; individual pairwise links are BUILT_NEEDS_ACCEPTANCE (already counted under their own capabilities — see the Cross-Module Connections section below).
- **Repository evidence:** `docs/platform-90-percent-roadmap.md` (45–60% achievable, schema not built); `ASI-OPS-CONTOUR-BLUEPRINT.md`'s "Next Implementation Targets."
- **Public-claim ceiling:** see `CLAIMS_REGISTER.md` #12.
- **Strategic intent:** **RESEARCH.** The schema and priority-policy design is a real design investment before it's a coding task; committing to `NEXT_BUILD` without that design pass risks building the wrong abstraction.
- **Roadmap horizon:** RESEARCH.
- **Related/dependencies:** effectively all capabilities; see Cross-Module Connections below.

---

# Part 2 — Capabilities added in v2 of this inventory (#24–#36)

These extend the inventory to cover the full operational surface named in the task, including functions with no current ASI implementation. Several were checked directly against the repository; where a new, real finding emerged, it's called out explicitly.

## 24. Reputation & review-recovery-context analysis — NEW FINDING (not in v1)
- **Pain addressed:** knowing whether a mid-stay problem was actually resolved before it turns into a public review, and how severe/urgent a given review is.
- **What ASI actually does:** a genuinely real, previously-missed module. `src/lib/partner-reputation/` ingests review-received events (`PartnerReviewReceivedEventV1`) and computes sentiment, severity, category (18 categories including cleanliness/maintenance/access/safety/payment), reputation risk, and — the important part — a `PartnerRecoveryContext` (`no_recovery_case` / `recovered_before_review` / `unrecovered_before_review` / `awaiting_guest_confirmation` / `multiple_recovery_cases`) with timestamped recovery-latency facts. The migration header explicitly states this module does **not** publish review replies, call a review provider, manipulate reviews, send guest messages, create tasks, or apply compensation — it is an analysis/tracking layer only.
- **Maturity:** BUILT_NEEDS_ACCEPTANCE, with a real Postgres integration test (`partner-reputation.pg.integration.test.ts`) that, like the channel-manager recovery test, self-gates and reports unverified if no disposable Postgres URL is configured.
- **Repository evidence:** `src/lib/partner-reputation/contract.ts`, `policy.ts`, `repository.ts`; migration `20260815210000_partner_review_reputation_engine_v1.sql`.
- **Public-claim ceiling:** may say ASI tracks whether a mid-stay issue was resolved before a review was received, and classifies review severity/category. Must not say ASI responds to reviews, contacts review platforms, or issues compensation — the migration itself disclaims all of these.
- **Strategic intent:** CORE_NOW for the analysis layer (it already exists and is real); RESEARCH for whether to build the missing pieces (an actual review-response mechanism, or a genuinely *proactive* "detect distress before it becomes a review" trigger).
- **Roadmap horizon:** NOW for the analysis layer; RESEARCH for the proactive-trigger extension.
- **Related/dependencies:** #1 (booking lifecycle, source of recovery-latency timestamps), #9 (an in-stay escalation could feed a "recovered before review" outcome earlier).
- **Cross-module connection status:** **already exists** — this module is itself evidence that "reputation informed by whether the mid-stay problem was solved" is real, not merely hypothetical.

## 25. Photo-proof of cleaning/readiness
- **Maturity:** IDEA_ONLY — confirmed absent. `report_payload` on cleaning/inspection tasks (see #2) is a free-form JSON field; no actual image-upload pipeline was found.
- **Strategic intent:** RESEARCH — a real, common feature in RU competitor tooling per market research (RealtyCalendar's maid app has photo evidence); worth a build-vs-integrate decision once #2's dispatch mechanism (see #26) is decided.
- **Roadmap horizon:** UNDECIDED (sequenced after #26's dispatch-mechanism decision).
- **Related/dependencies:** #2, #26.

## 26. Maintenance / contractor dispatch beyond ticket creation
- **Maturity:** BUILT_NEEDS_ACCEPTANCE for maintenance-ticket creation and routing (`booking_maintenance_tickets`, part of #2's physical-readiness engine); IDEA_ONLY for any actual contractor marketplace, automated dispatch, or scheduling beyond the internal ticket.
- **Strategic intent:** **Owner-confirmed this revision: `NEXT_BUILD`.** This is described by the owner as a continuation of the already-existing Booking Ops/turnover contour: ASI should not just create and track a task, but eventually get it to a real executor and a real result. It is also the one concrete area where a named RU competitor — RealtyCalendar's Автопилот, which auto-dispatches to a maid app and auto-rotates lock codes post-checkout — is confirmed to already out-execute ASI's current implementation (see `PAIN_MAP.md` P13).
- **Roadmap horizon:** UNDECIDED — no explicit horizon was given for this item; treated the same as #21 rather than assumed scheduled.
- **Build/buy/integrate:** open — partner/integrate with an existing RU field-service tool vs. build a dispatch channel is not yet resolved.
- **Related/dependencies:** #2, #25.

## 27. Guest CRM / full guest relationship management
- **Maturity:** IDEA_ONLY as a distinct product — the genuine gap between #8 (real identity/repeat-stay tracking) and #10 (owner/lead CRM, a different system entirely).
- **Strategic intent:** RESEARCH — worth scoping explicitly as "build on top of #8" rather than a new system, once retention economics (see `CLAIMS_REGISTER.md` #14, marked EVIDENCE_NEEDED) are actually investigated.
- **Roadmap horizon:** RESEARCH.
- **Related/dependencies:** #8, #28.

## 28. Loyalty programs / repeat-guest incentives
- **Maturity:** IDEA_ONLY. The only related repository text found is a FAQ answer (`src/components/FaqAccordion.tsx`) describing a **future** global guest blacklist to screen out problematic repeat guests — a fraud/risk-screening idea, not a loyalty/incentive program.
- **Strategic intent:** HOLD, pending the same retention-economics research as #27.
- **Roadmap horizon:** UNDECIDED.
- **Related/dependencies:** #8, #27.

## 29. Upsell / cross-sell (detection vs. execution)
- **What exists:** real intent-classification. `src/lib/communication/intent.ts` defines an `upsell_request` intent category; `knowledge.ts` has an `upsells` field.
- **What does not exist:** any execution/fulfillment of an upsell.
- **Maturity:** BUILT_NEEDS_ACCEPTANCE for detection/classification; **IDEA_ONLY** for execution.
- **Overclaiming flag:** `src/app/features/communication/page.tsx` (EN marketing page, not RU, not edited by this task) currently states ASI *"Executes in-chat: upsells, payments, access codes, task dispatch."* Three of those four claims are not built per this inventory.
- **Strategic intent:** HOLD for execution, pending the same retention/guest-relationship research as #27/#28.
- **Roadmap horizon:** LATER (informal — no owner confirmation this revision).
- **Related/dependencies:** #8, #22, #27.

## 30. Direct booking / OTA-dependency reduction tooling
- **What exists:** a UI label only — `direct_bookings` in the Telegram owner-onboarding wizard, no supporting functionality.
- **Maturity:** IDEA_ONLY.
- **Strategic intent:** HOLD — a real direct-booking capability is a substantial build; not clearly justified without first knowing whether reducing OTA dependency is a priority pain (see `PAIN_MAP.md` P2/P4).
- **Roadmap horizon:** LATER (informal).
- **Related/dependencies:** #11, #21.

## 31. Optimal OTA mix / per-channel net-profitability analysis
- **Maturity:** IDEA_ONLY — no implementation; needs #21 (payout/commission data) as its foundation.
- **Strategic intent:** **Owner-confirmed this revision: `RESEARCH`.** The owner's own framing: interesting strategically, but data and confirmed economics are needed first — ASI should eventually evaluate a channel not by booking count but by actual net result (commission, payout, acquisition cost, cancellations, operational load, real margin).
- **Roadmap horizon:** **RESEARCH (owner-confirmed)**, sequenced strictly after #21.
- **Related/dependencies:** #21, #13.

## 32. Owner statement generation / automated owner reporting
- **What exists:** the dashboard (#16) shows live metrics; no automated formal owner-statement generation was found.
- **Maturity:** IDEA_ONLY.
- **Strategic intent:** HOLD — relevant mainly for management-company customers with owner-split obligations, a segment not confirmed as a current priority.
- **Roadmap horizon:** LATER (informal).
- **Related/dependencies:** #16, #21.

## 33. Staff task SLA control
- **What exists:** real, tested SLA-severity tracking. `src/lib/booking-ops/operator-alerts.ts` computes SLA obligation keys and `lifecycle-orchestrator.ts` creates urgent SLA obligations for unresolved blocking conditions.
- **Maturity:** BUILT_NEEDS_ACCEPTANCE.
- **Strategic intent:** CORE_NOW — already real and part of the core lifecycle engine.
- **Roadmap horizon:** NOW.
- **Related/dependencies:** #1.

## 34. Fiscal receipts / 54-ФЗ compliance (чеки, возвраты)
- **Maturity:** IDEA_ONLY. No fiscalization/54-ФЗ/online-kassa code found; the only "receipt"-named code (`snapshotReceipt`) is an unrelated internal audit artifact.
- **Market context:** RU cloud-kassa providers (CloudKassir, Лайтбокс, Робокасса, PayKeeper, Business.ru) are the standard way RU operators handle this today.
- **Strategic intent:** PARTNER_OR_INTEGRATE — regulated, provider-specific function with mature RU solutions; no case for building in-house.
- **Roadmap horizon:** UNDECIDED.
- **Related/dependencies:** #18, #21.

## 35. Energy / utility cost tracking
- **Maturity:** IDEA_ONLY — no repository evidence, no market or pain evidence gathered either.
- **Strategic intent:** HOLD, leaning NOT_STRATEGIC — no pain, no market signal, no owner instruction identified this as a priority.
- **Roadmap horizon:** UNDECIDED.
- **Related/dependencies:** none identified.

## 36. Security / sensor monitoring (охрана)
- **Maturity:** IDEA_ONLY — no sensor ingestion exists in code today.
- **Repository evidence:** `ASI-OPS-CONTOUR-BLUEPRINT.md`'s "Next Implementation Targets" names **"Sensor ingestion — normalize noise/smoke/door sensor events into `IncidentRecord` via dedicated mappers."**
- **Strategic intent:** **Owner-confirmed this revision, split by layer.** The owner's instruction: security is part of ASI's target operational system, but sensors/cameras/physical security infrastructure should preferably be integrated, not built from scratch — ASI should own interpretation, decision, escalation, and operational response. Concretely: **hardware/sensors = `PARTNER_OR_INTEGRATE`**; the **interpretation/decision/escalation software layer = `NEXT_BUILD`**, because the owner's own carve-out ("unless an existing approved internal architecture requires a narrower classification") applies here — the blueprint's "Next Implementation Targets" entry is specifically about that software normalization/mapping layer, not about building physical sensors.
- **Roadmap horizon:** hardware = LATER; software/interpretation layer = **NEXT** (it is literally in the canonical architecture doc's near-term target list).
- **Related/dependencies:** #23 (the incident/decision engine this would feed), #20 (a sensor-and-lock combination is a natural pairing — e.g. door-sensor-informed access logic).

---

# Cross-Module Connections Registry

For each pairing, the question asked was: *what changes if this function has access to the rest of ASI's context?* Each connection is marked by its own status — **EXISTS** (real, tested, in code today), **POSSIBLE** (no technical blocker, not built), or **PLANNED** (named as a target in an internal doc, not built) — independent of either module's own maturity rating.

| Connection | Status | Evidence / reasoning |
|---|---|---|
| Pricing ← location/audience signals | **EXISTS** | `pricing-intelligence-autopilot.ts` calls `getAudiencePricingWeights()`, informed by `property-audience-intelligence`, itself location-derived. Real, tested. |
| Check-in-instruction release ← physical readiness (cleaning) | **EXISTS** | `computePhysicalReadiness()` gates `canReleaseCheckInInstructions` — #2. |
| Check-in-instruction release ← legal/deposit/МВД readiness | **EXISTS** | `computeGuestLegalReadiness()` independently gates the same release — #3. Two *separate* real gates on the same release point, not yet unified into one combined readiness signal — a small, concrete step toward #23's aspiration. |
| Reputation risk ← whether a mid-stay issue was resolved | **EXISTS** | `partner-reputation`'s `PartnerRecoveryContext` — #24. One of the task's own example connections turns out to already be real, shipped code. |
| Guest reply ← guest identity/history/booking/readiness | **EXISTS (partially)** | The reply-composition path (#4/#9) already consumes guest identity (#8); it does not yet consume cleaning-readiness state or a full guest-history/preference profile (#27 doesn't exist yet), so this connection is real for identity but only POSSIBLE for the fuller version. |
| Cleaning ← actual checkout event and next check-in timing | **EXISTS** | `turnover-cleaning-activation.ts`'s `selectEarliestEligibleUpcomingBooking()` — #2. |
| Lock/access ← readiness gates (legal + physical) | **POSSIBLE** | No lock integration exists (#20) to receive such a signal, but the gating pattern it would plug into (#3, #2) is already real. This is arguably the cleanest "build the connective layer, integrate the base function" opportunity in the whole inventory — and matches the owner's own framing of #20's strategic intent exactly. |
| OTA evaluation ← net profitability after commission/fees, not gross booking count | **PLANNED** | Requires #21 (not built) and #11 (not live) both. |
| Pricing ← demand forecast / events / weather / booking window / occupancy / competitors | **PARTIALLY EXISTS** | Day-of-week, seasonality, lead-time, competitor-median, and supply factors are real (#13); weather/events/market-data sources are explicit code-level `_placeholder`s. |
| Escalation/support ← full guest and booking context | **EXISTS** | The escalation path already carries booking/object context per #9's tested routing; the *proactive* trigger (detecting distress mid-stay and intervening before checkout, distinct from #24's after-the-review analysis) is **POSSIBLE**, not yet built. |
| Security/sensor interpretation ← incident/decision engine | **PLANNED** | Named explicitly in `ASI-OPS-CONTOUR-BLUEPRINT.md`'s "Next Implementation Targets" (#36) but not built. |

---

# New findings from this revision worth flagging beyond the capability list itself

1. **`src/app/features/communication/page.tsx`** (EN, international/guestautopilot marketing) claims ASI *"Executes in-chat: upsells, payments, access codes, task dispatch"* — three of four listed executions are not built per this inventory (#20, #22, #29). This is a live overclaiming instance on a real page, not a hypothetical risk.
2. **`src/app/ota/page.tsx`** (EN) claims OTA connection lets "ASI run bookings, pricing, and guest flows end-to-end" — inconsistent with #11's PLANNED status for any named OTA.
3. Neither page is RU public copy and neither is edited by this task (out of scope per instructions), but both should be treated as known claims-register violations for whoever next reviews the EN/international site, and reinforce `POSITIONING_MAP.md`'s existing observation that the EN site is systematically more aspirational than the RU site.
