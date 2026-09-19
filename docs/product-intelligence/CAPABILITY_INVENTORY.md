# ASI Capability Inventory (v4)

Canonical, evidence-based inventory of every identifiable and every strategically-relevant-but-not-yet-built ASI capability, for the RU market. This is grounding material for `asi-website-editor` and for anyone deciding what the public site may claim. It is not itself public copy and is not a roadmap commitment.

## Five independent dimensions — do not collapse them, do not derive one from another

Every capability answers five separate questions, tracked as five separate fields. Collapsing them (e.g. letting a confirmed roadmap direction imply a public claim, or letting "we want this" imply "we're building it ourselves") is the single most common way a product-intelligence document goes wrong.

**A. Maturity** — what is actually built, and how strong is the evidence?
`LIVE_PROVEN` / `PILOT` / `BUILT_NEEDS_ACCEPTANCE` / `PLANNED` / `IDEA_ONLY` / `UNKNOWN`

**B. Public claim status** — may this capability be presented to a Russian prospective customer, and in what form? Maturity answers a different question ("how technically implemented and evidenced is this?") and therefore only sets the **maximum allowed ceiling** for this field — it does not by itself decide the final value. The actual value is chosen from evidence *and* scope, RU applicability, customer relevance, and legal/compliance constraints, and **may always be stricter (lower) than the ceiling, never looser (higher)**. Strategic Status (C), Delivery Strategy (D), and Roadmap Horizon (E) may never raise this field either — full wording lives in `CLAIMS_REGISTER.md`; the value here is the ceiling-respecting status, not the sentence itself.
`SAFE_NOW` / `QUALIFY` / `EVIDENCE_NEEDED` / `FUTURE_ONLY` / `REJECT`

**C. Strategic status** — do we want this capability in ASI's target system, independent of *how* it would be delivered?
`CORE_NOW` / `ROADMAP_CONFIRMED` / `RESEARCH_BEFORE_DECISION` / `HOLD` / `NOT_STRATEGIC`

`ROADMAP_CONFIRMED` means the owner has explicitly confirmed a capability belongs in the target system, **regardless of whether ASI builds it or integrates a third party**. It says nothing about sequencing. **In this revision, exactly seven rows carry `ROADMAP_CONFIRMED`, and every one of them is tied to an explicit owner instruction in this task — none is inferred from repository content, market attractiveness, or this document's own opinion of what would be good to build.** Repository existence is never treated as owner roadmap approval; where no owner instruction exists, a row that might plausibly deserve `ROADMAP_CONFIRMED` is instead marked `RESEARCH_BEFORE_DECISION` or `HOLD` with a note that it is proposed, not confirmed.

**D. Delivery strategy** — by what mechanism should the capability appear, once (C) says we want it?
`BUILD` / `PARTNER_OR_INTEGRATE` / `HYBRID` / `RESEARCH` / `NONE` / `UNDECIDED`

**E. Roadmap horizon** — when, separately from whether and how.
`NOW` / `NEXT` / `LATER` / `RESEARCH` / `UNDECIDED`

**None of these five fields is derived from another.** Examples that are all normal: `IDEA_ONLY` + `SAFE_NOW`-adjacent maturity is impossible by construction (Public Claim Status B is capped by Maturity A), but `IDEA_ONLY` + `ROADMAP_CONFIRMED` + `RESEARCH` (delivery) + `RESEARCH` (horizon) is exactly the МВД row below — nothing built, confirmed as wanted, mechanism and timing both still open. `BUILT_NEEDS_ACCEPTANCE` + `HOLD` + `UNDECIDED` + `UNDECIDED` is equally normal (something real, not currently prioritized further, no decided mechanism or date). The Website Editor must read Public Claim Status (B) only — **C, D, and E never govern public copy**; see `ROADMAP_PUBLIC_BOUNDARY.md`.

### Maturity values (unchanged since v1)

