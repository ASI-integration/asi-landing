# Operational Pain Map — RU short-term-rental operators (v1)

Grounding material for `asi-website-editor`. Organized by customer workflow stage. Each pain lists who experiences it, root cause, operational consequence, financial/reputation consequence, the existing typical (mostly RU-market) solution, the remaining gap, and the ASI capability that addresses it today (see `CAPABILITY_INVENTORY.md` for exact status — a listed capability is not automatically LIVE_PROVEN).

Confidence markers: **[V]** = supported by repository evidence and/or cited market research; **[G]** = general/plausible but not specifically evidenced in this research pass; **[U]** = evidence-needed, flagged explicitly rather than asserted.

---

## Acquisition (attracting the property/owner as ASI's customer)

### P1 — Deciding where to buy/list a property without spatial data
- **Who:** prospective and existing operators sizing up a new address.
- **Root cause:** no accessible, address-specific demand/competition signal; decisions are made on general reputation of a neighborhood. **[V]**
- **Operational consequence:** over/under-investment in a location relative to actual demand.
- **Financial/reputation consequence:** lower yield than expected, sunk cost in a weak location.
- **Existing typical solution:** informal local knowledge, real-estate agent opinion; RU-native paid tools are rare in this specific niche. **[G]**
- **Remaining gap:** a defensible, address-specific spatial read with honest uncertainty — not a guaranteed-revenue number. **[V]**
- **Relevant ASI capability:** #14/#15 Location scoring & report (residential/commercial) — CAPABILITY_INVENTORY.

### P2 — Software fragmentation as a switching-cost barrier
- **Who:** operators evaluating whether to adopt ASI alongside (or instead of) existing tools.
- **Root cause:** operators using RealtyCalendar/Bnovo/TravelLine already have several functions bundled; switching cost is real. **[V — market research]**
- **Operational consequence:** any new tool must prove it slots in without duplicating what's already paid for.
- **Financial/reputation consequence:** wasted spend on overlapping subscriptions if adoption is done carelessly.
- **Existing typical solution:** RealtyCalendar/Bnovo/Контур.Отель already bundle PMS + channel manager + CRM-lite + (Bnovo: pricing, МВД). **[V]**
- **Remaining gap:** fragmentation is **narrower than commonly assumed** — see `POSITIONING_MAP.md`. The real gaps are OTA payout reconciliation, per-door lock economics, and МВД filing inside posutochka-native (non-hotel-class) PMS, not general "too many tools." **[V]**
- **Relevant ASI capability:** none directly; this is a positioning constraint on how ASI should be sold, not a feature gap.

---

## Booking

### P3 — Manual channel/rate updates across multiple listing platforms
- **Who:** operators listing on 2+ platforms (Avito, Суточно.ру, Островок, Яндекс Путешествия).
- **Root cause:** without a channel manager, rates/availability must be updated per-platform manually. **[V]**
- **Operational consequence:** double-bookings, stale prices, wasted staff time.
- **Financial/reputation consequence:** overbooking-driven cancellations damage reputation and cost refunds.
- **Existing typical solution:** RU channel managers (Bnovo, RealtyCalendar CM, TravelLine, Контур.Отель) or the platforms' own free iCal calendar-sync links. Market research rates channel management as "the most mature and least fragmented layer" in the RU stack — **effectively solved and commoditized**. **[V]**
- **Remaining gap:** small operators below the PMS-adoption threshold still do this manually via iCal or by hand.
- **Relevant ASI capability:** #11 (named-OTA sync) is PLANNED/IDEA_ONLY today; #12 (manual-import reconciliation) is BUILT_NEEDS_ACCEPTANCE but not connected to a live OTA. **ASI does not currently close this pain better than the RU incumbents — it should not be positioned as if it does.**

### P4 — Commission/payout complexity varies by platform
- **Who:** all multi-platform operators, especially self-employed (самозанятые).
- **Root cause:** commission rates, payout timing and tax treatment differ per OTA (e.g. Суточно.ру 15–25% commission; commission is not deductible from taxable income under most спецрежимы). **[V]**
- **Operational consequence:** manual cross-checking of gross booking vs. net payout vs. commission vs. taxable base across platforms.
- **Financial/reputation consequence:** under- or over-reported tax liability; missed discrepancies in payouts.
- **Existing typical solution:** PMS-level "financial statistics" (RealtyCalendar, Bnovo) track booking revenue but not bank-settlement matching; 1С family software handles bookkeeping generically.
- **Remaining gap:** no RU vendor found (including RealtyCalendar/Bnovo/TravelLine/Контур.Отель) appears to own multi-OTA payout reconciliation as a product. **This is the highest-conviction gap identified in the whole market scan.** **[V]**
- **Relevant ASI capability:** #21 OTA payout & commission reconciliation — currently IDEA_ONLY. Real opportunity, not yet built.

