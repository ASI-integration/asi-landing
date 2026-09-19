# RU Site Architecture — Information Architecture & Narrative Flow (v2)

Architecture/content-strategy document for the Russian ASI public site (`/ru`). Grounded entirely in `docs/product-intelligence/{CAPABILITY_INVENTORY.md, CLAIMS_REGISTER.md, PAIN_MAP.md, POSITIONING_MAP.md, ROADMAP_PUBLIC_BOUNDARY.md}` on `main`, plus a read of the current `src/app/ru/page.tsx`. This document does not write final public copy, does not change any source file, and is not itself a claim — it is a structural brief for whoever (human or `asi-website-editor`) next writes the actual page.

No contradiction was found between the five canonical documents during this work — nothing here required changing them.

**v2 correction note:** v1 over-corrected toward safety and risked reducing ASI, on the page, to "a guest-messaging Telegram bot." This revision widens the core thesis and adds an explicit, separately-labeled "principle of ASI" layer — the architectural idea that ASI exists to reduce manual coordination between operational states, distinct from any list of features — while keeping every discipline from v1 that prevented overclaiming (no roadmap catalogue, no "ASI already connects everything," no unquantified statistics). v1's scaling-pain and competitor-framing wording is also corrected here for precision; see §4 and §9 below for exactly what changed.

---

## 1. One-sentence site job

The `/ru` homepage's single job: let a skeptical, non-technical operator who has never heard of ASI leave, within about five seconds of scrolling, knowing (a) what ASI concretely does for them today, and (b) what kind of system it is trying to become — without ever confusing the two, and without a feature catalogue standing in for either.

## 2. Primary visitor

A Russian short-term-rental operator: an individual host with a handful of apartments, a small management company, or an aparthotel operator — not a developer, not someone who already knows PMS/channel-manager vocabulary. They likely already use, or have evaluated, a Russian PMS (most plausibly RealtyCalendar or Bnovo, per `POSITIONING_MAP.md`) and are not evaluating ASI as their first piece of software. They are comparing ASI against what they already pay for, not against nothing.

## 3. Core positioning thesis (internal — not public copy)

**Revised in this pass — v1's thesis started too narrowly ("ASI answers guests...") and risked defining the whole product by its most mature feature.**

**Thesis:** ASI is built to reduce the manual coordination involved in running a short-term-rental operation, starting with the processes that can already be handed to a system reliably. Today, the most mature part of that system is guest communication and pre-arrival readiness checks; a person still decides anything that requires judgment or carries real responsibility. The evidence that this is a coordination system and not just a chat tool is narrow but real: a small number of ASI's own decisions already depend on more than one operational condition being true at once, rather than on a single function acting alone.