- **LIVE_PROVEN** — real integration, exercised against real infrastructure/users, with evidence of routine (not one-off) operation.
- **BUILT_NEEDS_ACCEPTANCE** — real, non-trivial logic exists and is unit-tested, but the strongest evidence available is a mocked dependency, not a live system or real user traffic.
- **PILOT** — real integration against a live external system, exercised outside a mock, but only at small/manual/test scale.
- **PLANNED** — a data model, UI, or provider registry exists, but the actual integration/adapter is explicitly absent or a placeholder in the code.
- **IDEA_ONLY** — no repository implementation found.
- **UNKNOWN** — insufficient evidence either way.

**`LIVE_PROVEN = 0` across this entire inventory does not mean "ASI doesn't work."** It means no evidence of routine, real-guest-scale production operation was found for any single capability, which is a deliberately high bar. A `PILOT` and a large `BUILT_NEEDS_ACCEPTANCE` core both represent genuine, often carefully safety-engineered work — a different, lower rung on this evidence ladder, not "not functional." The codebase's own `_placeholder`/`honest_label` markers are treated as authoritative: where the code says "placeholder," this inventory treats the capability as not live regardless of surrounding scaffolding. Most `*acceptance*.test.ts` files run against a mocked Supabase — "acceptance" here means "the internal contract behaves correctly under test," not "proven against production." Only `.pg.integration.test.ts` files, manually-dispatched `*-live-acceptance*` scripts/workflows, and Playwright specs under `tests/` touch anything genuinely live.

### Public claim status — ceiling rule (corrected in this revision)

**A prior version of this document assigned Public Claim Status mechanically from Maturity alone. That rule was wrong and is replaced here.** Maturity answers "how technically implemented and evidenced is this capability?" — a fact about the codebase. Public Claim Status answers "may this be presented to a Russian prospective customer, and in what form?" — a fact about audience, scope, RU applicability, customer relevance, and legal/compliance constraints. Maturity therefore defines only the **maximum allowed ceiling**:

| Maturity | Maximum public-claim ceiling |
|---|---|
| LIVE_PROVEN | SAFE_NOW |
| PILOT | SAFE_NOW, limited to the actually proven scope |
| BUILT_NEEDS_ACCEPTANCE | QUALIFY |
| PLANNED | FUTURE_ONLY |
| IDEA_ONLY | REJECT |
| UNKNOWN | REJECT |

**The actual Public Claim Status may always be assigned stricter (lower) than this ceiling — never looser (higher).** A row sits below its ceiling whenever one of these applies:

- internal-only capability (the customer/guest never sees or benefits from it directly);
- non-customer-facing infrastructure (backend plumbing that enables a feature but isn't itself a describable benefit);
- a different market/product line than the one this document covers (RU);
- not practically applicable in Russia today, regardless of build status;
- legal/compliance restrictions;
- the claim would require external evidence this document doesn't have;
- the capability's name is broader than its actually-proven scope;
- the capability exists technically but shouldn't be marketed as a customer benefit.

**Strategic Status (C), Delivery Strategy (D), and Roadmap Horizon (E) may never raise Public Claim Status** — a `ROADMAP_CONFIRMED` capability does not get a better claim status than an unconfirmed one at the same Maturity; only Maturity sets the ceiling, and only the reasons above pull a value down from it.

Four rows in the master table below sit strictly below their Maturity ceiling for these reasons — **#7** (WhatsApp inbound voice: built, but the channel itself is market-moot in Russia since the 2026-02-12 block, so built status does not make it suitable for current RU acquisition positioning), **#10** (Owner/lead CRM: internal ASI sales/pilot tooling, never customer-facing — `QUALIFY (internal-only)` was self-contradictory and is corrected to `REJECT`), **#12** (manual-import reconciliation engine: internal safety machinery supporting a channel-manager integration that isn't live; backend mechanism, not an independently marketable capability), and **#18a** (YooKassa provider/webhook code: backend payment infrastructure, not itself a customer-facing claim — the customer-relevant fact is the pricing figure, already covered as its own `SAFE_NOW` claim in `CLAIMS_REGISTER.md`, independent of this backend code). **#19** (international Stripe billing) remains `REJECT` as before, but is now presented as an ordinary instance of this same ceiling-vs-actual gap (different product/market scope), not as the document's only exception. `EVIDENCE_NEEDED` is not used at the capability level in this table (every capability here has a clear built/not-built answer); it remains correct for general market/economic claims not tied to one capability — see `CLAIMS_REGISTER.md`'s Ringelmann, retention-economics, and guest-comm-reputation entries.

---

## Master classification table

41 rows for 36 named capabilities — five capabilities (#3, #18, #26, #29, #36) are split into sub-rows because their pieces genuinely differ in Maturity and/or Strategic Status. Every summary count below this table is a direct tally of this table's own columns; no count is asserted without being reproducible from these 41 rows.

| ID | Capability | Maturity (A) | Public claim (B) | Strategic status (C) | Delivery strategy (D) | Horizon (E) |
|---|---|---|---|---|---|---|
| 1 | Booking-ops lifecycle & task engine | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW | BUILD | NOW |
| 2 | Turnover/cleaning/linen/inspection tracking | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW | BUILD | NOW |
| 3a | Legal/deposit/МВД — checklist/gating layer | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW | BUILD | NOW |
| 3b | Legal/deposit/МВД — real МВД e-filing | IDEA_ONLY | REJECT | **ROADMAP_CONFIRMED** (owner) | RESEARCH (→ likely PARTNER_OR_INTEGRATE) | RESEARCH |
| 4 | Guest messaging — Telegram (send) | PILOT | SAFE_NOW (Telegram only) | CORE_NOW | PARTNER_OR_INTEGRATE | NOW |
| 5 | Guest messaging — Email | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW | PARTNER_OR_INTEGRATE | NOW |
| 6 | Guest messaging — WhatsApp (outbound) | IDEA_ONLY | REJECT | NOT_STRATEGIC | NONE | UNDECIDED |
| 7 | Guest messaging — WhatsApp (inbound voice) | BUILT_NEEDS_ACCEPTANCE | **REJECT** *(below ceiling QUALIFY — channel is market-moot in RU since the 2026-02-12 block, regardless of build status)* | HOLD | UNDECIDED | UNDECIDED |
| 8 | Guest identity & repeat-guest memory | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW | BUILD | NOW |
| 9 | LLM reply guardrails & escalation | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW | BUILD | NOW |
| 10 | Owner/lead CRM & pilot rollout (internal) | BUILT_NEEDS_ACCEPTANCE | **REJECT** *(below ceiling QUALIFY — internal ASI sales/pilot tooling, not a customer-facing feature)* | CORE_NOW | BUILD | NOW |
| 11 | Channel manager/OTA sync (named platforms) | PLANNED | FUTURE_ONLY | RESEARCH_BEFORE_DECISION *(proposed, not owner-confirmed)* | PARTNER_OR_INTEGRATE *(proposed)* | UNDECIDED |
| 12 | Manual-import reconciliation engine (internal) | BUILT_NEEDS_ACCEPTANCE | **REJECT** *(below ceiling QUALIFY — internal backend safety mechanism supporting a not-yet-live channel-manager path; not an independently marketable capability)* | CORE_NOW | BUILD | NOW |
| 13 | Pricing recommendation engine | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW | HYBRID *(engine built; external market/weather/events feed still an open buy decision)* | NOW |
| 14 | Location scoring & report — residential | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW | HYBRID *(built scoring + integrated OSM/geocode/EIS data)* | NOW |
| 15 | Location scoring & report — commercial/retail | BUILT_NEEDS_ACCEPTANCE | QUALIFY | RESEARCH_BEFORE_DECISION *(footfall-data-provider economics unresolved)* | HYBRID | RESEARCH |
| 16 | Owner/operator dashboard UI | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW *(e2e-acceptance investment level is an open question, not a separate capability)* | BUILD | NOW |
| 17 | Object/pilot readiness gating (onboarding) | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW | BUILD | NOW |
| 18a | ASI subscription — YooKassa provider/webhook code | BUILT_NEEDS_ACCEPTANCE | **REJECT** *(below ceiling QUALIFY — backend payment infrastructure, not itself a customer-facing claim; the pricing figure it supports is a separate, already-`SAFE_NOW` claim)* | CORE_NOW | HYBRID | NOW |
| 18b | ASI subscription — recurring billing loop | PLANNED | FUTURE_ONLY | CORE_NOW *(finishing current commercial model, not a new bet)* | HYBRID | NOW |
| 19 | International (non-RU) Stripe billing | BUILT_NEEDS_ACCEPTANCE | **REJECT** *(below ceiling QUALIFY — different product line/market scope, not an evidence gap; an ordinary instance of the ceiling-vs-actual gap, not a unique exception)* | NOT_STRATEGIC | NONE | UNDECIDED |
| 20 | Smart access / lock control | IDEA_ONLY | REJECT | **ROADMAP_CONFIRMED** (owner) | **PARTNER_OR_INTEGRATE** (owner) | **LATER** (owner) |
| 21 | OTA payout & commission reconciliation | IDEA_ONLY | REJECT | **ROADMAP_CONFIRMED** (owner) | **BUILD** (owner, "unless a credible integration target is later found") | **UNDECIDED** (owner — explicitly not scheduled) |
| 22 | Guest-facing booking payment/deposit processing | IDEA_ONLY | REJECT | RESEARCH_BEFORE_DECISION | UNDECIDED | RESEARCH |
| 23 | Cross-module `PlatformDecision` orchestration | PLANNED | FUTURE_ONLY | RESEARCH_BEFORE_DECISION | RESEARCH | RESEARCH |
| 24 | Reputation & review-recovery-context analysis | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW | BUILD | NOW |
| 25 | Photo-proof of cleaning/readiness | IDEA_ONLY | REJECT | RESEARCH_BEFORE_DECISION *(sequenced after #26b)* | RESEARCH | UNDECIDED |
| 26a | Maintenance/contractor — ticket creation & routing | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW | BUILD | NOW |
| 26b | Maintenance/contractor — dispatch to real executor/result | IDEA_ONLY | REJECT | **ROADMAP_CONFIRMED** (owner) | **HYBRID** (owner: ASI owns workflow/decision layer; transport may be integrated) | **UNDECIDED** (owner) |
| 27 | Guest CRM / full guest relationship management | IDEA_ONLY | REJECT | RESEARCH_BEFORE_DECISION | RESEARCH | RESEARCH |
| 28 | Loyalty programs / repeat-guest incentives | IDEA_ONLY | REJECT | HOLD | UNDECIDED | UNDECIDED |
| 29a | Upsell/cross-sell — detection/classification | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW | BUILD | NOW |
| 29b | Upsell/cross-sell — execution/fulfillment | IDEA_ONLY | REJECT | HOLD | UNDECIDED | UNDECIDED |
| 30 | Direct booking / OTA-dependency reduction tooling | IDEA_ONLY | REJECT | HOLD | UNDECIDED | UNDECIDED |
| 31 | Optimal OTA mix / per-channel net profitability | IDEA_ONLY | REJECT | **ROADMAP_CONFIRMED** (owner) | **RESEARCH** (owner) | **RESEARCH** (owner) |
| 32 | Owner statement generation / automated owner reporting | IDEA_ONLY | REJECT | HOLD | UNDECIDED | UNDECIDED |
| 33 | Staff task SLA control | BUILT_NEEDS_ACCEPTANCE | QUALIFY | CORE_NOW | BUILD | NOW |
| 34 | Fiscal receipts / 54-ФЗ compliance | IDEA_ONLY | REJECT | HOLD *(no owner confirmation; market context favors integration if ever pursued)* | PARTNER_OR_INTEGRATE *(proposed)* | UNDECIDED |
| 35 | Energy / utility cost tracking | IDEA_ONLY | REJECT | NOT_STRATEGIC | NONE | UNDECIDED |
| 36a | Security/sensors — hardware/sensor devices | IDEA_ONLY | REJECT | **ROADMAP_CONFIRMED** (owner) | **PARTNER_OR_INTEGRATE** (owner) | **LATER** (owner) |
| 36b | Security/sensors — interpretation/decision/escalation layer | IDEA_ONLY | REJECT | **ROADMAP_CONFIRMED** (owner) | **BUILD** (owner) | **NEXT** (owner — matches `ASI-OPS-CONTOUR-BLUEPRINT.md`'s own "Next Implementation Targets") |

Bold values mark the seven rows carrying an explicit owner instruction from this task (3b, 20, 21, 26b, 31, 36a, 36b). Every other row's Strategic Status/Delivery/Horizon is this document's own proposal, marked accordingly, and is not to be read as an owner decision.

---

## Summary by maturity (A) — tallied directly from the table above

| Status | Count | Rows |
|---|---|---|
| LIVE_PROVEN | 0 | — |
| PILOT | 1 | 4 |
| BUILT_NEEDS_ACCEPTANCE | 20 | 1, 2, 3a, 5, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18a, 19, 24, 26a, 29a, 33 |
| PLANNED | 3 | 11, 18b, 23 |
| IDEA_ONLY | 17 | 3b, 6, 20, 21, 22, 25, 26b, 27, 28, 29b, 30, 31, 32, 34, 35, 36a, 36b |
| UNKNOWN | 0 | — |
| **Total** | **41** | |

## Summary by public claim status (B)

| Status | Count | Rows |
|---|---|---|
| SAFE_NOW | 1 | 4 |
| QUALIFY | 15 | 1, 2, 3a, 5, 8, 9, 13, 14, 15, 16, 17, 24, 26a, 29a, 33 |
| EVIDENCE_NEEDED | 0 | — (used only for non-capability-specific claims in `CLAIMS_REGISTER.md`) |
| FUTURE_ONLY | 3 | 11, 18b, 23 |
| REJECT | 22 | 3b, 6, 7, 10, 12, 18a, 19, 20, 21, 22, 25, 26b, 27, 28, 29b, 30, 31, 32, 34, 35, 36a, 36b |
| **Total** | **41** | |

Four rows (7, 10, 12, 18a) moved from `QUALIFY` to `REJECT` in this revision under the ceiling rule above; #19 stayed `REJECT` but is no longer framed as a unique exception. No row moved in the opposite direction (no upgrades), consistent with the rule that Public Claim Status may only be pulled down from its Maturity ceiling, never up.

## Summary by strategic status (C)

| Status | Count | Rows |
|---|---|---|
| CORE_NOW | 19 | 1, 2, 3a, 4, 5, 8, 9, 10, 12, 13, 14, 16, 17, 18a, 18b, 24, 26a, 29a, 33 |
| ROADMAP_CONFIRMED | 7 | 3b, 20, 21, 26b, 31, 36a, 36b — **all seven are owner-confirmed in this task; none inferred** |
| RESEARCH_BEFORE_DECISION | 6 | 11, 15, 22, 23, 25, 27 |
| HOLD | 6 | 7, 28, 29b, 30, 32, 34 |
| NOT_STRATEGIC | 3 | 6, 19, 35 |
| **Total** | **41** | |

## Summary by delivery strategy (D)

| Strategy | Count | Rows |
|---|---|---|
| BUILD | 15 | 1, 2, 3a, 8, 9, 10, 12, 16, 17, 21, 24, 26a, 29a, 33, 36b |
| PARTNER_OR_INTEGRATE | 6 | 4, 5, 11, 20, 34, 36a |
| HYBRID | 6 | 13, 14, 15, 18a, 18b, 26b |
| RESEARCH | 5 | 3b, 23, 25, 27, 31 |
| NONE | 3 | 6, 19, 35 |
| UNDECIDED | 6 | 7, 22, 28, 29b, 30, 32 |
| **Total** | **41** | |

## Summary by roadmap horizon (E)

| Horizon | Count | Rows |
|---|---|---|
| NOW | 19 | 1, 2, 3a, 4, 5, 8, 9, 10, 12, 13, 14, 16, 17, 18a, 18b, 24, 26a, 29a, 33 |
| NEXT | 1 | 36b |
| LATER | 2 | 20, 36a |
| RESEARCH | 6 | 3b, 15, 22, 23, 27, 31 |
| UNDECIDED | 13 | 6, 7, 11, 19, 21, 25, 26b, 28, 29b, 30, 32, 34, 35 |
| **Total** | **41** | |

Every row above appears in exactly one count per dimension; the five dimension totals each sum to 41, matching the table's row count exactly. If this document is edited later, re-tally directly from the master table rather than hand-adjusting a summary number.

---

## Owner-confirmed `ROADMAP_CONFIRMED` capabilities — full context

**#3b — Real МВД e-filing.** ASI should eventually close this process for the RU operator. Delivery: research existing APIs/providers/integration routes first; do not assume ASI must build the whole government-facing transport layer. Horizon: research-gated — no sequencing decision is possible before that research exists.

**#20 — Smart access/lock control.** ASI owns the access-decision logic (when, for whom, how long, under what readiness conditions — see #2/#3a); physical execution is delegated to an integrated lock provider (RU market evidence: TTLock/Tuya + RU middleware such as RentySoft). Horizon: LATER.

**#21 — OTA payout & commission reconciliation.** Strategically valuable because it links booking, OTA, commission, payout, and actual property income. Delivery: BUILD, unless a credible integration target is found later (none was in this research). **Horizon: UNDECIDED — the owner explicitly does not treat this as a promise of immediate development; actual sequencing is a separate task/roadmap decision.**

**#26b — Cleaner/contractor dispatch to a real executor/result.** Continuation of the existing Booking Ops/turnover contour (#1/#2/#26a already real). ASI should own the workflow/decision layer; the concrete communication/field-service transport may be an integration. Horizon: UNDECIDED, same discipline as #21.

**#31 — Optimal OTA mix / channel economics.** Strategically interesting, but confirmed data and economics are needed first — ASI should eventually evaluate a channel by real net result (commission, payout, acquisition cost, cancellations, operational load, real margin), not booking count. Delivery and horizon are both RESEARCH, and this depends on #21 existing first.

**#36a/#36b — Security/sensor monitoring.** Security is part of ASI's target operational system. Hardware/sensors/cameras should be integrated, not built (#36a: PARTNER_OR_INTEGRATE, LATER). ASI should own interpretation, decision, escalation, and operational response (#36b: BUILD) — and this specific software layer is the one case in this document where the owner's own carve-out ("unless an existing approved internal architecture requires a narrower classification") applies concretely: `ASI-OPS-CONTOUR-BLUEPRINT.md`'s "Next Implementation Targets" already names *"Sensor ingestion — normalize noise/smoke/door sensor events into `IncidentRecord` via dedicated mappers"* as near-term work, which is why #36b alone carries horizon `NEXT`.

---

## Repository evidence notes (selected rows — see prior revisions' full text for complete citations on every row; kept here for the rows with the most important or newest findings)

**#24 — NEW FINDING, not in v1.** `src/lib/partner-reputation/` (contract.ts, policy.ts, repository.ts; migration `20260815210000_partner_review_reputation_engine_v1.sql`) ingests review-received events and computes a `PartnerRecoveryContext` (whether a mid-stay issue was resolved before the review arrived) with a real Postgres integration test that self-gates when no disposable database is configured. The migration explicitly disclaims publishing review replies, contacting review platforms, or applying compensation — analysis only. This is real, shipped evidence that "reputation informed by whether the mid-stay problem was solved" (one of the cross-module connections this inventory was asked to investigate) already exists in code, not merely as a hypothesis.

**#11 — Channel manager/OTA.** Every named OTA (Avito, Booking.com, Airbnb, Суточно.ру, Яндекс Путешествия, etc.) is `planned`/`on_request`/`partner_access_required`/`unknown` in the code's own registries (`src/lib/channel-manager/registry.ts`, `src/lib/channel-connections/providers.ts`). RU market research independently confirms this layer is already commoditized by Bnovo/RealtyCalendar/TravelLine — see `POSITIONING_MAP.md`.

**#20 — market evidence.** RU market research found RentySoft (TTLock/Tuya middleware, 350–1,500₽/lock/month, integrates with RealtyCalendar/TravelLine/Bnovo, code delivery via Telegram/WhatsApp/MAX) as the concrete RU integration path.

**#21 — market evidence.** No RU vendor surveyed (RealtyCalendar, Bnovo, TravelLine, Контур.Отель) was found to own multi-OTA payout/commission reconciliation — the single highest-conviction market gap identified in this research.

**#29a/#29b — overclaiming flag.** `src/app/features/communication/page.tsx` (EN, international marketing page — not RU, not edited by this task) currently claims ASI *"Executes in-chat: upsells, payments, access codes, task dispatch."* Against this table, three of those four are not built: upsell execution (#29b), payment execution (#22), and access codes (#20). Flagged for whoever next reviews the EN site; `src/app/ota/page.tsx`'s "run bookings, pricing, and guest flows end-to-end" claim is a similar overstatement against #11's PLANNED status.

**#8 vs #10 — do not conflate.** `src/lib/crm/` (#10) is an owner/lead pipeline, not a guest CRM. Guest-facing identity/repeat-stay tracking is a separate, real module (`src/lib/communication/telegram-guest-memory.ts`, #8).

**RU vendor pricing structure (context for #21/#31, corrected in a prior revision, preserved here):** RealtyCalendar and Контур.Отель price a whole account within portfolio-size bands (effective per-object cost *decreases* ~35–39% from 5 to 25 objects, verified directly against both vendors' live pricing pages); Bnovo is genuinely per-room/linear with no volume discount; TravelLine's booking-engine product is commission-based, independent of portfolio size. See `PAIN_MAP.md` P17 for the full vendor-by-vendor breakdown and sourcing — not reproduced here to avoid drift between documents.

**International tools' RU applicability (context for #11/#20, preserved here):** PriceLabs and Beyond are officially available to Russian customers and offer partner-gated integration APIs, but no ready-made connector to Bnovo/RealtyCalendar/TravelLine was found in a full directory check, and RU billing feasibility is unconfirmed either way (не найдено в проверенных источниках, not asserted as blocked). See `POSITIONING_MAP.md` for the full analysis.

---

## Cross-Module Connections Registry

For each pairing: *what changes if this function has access to the rest of ASI's context?* Status is independent of either module's own Maturity — **EXISTS** (real, tested, in code today), **POSSIBLE** (no technical blocker, not built), or **PLANNED** (named as a target in an internal doc, not built).

| Connection | Status | Evidence / reasoning |
|---|---|---|
| Pricing ← location/audience signals | **EXISTS** | `pricing-intelligence-autopilot.ts` calls `getAudiencePricingWeights()`, location-derived. Real, tested. |
| Check-in-instruction release ← physical readiness (cleaning) | **EXISTS** | `computePhysicalReadiness()` gates `canReleaseCheckInInstructions` — #2. |
| Check-in-instruction release ← legal/deposit/МВД readiness | **EXISTS** | `computeGuestLegalReadiness()` independently gates the same release — #3a. Two separate real gates on the same release point, not yet unified — a concrete step toward #23. |
| Reputation risk ← whether a mid-stay issue was resolved | **EXISTS** | `partner-reputation`'s `PartnerRecoveryContext` — #24. |
| Guest reply ← guest identity/history/booking/readiness | **EXISTS (partially)** | Reply composition (#4/#9) consumes guest identity (#8); does not yet consume cleaning-readiness or a full guest-history profile (#27 doesn't exist) — real for identity, POSSIBLE for the fuller version. |
| Cleaning ← actual checkout event and next check-in timing | **EXISTS** | `turnover-cleaning-activation.ts`'s `selectEarliestEligibleUpcomingBooking()` — #2. |
| Lock/access ← readiness gates (legal + physical) | **POSSIBLE** | No lock integration exists (#20), but the gating pattern it would plug into (#3a, #2) is already real — matches the owner's own framing of #20 exactly. |
| OTA evaluation ← net profitability after commission/fees | **PLANNED** | Requires #21 (not built) and #11 (not live) both. |
| Pricing ← demand forecast / events / weather / booking window / occupancy / competitors | **PARTIALLY EXISTS** | Day-of-week, seasonality, lead-time, competitor-median, supply factors are real (#13); weather/events/market-data sources are explicit `_placeholder`s. |
| Escalation/support ← full guest and booking context | **EXISTS** | Escalation carries booking/object context (#9); the *proactive* mid-stay-distress trigger (distinct from #24's after-the-review analysis) is **POSSIBLE**, not built. |
| Security/sensor interpretation ← incident/decision engine | **PLANNED** | Named in `ASI-OPS-CONTOUR-BLUEPRINT.md`'s "Next Implementation Targets" (#36b) but not built. |