---

## Pre-arrival

### P5 — Legal/compliance readiness (МВД migration registration, deposits, contract) is easy to skip under time pressure
- **Who:** operators hosting foreign guests (МВД obligation) or collecting deposits/contracts.
- **Root cause:** a private landlord has 7 working days to notify МВД of a foreign guest's arrival (hotels: 1 working day); missing this risks fines (~2,000–4,000₽, per ст. 18.9 КоАП); regulatory pressure is rising (ФЗ-127, classified-accommodation registry from 2025-09-01, though its applicability to ordinary apartments vs. hotels only is itself disputed — РСТ states the hotel-registration reform does not affect ordinary apartment letting). **[V, with the applicability caveat marked U]**
- **Operational consequence:** compliance steps get deprioritized against guest-facing tasks.
- **Financial/reputation consequence:** fines; reputational/legal exposure if a dispute arises without a signed contract or documented deposit.
- **Existing typical solution:** hotel-class PMS (Контур.Отель, Bnovo) have a genuine automated МВД-filing path via ЕПГУ. Apartment operators on posutochka-native tooling (e.g. RealtyCalendar, where no explicit МВД-filing module was found) more likely file manually via Госуслуги. **[V, RealtyCalendar gap marked U — worth a direct vendor check]**
- **Remaining gap:** the asymmetry between hotel-class and apartment-class tooling is a real, defensible wedge for a posutochka-focused operator.
- **Relevant ASI capability:** #3 Legal/deposit/МВД readiness gating — real workflow/checklist gating exists (BUILT_NEEDS_ACCEPTANCE), but **no real МВД e-filing exists in ASI either** (IDEA_ONLY for that specific piece) — ASI does not yet out-execute the hotel-class incumbents here, it matches the apartment-class gap.

### P6 — Object knowledge (Wi-Fi, check-in instructions, house rules) isn't centralized before guests arrive
- **Who:** operators onboarding a new object or handling a first booking.
- **Root cause:** house rules/Wi-Fi/appliance instructions live in the operator's head or scattered notes, not structured data. **[V — matches ASI's own onboarding gate design]**
- **Operational consequence:** the operator (or staff) has to be reachable to answer basic questions.
- **Financial/reputation consequence:** slow answers frustrate guests; staffing to cover this scales with unit count.
- **Existing typical solution:** informal (host's memory, sticky notes, generic guest-info PDF).
- **Remaining gap:** a real go/no-go readiness gate before pilot start, tied to structured fields.
- **Relevant ASI capability:** #17 Object/pilot readiness gating — BUILT_NEEDS_ACCEPTANCE, and this is one of the better-supported existing public claims (matches "14 дней пилота отсчитываются только после полной готовности" exactly).

### P7 — Access/lock coordination for self-check-in is priced per door and adds up fast
- **Who:** operators offering self-check-in (near-universal in RU посуточная аренда per market research).
- **Root cause:** Western smart-lock ecosystems (August, Yale, RemoteLock-as-a-service) are impractical in Russia post-2022 (thin hardware retail/warranty presence); the real RU path is Chinese lock hardware (TTLock, Tuya) plus RU middleware. **[V]**
- **Operational consequence:** managing codes per booking, per lock, often manually via each lock's own app if no middleware is used.
- **Financial/reputation consequence:** RU middleware (RentySoft) prices 350–1,500₽/lock/month — market research finds this is **the single largest per-unit software line item** in the RU stack, larger than the PMS subscription itself.
- **Existing typical solution:** RentySoft (vendor-agnostic TTLock/Tuya middleware, integrates with RealtyCalendar/TravelLine/Bnovo, delivers codes via Telegram/WhatsApp/MAX); RealtyCalendar also natively supports some lock models directly.
- **Remaining gap:** per-door economics are the target for a bundler; ASI has zero current implementation here.
- **Relevant ASI capability:** #20 Smart access/lock control — IDEA_ONLY, introduced as a market-informed opportunity in this inventory, not a prior ASI concept.

---

## Check-in

### P8 — Answering routine check-in questions (arrival time, parking, Wi-Fi) at any hour
- **Who:** operators/hosts fielding guest questions before and at check-in.
- **Root cause:** guests message at all hours; questions are overwhelmingly repetitive across guests for the same object. **[V — this is ASI's own stated product position, and matches the general observation that repetitive night-time messaging is a real staffing driver [G]]**
- **Operational consequence:** staffing a chat desk, or the owner personally answering at odd hours.
- **Financial/reputation consequence:** staffing cost/fatigue if staffed; slow/late replies hurt reviews if not.
- **Existing typical solution:** manual reply via whichever messenger the guest used (WhatsApp until 2026-02-12; now Telegram/MAX only), or a generic templated auto-reply with no object-specific data.
- **Remaining gap:** answers grounded in the specific object's actual data, with a clear human-handoff boundary for anything atypical.
- **Relevant ASI capability:** #4 Telegram guest messaging (PILOT) + #8 guest identity/memory + #9 LLM guardrails/escalation — this is ASI's most-evidenced, most product-market-fit-aligned cluster of capabilities.

### P9 — Disclosing sensitive access details (door codes) safely
- **Who:** operators worried about giving access details to the wrong person.
- **Root cause:** verifying a guest's identity by messenger alone is weak; giving out a door code to an unverified sender is a real risk. **[V — ASI's own code encodes this exact concern]**
- **Existing typical solution:** manual judgment by the host, or a booking-platform-verified channel only.
- **Remaining gap:** an automated, confidence-scored gate before disclosure.
- **Relevant ASI capability:** #8 Guest identity/memory — the `canRevealTelegramAccessDetails()` gate (verified + confidence ≥ 0.85) is real, tested logic; this is a genuine, specific proof point (see `CLAIMS_REGISTER.md` for exact allowed wording), though ASI has no lock integration to actually act on the disclosure (#20).

---

## Stay

### P10 — Atypical requests (discount negotiation, complaints, damage) need a human, and the system must know when to stop
- **Who:** guests and operators, during the stay.
- **Root cause:** some requests are genuinely a business decision, not a factual lookup. **[V]**
- **Operational consequence:** an automated system that doesn't stop here either overreaches (makes a bad decision) or under-delivers (can't answer the easy ones either, out of excess caution).
- **Financial/reputation consequence:** wrong automated business decisions (e.g. discounts) directly cost money; failure to escalate a real complaint damages the guest relationship.
- **Existing typical solution:** fully manual — every message goes to a human.
- **Remaining gap:** a reliable boundary between "answer from data" and "escalate," tested against a broad phrase set.
- **Relevant ASI capability:** #9 LLM reply guardrails & escalation routing — tested against a 100-phrase matrix (mocked model), not yet proven against the real model in production.