This keeps two things true at the same time, which is the entire point of this revision:
- **What is sold/proven today** stays exactly as narrow as `CAPABILITY_INVENTORY.md` allows: guest communication (#4/#8/#9), handoff of non-standard situations to a person (#9), object readiness (#2/#3a), and the small number of already-real cross-condition connections (§5 below).
- **What ASI is as a product idea** is allowed to be stated honestly and is *wider* than the current feature set, because it is a statement about *intent and architecture*, not a technical claim requiring `SAFE_NOW`/`QUALIFY` evidence — provided it is never phrased as "ASI already does X" for any X that isn't built. `ROADMAP_PUBLIC_BOUNDARY.md`'s claim-ceiling discipline governs only capability claims; a one-sentence statement of what kind of system ASI is trying to become is not a capability claim and does not need a `CAPABILITY_INVENTORY.md` row to say once, plainly, on the homepage — but it must never be illustrated with a list of unbuilt features standing in for evidence. See §5 for exactly how this is kept safe.

A closely related Russian-language formulation, capturing the same meaning (not final copy, for internal alignment only): *«ASI создаётся как система, которая уменьшает ручную координацию в управлении объектом — начиная с тех процессов, которые уже можно надёжно передать системе. Сегодня наиболее зрелый контур — общение с гостями и проверка готовности объекта, а человек остаётся там, где нужно решение или ответственность.»*

## 4. Why ASI, instead of just buying Bnovo/RealtyCalendar + a pricing tool + a chatbot

**This is now treated as one of the central sections of the narrative, not a defensive aside (v1 under-weighted it).**

**The wrong answer (do not use):** "потому что у них нет автоматизации" — false; `POSITIONING_MAP.md` confirms RealtyCalendar/Bnovo/TravelLine already automate multiple functions well.

**The wrong answer (do not use):** "потому что у них мало функций" — also false, and risks reading as an attack on named competitors' internal capabilities, which `POSITIONING_MAP.md` explicitly prohibits without direct verification.

**The right answer, grounded in evidence:** the RU market has already automated many *individual* functions well (channel sync, rate management, task lists). The next real problem is coordinating the *decisions* between those functions — and that is a different, largely unaddressed layer, not a missing feature in any one tool. ASI can currently prove only a handful of concrete instances of this — not a general claim of "connecting everything" — and the honest move is to show exactly those instances as evidence, not to assert the general claim they're drawn from.

Concretely, on the page: state the "coordination between functions, not just within them" gap once, plainly, then let §6/§7 (current capabilities + the workflow example) carry the actual proof — the readiness gate (#2 + #3a both independently required before check-in release) and location-informed pricing (#13 ← #14) are the two load-bearing, real examples. Nothing else should be implied to exist beyond these.

**Must never say:** that a named competitor lacks a capability internally (unverified); that ASI already connects "all" processes; that ASI replaces a PMS, replaces staff, or replaces "all your services." These four phrasings are flagged explicitly in §9 because they are the most likely accidental overclaims a future editor could reach for when trying to make this section punchy.

## 5. The homepage must explain two things separately

This is the structural correction at the center of this revision. The homepage needs **two clearly distinct layers**, and the boundary between them must be visible in the section structure itself, not just in careful sentence-level wording:

**Layer A — "Что ASI делает сегодня."** Concrete, current, `SAFE_NOW`/`QUALIFY` capabilities only. This is §7 (capability grouping) below, unchanged in spirit from v1.

**Layer B — "Принцип ASI."** Not a feature list, not a roadmap, not a list of things ASI "will do." A short, architectural explanation of *why* ASI is built the way it is:
- individual automations (a channel manager, a pricing tool, a chatbot) each perform one action well;
- ASI's aim is to reduce the manual coordination *between* actions — deciding what one module's state should mean for another module's decision;
- the evidence that this is real today, not aspirational, is the small number of decisions that already require more than one condition to be true at once (§3, §4) — named concretely, not gestured at.

Layer B must be stated once, briefly, and must **never** be illustrated with capabilities that don't exist yet. It is a statement about architecture and intent, and it stays true and checkable specifically *because* it points only at the real cross-condition examples already available as evidence — it does not need, and must not borrow, a roadmap list to sound substantial.

**Explicit forbidden phrasings for Layer B** (these collapse the "principle" into an overclaim and must not appear in any form):
- «ASI уже связывает все процессы»
- «ASI заменяет PMS»
- «ASI заменяет сотрудников»
- «ASI заменяет все сервисы»

Getting this boundary right is what prevents two opposite failure modes: presenting ASI as "just a Telegram bot" (Layer B missing or too quiet) and presenting ASI as already-unified software (Layer B illustrated with unbuilt features). Layer A and Layer B should be visually and narratively distinct sections (§8, sections 5 and 6), not blended into one paragraph.

## 6. Narrative sequence

Nine sections. Compared to v1's ten, this both compacts the problem-framing (two purely-abstract problem sections instead of three) and adds the explicit Layer A/Layer B split as its own step, per §5.

### Section 1 — Hero
- **Purpose:** identify product, actor, audience, and (briefly) the kind of system it is — not just its most mature feature.
- **Visitor question:** "Что это, для кого, и что это в целом делает?"
- **Evidence:** #4 (Telegram send, PILOT), #8, #9 for the concrete claim; §3's thesis for the framing, stated in one sentence, not elaborated here.
- **Claim ceiling:** SAFE_NOW, scoped to Telegram (`CLAIMS_REGISTER.md` claim #1/#2) for anything specific; the one-sentence product-idea framing is a positioning statement, not a capability claim (§3).
- **Must NOT say:** "on autopilot," full automation, any channel other than Telegram, any claim of scale beyond one object/one pilot, and must not let the one-sentence framing imply more is built than §7 can support.
- **CTA:** visible, not the section's job to convert.

### Section 2 — Почему рост количества объектов увеличивает ручную координацию
- **Purpose:** establish the scaling problem, briefly and qualitatively.
- **Visitor question:** "Почему рост числа объектов создаёт больше работы, а не просто больше дохода?"
- **Pain addressed:** P16 (`PAIN_MAP.md`).
- **Evidence:** P16 is explicitly `[G]`/`EVIDENCE_NEEDED` for magnitude — a general organizational-theory principle, not RU-STR-quantified in this research.
- **Claim ceiling / exact wording discipline (corrected in this revision):** do not use "profit doesn't scale proportionally with headcount" phrased as an established fact. Use instead: *рост количества объектов и сотрудников не гарантирует пропорционального роста чистой прибыли, потому что одновременно растёт объём координации, коммуникаций и исключений.* No percentages, no STR-specific quantitative claim, and the Ringelmann effect is still never named on the public page.
- **Must NOT say:** any numeric productivity-loss claim; must not imply ASI has already solved this at scale.
- **CTA:** none.

### Section 3 — Почему отдельные автоматизации не снимают эту нагрузку целиком
- **Purpose:** this is §4 above, placed here in the sequence — the central "why ASI, not just Bnovo + a pricing tool + a chatbot" answer, delivered as the direct continuation of section 2's problem, before any ASI capability is named.
- **Visitor question:** "У меня уже есть PMS/канал-менеджер — зачем мне что-то ещё?"
- **Pain addressed:** P2 (fragmentation, corrected framing).
- **Evidence:** `POSITIONING_MAP.md`'s corrected fragmentation finding and its "point tools + human in between" section.
- **Claim ceiling / wording discipline (corrected in this revision):** do not assert operator behavior frequency ("операторы часто сами проверяют...") — this was not evidenced. Use instead: *даже когда отдельные функции находятся в одной системе, связь между их состояниями и последующее решение — отдельная, ещё не автоматизированная задача.* Then point forward to section 6/7's concrete readiness-gate example as where this becomes checkable, rather than asserting it abstractly here.
- **Must NOT say:** that named competitors lack an internal capability (unverified, and prohibited by `POSITIONING_MAP.md`); any specific count of tools operators supposedly juggle.
- **CTA:** none — pivot section, not a conversion point.

### Section 4 — Общение с гостями: самый понятный пример этой боли сегодня
- **Purpose:** ground the abstract coordination problem in the single most relatable, most concretely evidenced instance before explaining ASI's general principle — this bridges "the problem" into "here's the first, clearest place ASI addresses it."
- **Visitor question:** "Ладно, а что это значит на практике?"
- **Pain addressed:** P8 (routine question load, staffing/fatigue), P9 (safe disclosure).
- **Evidence:** P8/P9 in `PAIN_MAP.md`.
- **Claim ceiling:** the pain description is general/plausible (`[G]`) and stays qualitative; ASI's response to it belongs in section 6, not asserted here.
- **Must NOT say:** a specific cost-per-message or staffing-hours-saved number; must not claim review-score improvement (`CLAIMS_REGISTER.md` claim #16, EVIDENCE_NEEDED).
- **CTA:** none — still problem-layer, priming section 6.

### Section 5 — Принцип ASI (Layer B, per §5 above)
- **Purpose:** state the architectural idea once, plainly, before the capability list — separate from, and narrower in tone than, a roadmap.
- **Visitor question:** "Как ASI вообще устроен — это ещё один чат-бот или что-то другое?"
- **Content:** the three-part explanation from §5 (individual automations do individual things; ASI's aim is reducing coordination between them; the evidence today is the specific cross-condition decisions already real) — no feature list, no future tense.
- **Evidence:** the same two concrete examples as §4/§6 (readiness gate; location-informed pricing) — this section states the *principle*, section 6/7 supplies the *proof*, deliberately not duplicated in full here.
- **Claim ceiling:** a positioning statement, not a capability claim (§3) — but every concrete example it leans on must itself be `SAFE_NOW`/`QUALIFY`.
- **Must NOT say:** any of the four forbidden phrasings in §5 above, and must not be illustrated with anything from the §9 omit-list.
- **CTA:** none.

### Section 6 — Что ASI делает сегодня (Layer A)
- **Purpose:** the evidence/capability layer — concrete, current, `SAFE_NOW`/`QUALIFY` claims only.
- **Visitor question:** "Хорошо, а что оно реально умеет прямо сейчас?"
- **Pain addressed:** P8, P9, P5/P6 (readiness).
- **Evidence and grouping:** see §7's grouping table below (unchanged from v1: guest replies from object data; object readiness — physical and legal, both, independently; price recommendation with location context).
- **Claim ceiling:** QUALIFY throughout, with #4's Telegram-scoped SAFE_NOW exception.
- **Must NOT say:** anything from the §9 omit-list, in any form, including as a "coming soon" aside.
- **CTA:** soft, e.g. a link toward the pilot section.

### Section 7 — Пример из практики
- **Purpose:** one concrete, checkable before/after exchange — the proof point for both section 4's pain and section 5's principle.
- **Visitor question:** "Покажите, как это выглядит на самом деле."
- **Pain addressed:** P8 (typical question) and P10 (atypical/business-decision question) side by side — the current site's `EXAMPLES` pattern already does this reasonably and should be preserved/evolved, not replaced with something weaker.
- **Evidence:** #9's tested guardrail matrix.
- **Claim ceiling:** QUALIFY, keep the existing disclaimer ("примеры поведения системы, а не гарантия конкретного ответа в каждой ситуации") — it does real claim-safety work.
- **Must NOT say:** a fabricated example implying an unbuilt capability (automatic discount, upsell charge, lock code).
- **CTA:** none.

### Section 8 — Пилот и условия
- **Purpose:** mechanics of engagement plus commercial terms in one place (merged from v1's two separate sections — they are short, sequential, and already commonly read together on the current site).
- **Visitor question:** "Что конкретно произойдёт, если я оставлю заявку, и что это будет стоить?"
- **Pain addressed:** P6 (object knowledge not centralized) is why the readiness gate exists.
- **Evidence:** #17 (one of the best-supported claims in the whole inventory); `RU_PUBLIC_SITE_CONTRACT.pricing`.
- **Claim ceiling:** SAFE_NOW/QUALIFY, matching the current site's `CLIENT_STEPS`/`PRICING_STAGES` closely — least structural change of any section. Preserve exactly: setup free before pilot; 14-day pilot clock starts only after full readiness; 1000₽/property/month continuation only if the client decides to continue; no automatic paid transition.
- **Must NOT say:** that continuation is billed automatically (#18b `PLANNED`/`FUTURE_ONLY`); that any pilot-chain channel-manager step performs a live OTA connection (#11 not live).
- **CTA:** primary.

### Section 9 — CTA / форма заявки
- **Purpose:** convert.
- **Evidence/claim ceiling:** N/A — form mechanics.
- **CTA:** the form itself (current `EarlyAccessObjectForm` pattern).

## 7. Homepage vs. deeper pages

Unchanged from v1 (no evidence surfaced in this revision to change these calls):

| Topic | Recommendation | Why |
|---|---|---|
| Guest communication | **Stays on homepage** (sections 4, 6, 7) | Strongest-evidenced, most central capability. |
| Pilot / pricing | **Stays on homepage** (section 8) | Core conversion path; already well-supported; short enough not to need a click-through. |
| Dynamic pricing (recommendation engine) | **Deep-dive candidate for a separate page**, homepage keeps only the one-line summary | Full honest framing (real vs. placeholder factors) needs more room than a homepage card allows. |
| Location intelligence | **Already a separate product/page — keep separate** | Has its own mandated claim-ceiling framing in `docs/commercial-product-positioning-v1.md`; don't duplicate on `/ru`. |
| Operations (readiness/cleaning/legal gating) | **Stays on homepage as a one-paragraph item**, no separate page yet | Not enough distinct, safely-claimable content for its own page; a deep page risks reaching into `REJECT`-tier detail (real МВД filing, deposit capture). |
| OTA / channel economics | **No page at all yet, anywhere** | Nothing here is `SAFE_NOW`/`QUALIFY` (#11 `FUTURE_ONLY`, #21 `REJECT`). |
| Reputation | **No page yet** | #24 real but thin and mostly backend-facing. |
| "Принцип ASI" (Layer B) | **Belongs on the homepage only, as one section (§6.5), never a standalone page** | A dedicated "vision" page would inevitably need to say more to fill it, which is exactly the pressure that produces overclaiming; one honest paragraph on the homepage, backed by real examples, is the safer and more truthful format. |

## 8. Current capability grouping (Layer A — customer-facing language, no repository/module names)

Unchanged from v1:

| Group | What the visitor is told | Underlying capabilities | Claim ceiling |
|---|---|---|---|
| Ответы гостям по данным объекта | ASI answers routine guest questions from the specific object's confirmed data, in Telegram, and hands off anything needing judgment to a person | #4, #8, #9 | SAFE_NOW (Telegram scope) / QUALIFY |
| Проверка готовности объекта перед заездом | Before check-in details are released, ASI checks that the object is actually ready — physically (cleaning) and on paper (documents/deposit/rules) — both, not just one | #2, #3a | QUALIFY |
| Рекомендованная цена с учётом объекта | ASI suggests a price using season, how far ahead the booking is, nearby competition, and what's known about the object's location — as a recommendation, not an automatic price change | #13, #14 | QUALIFY |
| Личный кабинет | An operator can see bookings and pilot status in one place | #16 | QUALIFY |

Deliberately not grouped onto the homepage: internal-only or backend-only rows (#1, #10, #12, #18a, #33 — `REJECT` under `CAPABILITY_INVENTORY.md`'s ceiling rule, not independently customer-facing). Upsell detection (#29a, `QUALIFY`) remains left off for the same thinness reason as v1.

## 9. Competitor-positioning frame

Unchanged in substance from v1, restated with §4's sharper framing:

- **Vs. PMS / channel-manager suites (RealtyCalendar, Bnovo, TravelLine, Контур.Отель):** not a replacement — these solve inventory/booking mechanics well, and ASI does not sync rates or manage OTA bookings today (#11 `FUTURE_ONLY`). The honest differentiation is §4/§5's coordination-between-decisions point, evidenced narrowly by the readiness gate, never a claim that these suites are deficient.
- **Vs. chatbots (RU-native and international):** ASI's answers are grounded specifically in one object's confirmed data with a tested (#9, 100-phrase matrix) escalation boundary — a specific, checkable difference, not a "smarter AI" claim.
- **Vs. dedicated pricing tools (Revkit, Apartcab, PriceLabs/Beyond):** do not claim ASI's pricing is more sophisticated today — Revkit already does live-push, market-data-driven pricing that ASI does not (#11 not live). The honest, narrow claim is that ASI's recommendation already factors in location/audience context (#13↔#14), stated as ASI's own feature, never as a claim about what Revkit internally lacks.
- **Vs. isolated automation tools generally:** each does its one job well; ASI's genuine, current differentiator is that a small number of its own decisions already require more than one real condition to be true at once — §5's principle, evidenced by §4/§6, not a claim of full connection.

**No blanket "competitors don't do X" statement should appear anywhere on the site.**

## 10. Pain-to-capability matrix

Unchanged from v1 except the P16 row's wording, corrected to match §6 section 2's discipline:

| Pain | Consequence | Current market response | Remaining gap | ASI's current response | Human's role | Future direction (if any) |
|---|---|---|---|---|---|---|
| P8 — repetitive guest questions, night messages | Staffing cost/fatigue if staffed; slow replies hurt reviews if not | Manual reply via Telegram/MAX (WhatsApp gone since 2026-02-12), or generic non-object-specific auto-reply | Answers grounded in the actual object, with a real handoff boundary | Answers routine questions from the object's confirmed data via Telegram (#4/#8/#9) | Decides anything atypical or judgment-based | — |
| P9 — safely disclosing access details | Risk of disclosing to the wrong person | Manual host judgment | An automated, confidence-scored gate | Identity-confidence check before disclosure (#8) | Still the only party who can act on disclosure, since no lock integration exists | Locks/access is a confirmed future direction (#20), not yet public |
| P16 — coordination overhead as portfolio grows | Growth in objects/staff does not guarantee proportional growth in net profit, because coordination, communication, and exceptions grow at the same time (qualitative, not quantified) | Hiring more staff, which does not reduce the coordination itself | A system where decisions — not just individual functions — are connected | Two of ASI's own decisions already require multiple real conditions together (readiness gate; pricing×location) | Everything not covered by those narrow connections | Full cross-module orchestration is a research direction, not yet public as a feature (#23) |
| P2 — fragmentation / switching cost | New tools must prove they don't duplicate what's already paid for | RealtyCalendar/Bnovo/Контур.Отель already bundle several functions | Coordination *between* bundled functions' states remains a separate, unautomated task | Not a general claim here — ASI closes this only for the two concrete examples in §4/§6 | Still the one connecting most states and reconciling money manually | OTA payout reconciliation is a confirmed future direction (#21), not yet public |
| P5 — legal/МВД/deposit readiness easy to skip | Fines; legal/reputational exposure | Hotel-class PMS (Контур.Отель, Bnovo) have real МВД e-filing; apartment-class tooling (RealtyCalendar) largely doesn't | Real e-filing integration, on either side | A checklist that gates check-in info release on legal readiness (#3a) — not filing itself | Actually files with МВД, collects the deposit, verifies documents | Real МВД filing is a confirmed future direction (#3b), research-first, not yet public |
| P6 — object knowledge not centralized before arrival | Operator must be reachable for basic questions | Informal (memory, sticky notes) | A real go/no-go gate tied to structured data | Field-level readiness gate before the pilot clock starts (#17) | Supplies the actual object data | — |
| P13 — cleaning/turnover coordination at scale | Guest arriving to an unready unit — high-severity failure mode | RealtyCalendar's Автопилот auto-dispatches to a cleaner and rotates lock codes; ASI does not yet | Automated dispatch to the human cleaner | Tracks cleaning/linen/inspection status and gates check-in release on it (#2) — dispatch is a manual draft only | Sends the actual message to the cleaner today | Automated dispatch to a real executor is a confirmed future direction (#26b), not yet public |
| P4 — OTA commission/payout complexity | Manual cross-checking of gross vs. net vs. tax base | PMS-level revenue stats exist; no reconciliation | Multi-OTA payout/commission reconciliation | None | Does all reconciliation manually | Confirmed future direction (#21), highest-conviction market gap, not yet public |
| P15 — repeat guests not recognized/nurtured | Missed direct-rebooking opportunity (value unquantified) | No RU tool found doing this well either | A genuine retention/rebooking capability | Tracks identity confidence and a repeat-stay count only (#8) — no retention/marketing layer | Would have to build any retention outreach manually | Guest CRM/loyalty are research-stage, not yet public |

## 11. Claims to deliberately omit (evidence/maturity insufficient — `REJECT` per `CAPABILITY_INVENTORY.md`)

Unchanged from v1, with the four Layer-B-specific forbidden phrasings from §5 added:

- Smart locks/access in any form (#20).
- OTA payout/commission reconciliation (#21).
- Real МВД e-filing, deposit payment capture, document verification (#3b, #22).
- Any live OTA/channel-manager sync with a named platform (#11).
- WhatsApp in any form (#6, #7) — not built, and market-moot in Russia since 2026-02-12 regardless.
- Guest CRM, loyalty programs, repeat-guest incentives beyond the identity/confidence check (#27, #28).
- Upsell/cross-sell *execution* (#29b) — only detection exists.
- Direct-booking tooling, owner-statement generation, fiscal-receipt handling (#30, #32, #34).
- Security/sensor monitoring in any form (#36a/#36b).
- **«ASI уже связывает все процессы», «ASI заменяет PMS», «ASI заменяет сотрудников», «ASI заменяет все сервисы»** — the four specific overclaim phrasings §5's "principle" section is most likely to accidentally reach for; explicitly forbidden regardless of section.
- Any specific coordination-overhead percentage, retention-value multiplier, or review-score-improvement number.
- "Profit doesn't scale proportionally with headcount" as a stated fact — use §6 section 2's corrected wording instead.
- Any claim about operator behavior frequency inside competitor products ("операторы часто сами проверяют...") — use §6 section 3's corrected wording instead.
- Any specific competitor commission percentage or market-share figure stated as a current, dated fact without a citation.
- Any blanket claim about what a named competitor's product does or doesn't do internally.
- Live weather/event/market-data feeds for pricing, or automatic price publication to any platform.
- Automatic recurring billing for the 1000₽/month continuation (#18b).
- English startup vocabulary from the EN/international site ("Operations on autopilot," "Runtime," "Orchestration," "operational layer," "end-to-end automation").

## 12. Roadmap visibility recommendation

**Unchanged: no roadmap catalogue on the acquisition page.** This revision adds one clarification, per the task's explicit instruction that "no roadmap catalogue ≠ no product vision":

- **What stays excluded:** any list, section, or aside naming specific unbuilt features (locks, OTA reconciliation, real МВД filing, security, loyalty, etc.) as directions ASI is heading — even clearly labeled as future. `ROADMAP_PUBLIC_BOUNDARY.md`'s discipline holds: `ROADMAP_CONFIRMED` status carries no public-communication authority by itself, and a homepage roadmap section would need a claims-register decision per item this document isn't authorized to make.
- **What is now explicitly included instead (§5, "Принцип ASI"):** one short, general statement of what kind of system ASI is trying to become — reducing coordination between operational decisions, not automating everything — illustrated *only* by the real, current cross-condition examples, never by naming an unbuilt feature. This is a product-vision statement, not a roadmap catalogue, and the distinction is enforced by the same rule as everywhere else in this document: nothing may be said that isn't either (a) a real, evidenced capability, or (b) a one-time, non-itemized statement of intent that names no specific unbuilt feature.
- If richer product-direction communication is ever wanted beyond that one paragraph, it still belongs on a **separate, clearly-titled page**, never `/ru` itself, and that page would need its own claims-register pass at the time it's written.

## 13. Final proposed homepage skeleton

1. Hero — что такое ASI сейчас
2. Почему рост объектов увеличивает ручную координацию
3. Почему отдельные автоматизации не снимают эту нагрузку целиком
4. Общение с гостями — самый понятный пример этой боли сегодня
5. Принцип ASI: рутину делает система, решения — человек
6. Что ASI делает сегодня
7. Пример из практики
8. Пилот и условия
9. CTA / форма заявки

Compared to v1 (ten sections), this compacts the pure problem-framing from three sections to two (2–3), keeps section 4 as the concrete bridge into the pain ASI actually addresses today, adds section 5 as its own clearly-labeled "principle" step (previously blended into what is now section 6), and merges pilot mechanics with commercial terms into one section (8), since they are short and already read together on the current site.