---

## Support (mid-stay issues)

### P11 — Maintenance/damage reports during a stay need routing, not just logging
- **Who:** operators/maintenance staff.
- **Root cause:** an inspection or guest report of damage needs to route to the right follow-up (reinspection, maintenance ticket) without losing track. **[V]**
- **Existing typical solution:** manual coordination via messenger/spreadsheet.
- **Remaining gap:** automatic routing from report → ticket → reinspection with state tracking.
- **Relevant ASI capability:** #2 Turnover/cleaning/linen/inspection coordination — the maintenance-ticket and reinspection routing exists as real, tested logic (`booking_maintenance_tickets`), gated by the same physical-readiness engine.

---

## Checkout

### P12 — Deposit return / dispute at checkout
- **Who:** operators and guests at end of stay.
- **Root cause:** deposit handling (if collected) needs a clear resolution path (return, dispute, waive) tied to actual property condition. **[V]**
- **Existing typical solution:** manual, ad hoc.
- **Remaining gap:** a real payment-capture/return integration — currently absent everywhere in ASI (see #3, #22).
- **Relevant ASI capability:** #3's deposit-status tracking is real workflow/checklist logic; the actual payment capture/return is IDEA_ONLY (#22).

---

## Cleaning / turnover

### P13 — Coordinating cleaner, linen, supplies and inspection between guests, at portfolio scale
- **Who:** operators managing more than a handful of units.
- **Root cause:** each additional unit multiplies the number of turnover events needing coordination; without a system, this is done via group chat and memory. **[V]**
- **Operational consequence:** missed or late cleaning, linen shortfalls, unverified readiness before the next guest.
- **Financial/reputation consequence:** a guest arriving to an unready unit is one of the most damaging failure modes in this business (immediate refund/review risk).
- **Existing typical solution:** RealtyCalendar Автопилот (cleaning tasks auto-appear on booking, dedicated maid app, photo evidence, quality ratings feeding staff pay, lock-code rotation via bot post-checkout) is the strongest RU-native answer found; Bnovo has a cleaning module; TeamJet serves hotel-scale ops. **[V]**
- **Remaining gap:** market research found **no RU product combining cleaner marketplace supply + task coordination + quality control specifically for apartments** (as distinct from hotels) — a plausible but not exhaustively-confirmed gap. **[V, with the gap itself marked U — not exhaustively searched]**
- **Relevant ASI capability:** #2 — real, tested task/status coordination exists, but dispatch to the actual human cleaner is a manual draft only ("Отправка выполняется только вручную после проверки оператором"); RealtyCalendar's automated dispatch is currently a genuine capability edge over ASI's present implementation, not the reverse.

---

## Finance / reconciliation

### P14 — No single view of real profitability per property after commissions, fees, and software costs
- **Who:** operators trying to understand true per-unit margin.
- **Root cause:** revenue, OTA commission, software subscriptions (PMS, pricing, locks, accounting) and tax treatment are scattered across systems. **[V]**
- **Existing typical solution:** manual spreadsheet reconciliation, or nothing.
- **Remaining gap:** same as P4 (#21) — this is the clearest, most consistently-identified gap across the whole market scan.
- **Relevant ASI capability:** #21 — IDEA_ONLY today.

---

## Retention

### P15 — Repeat guests aren't systematically recognized or nurtured
- **Who:** operators who could benefit from direct repeat bookings (avoiding OTA commission on a returning guest).
- **Root cause:** guest history isn't linked across stays in most tooling; ASI's own CRM (#10) is explicitly an owner/lead pipeline, not a guest system — the closest thing ASI has is the narrower identity/memory module (#8), which tracks `stays_count` but does not do retention marketing (offers, loyalty, direct-rebooking prompts).
- **Financial/reputation consequence [G, general marketing-economics principle, not RU-STR-specifically evidenced in this research]:** retaining an existing guest is plausibly cheaper than acquiring a new one, and guest communication quality plausibly affects reviews/reputation/loyalty beyond pure support — both are reasonable, widely-accepted general principles, but this research did not find RU-STR-specific data quantifying the effect size. Mark **EVIDENCE_NEEDED** before using a specific number publicly.
- **Existing typical solution:** none well-evidenced in the RU market scan either — reputation-management tools (TL: Reputation, Getloyalty) address review monitoring, not guest retention/rebooking specifically.
- **Remaining gap:** a genuine retention/rebooking capability, on either side (ASI or RU competitors).
- **Relevant ASI capability:** #8 (foundation exists: repeat-stay counter, identity confidence) but no retention-marketing layer is built on top of it.

---

## Portfolio scaling

### P16 — Adding staff to cover more units creates coordination overhead that doesn't scale proportionally
- **Who:** operators growing from a handful of units toward a portfolio.
- **Root cause [G — this is a general, widely-accepted principle in organizational/management theory (coordination cost grows faster than headcount in loosely-structured teams); this research did not find RU-STR-specific data confirming the magnitude for this industry].**
- **Operational consequence:** each new unit doesn't just add its own workload — it adds cross-unit coordination overhead (staff scheduling, information hand-offs, exception routing).
- **Financial/reputation consequence:** profit does not necessarily grow proportionally with unit count once coordination overhead is accounted for. **Directionally plausible, magnitude EVIDENCE_NEEDED.**
- **Existing typical solution:** hiring more administrators/staff — which is precisely what most existing RU tooling (PMS, CM) does not reduce, since it automates individual functions (rate sync, task lists) without automating the connections *between* them.
- **Remaining gap:** this is exactly the gap ASI's own internal roadmap docs describe as the long-term target (`docs/platform-90-percent-roadmap.md`'s cross-module `PlatformDecision` orchestration) — real, narrow cross-module links exist today (see `CAPABILITY_INVENTORY.md` #23), but the general claim that ASI already prevents this overhead at scale is **not yet supported** — the unified orchestration layer doesn't exist yet.
- **Relevant ASI capability:** #1, #2, #3, #13, #23 collectively — but the *aggregate* "scales without proportional headcount growth" claim exceeds what's built today. See `CLAIMS_REGISTER.md`.

### P17 — Per-unit software pricing means costs scale with the portfolio, not with actual usage
- **Who:** operators scaling past ~20 units.
- **Root cause:** every RU vendor found prices per-unit-per-day or per-unit-per-month (RealtyCalendar: 75₽/day at 0–4 units up to 297₽/day at 31+; Revkit: 170₽/unit/mo down to 85₽/unit/mo at 150+; RentySoft: 350–1,500₽/lock/mo). **[V — this is literally how every RU vendor found prices, confirming the owner hypothesis directly]**
- **Operational consequence:** none directly — this is a cost-structure fact, not a workflow problem.
- **Financial consequence:** total software spend at 20 units is estimated at ~20,000–45,000₽/month across a realistic stack, **dominated by per-lock fees, not by the PMS**. **[V]**
- **Existing typical solution:** none — this is the market norm, not a solved problem.
- **Remaining gap:** a genuinely different (e.g. flat-tier, or bundled) pricing model could be a real differentiator, though ASI's own current public pricing (1000₽/property/month) is itself per-unit, matching the market norm rather than breaking from it.
- **Relevant ASI capability:** none — this is a pricing-model/positioning question, not a product gap.
