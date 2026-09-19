# RU Site Architecture — Information Architecture & Narrative Flow (v1)

Architecture/content-strategy document for the Russian ASI public site (`/ru`). Grounded entirely in `docs/product-intelligence/{CAPABILITY_INVENTORY.md, CLAIMS_REGISTER.md, PAIN_MAP.md, POSITIONING_MAP.md, ROADMAP_PUBLIC_BOUNDARY.md}` on `main`, plus a read of the current `src/app/ru/page.tsx`. This document does not write final public copy, does not change any source file, and is not itself a claim — it is a structural brief for whoever (human or `asi-website-editor`) next writes the actual page.

No contradiction was found between the five canonical documents during this work — nothing here required changing them.

---

## 1. One-sentence site job

The `/ru` homepage's single job: let a skeptical, non-technical operator who has never heard of ASI leave, within about five seconds of scrolling, knowing what ASI is, who it's for, and where the line between "ASI does this" and "a person still decides this" sits — before they see a single feature list.

## 2. Primary visitor

A Russian short-term-rental operator: an individual host with a handful of apartments, a small management company, or an aparthotel operator — not a developer, not someone who already knows PMS/channel-manager vocabulary. They likely already use, or have evaluated, a Russian PMS (most plausibly RealtyCalendar or Bnovo, per `POSITIONING_MAP.md`) and are not evaluating ASI as their first piece of software. They are comparing ASI against what they already pay for, not against nothing.

## 3. Core positioning thesis (internal — not public copy)

ASI answers guests from the object's own confirmed data and knows when to stop and hand off to a person — and, structurally, the few decisions ASI already makes (like releasing check-in details) already depend on more than one real condition being satisfied together, not on a single isolated function acting alone. That is a narrow, currently-real seed of a genuinely connected operational system, not yet the system itself, and it is what separates ASI from a bundle of otherwise-excellent point tools.

This thesis is deliberately narrower than "ASI connects everything" (`POSITIONING_MAP.md` explicitly rates that general claim as not yet earned — the internal `PlatformDecision` orchestration is 45–60% achievable and unbuilt, `CAPABILITY_INVENTORY.md` #23). It rests on real, tested, narrow evidence: check-in-instruction release already requires both physical readiness (#2) and legal/deposit readiness (#3a) independently satisfied; location/audience signals already weight the pricing engine (#13/#14); guest-identity confidence already gates sensitive disclosure (#8); and reputation risk analysis already consumes whether a mid-stay issue was resolved (#24). None of these four connections was found to exist in the RU bundlers researched (RealtyCalendar, Bnovo) — this is the one differentiation claim in this document that is both true today and not available from the obvious alternative purchase.

## 4. Narrative sequence

Per the task's instruction, the order is problem → ASI's model → evidence/capabilities → commercial terms → CTA. Ten sections (see the skeleton in §11 for the compact version).

### Section 1 — Hero
- **Purpose:** identify product, actor, audience in the first screen.
- **Visitor question:** "Что это, для кого, и что это делает?"
- **Pain addressed:** none directly — this is identity, not problem-framing.
- **Evidence:** #4 (Telegram send, PILOT), #8, #9 — the core, most-evidenced capability cluster.
- **Claim ceiling:** SAFE_NOW, scoped to Telegram (`CLAIMS_REGISTER.md` claim #1/#2). Already close to correct on the current site (`ASI отвечает гостям вашего объекта`) — no structural change needed here beyond what section-ordering below implies.
- **Must NOT say:** "on autopilot," "full automation," any channel other than Telegram, any claim of scale beyond one object/one pilot.
- **CTA:** primary CTA visible but not the section's job to convert — its job is comprehension.

### Section 2 — Проблема масштабирования (coordination cost as properties grow)
- **Purpose:** establish why "just hire more people" or "just add more objects" isn't free.
- **Visitor question:** "Почему рост числа объектов создаёт больше работы, а не просто больше дохода?"
- **Pain addressed:** P16 (`PAIN_MAP.md`) — coordination overhead growing with portfolio size.
- **Evidence:** P16 is explicitly marked `[G]`/`EVIDENCE_NEEDED` for magnitude — general organizational-theory principle, not RU-STR-specifically quantified in this research.
- **Claim ceiling:** qualitative framing only, no multiplier, no percentage, no "Ringelmann effect" name-drop (the task explicitly warns against overstating this; naming the effect adds nothing a visitor needs and invites a stronger claim than the evidence supports). Phrase as a question/observation, not an asserted statistic — e.g. the shape "больше объектов часто означает больше сотрудников и больше созвонов/переписки между ними, а не пропорционально больше прибыли," never a specific "X% overhead" number.
- **Must NOT say:** any numeric productivity-loss claim; must not imply ASI has already solved this at scale (per §3's thesis discipline — the narrow real connections are evidence *toward* this, not proof it's solved).
- **CTA:** none — this section's job is to make the visitor nod, not act yet.

### Section 3 — Стоимость общения с гостями
- **Purpose:** the sharpest, most concretely evidenced pain, and the one ASI's strongest capability cluster actually addresses.
- **Visitor question:** "Почему обработка сообщений гостей — это реальные деньги и реальный риск, а не мелочь?"
- **Pain addressed:** P8 (routine question load, night messages, staffing/fatigue), P9 (safe disclosure of sensitive info).
- **Evidence:** P8/P9 in `PAIN_MAP.md`; #4/#8/#9 in `CAPABILITY_INVENTORY.md`.
- **Claim ceiling:** the *pain description* (staffing cost, fatigue, delayed replies hurting reviews) is general/plausible (`[G]`) and may be stated qualitatively without a number; ASI's response to it is `SAFE_NOW`/`QUALIFY`.
- **Must NOT say:** a specific cost-per-message or staffing-hours-saved number (not measured); must not claim review-score improvement (not measured, per `CLAIMS_REGISTER.md` claim #16, EVIDENCE_NEEDED).
- **CTA:** none yet — sets up section 6's answer.

### Section 4 — Почему уже автоматизированное всё равно не снимает нагрузку
- **Purpose:** answer the task's "critical positioning question" honestly — pre-empt "why not just buy Bnovo + a pricing tool + a chatbot?" before the visitor asks it themselves.
- **Visitor question:** "У меня уже есть PMS/канал-менеджер — зачем мне что-то ещё?"
- **Pain addressed:** P2 (fragmentation, corrected framing), the "point tools + human in between" thesis from `POSITIONING_MAP.md`.
- **Evidence:** `POSITIONING_MAP.md`'s corrected fragmentation finding (RealtyCalendar/Bnovo already bundle several functions — do not claim otherwise) and its "Does the hypothesis hold?" section (narrowly confirmed: bundlers combine *functions*, not *decisions between functions* — no evidence either bundler gates one action on two independent readiness conditions, or feeds location context into pricing).
- **Claim ceiling:** QUALIFY, narrow and specific. This section must **not** generalize into "ASI connects everything, they don't" — it should say only that the specific, named RU tools solve individual functions well, and that even inside a bundled suite, the operator is often still the one who checks whether cleaning *and* paperwork are both actually done before assuming a guest can check in.
- **Must NOT say:** "Bnovo/RealtyCalendar don't do X" as a blanket internal-capability claim (not independently verified, and `POSITIONING_MAP.md` explicitly instructs against unsupported competitor attacks) — frame from the operator's experience, not as a claim about a competitor's code. Must not claim any specific number of tools operators supposedly juggle (corrected finding: fragmentation is real but narrower than assumed).
- **CTA:** none — this is the pivot section into "here's ASI's actual model," not a conversion point.

### Section 5 — Модель ASI: где заканчивается автоматизация и начинается человек
- **Purpose:** state the operating model conceptually, once, before any feature list — this is the "ASI model" layer the task asks for between problem and evidence.
- **Visitor question:** "Как ASI вообще решает, что делать самому, а что передать человеку?"
- **Pain addressed:** synthesizes P8/P9/P10 into one operating principle.
- **Evidence:** #9 (LLM guardrails/escalation, tested against a 100-phrase matrix) is the concrete backing for the "knows when to stop" half of the model; §3's thesis is the backing for the "conditions must actually be met" half.
- **Claim ceiling:** QUALIFY. This section is conceptual/explanatory, not a new capability claim — it should not introduce any fact not already covered by sections 3 and 6's evidence.
- **Must NOT say:** anything implying the model spans domains it doesn't yet (e.g. do not imply this same "human decides the judgment calls" principle already governs pricing-auto-apply or lock access — those don't exist, #13/#20).
- **CTA:** none.

### Section 6 — Что ASI делает сегодня
- **Purpose:** the evidence/capability layer — the first place feature-shaped claims appear, and only current, `SAFE_NOW`/`QUALIFY` ones.
- **Visitor question:** "Хорошо, а что оно реально умеет прямо сейчас?"
- **Pain addressed:** P8, P9, P5/P6 (readiness), P1 (location, if included — see §5 homepage-vs-deeper-pages decision).
- **Evidence and grouping (customer language, no module/file names — see §6 of this document for the full grouping table):**
  1. **Ответы гостям по данным объекта** — #4 (Telegram, `SAFE_NOW`), #8 (`QUALIFY`), #9 (`QUALIFY`).
  2. **Проверка готовности объекта перед заездом** — #2 + #3a together (`QUALIFY`), explicitly stated as *two independent checks* (physical/cleaning and legal/document) both required — this is where §3's thesis becomes a concrete, honest proof point rather than an abstract claim.
  3. **Рекомендованная цена с учётом данных объекта** — #13 (`QUALIFY`), naming that it factors in season/lead-time/competitors/location context, explicitly *not* claiming live weather/event feeds (those are `_placeholder` per #13's evidence) and explicitly *not* claiming prices are pushed live to any platform (#11 is not live).
- **Claim ceiling:** QUALIFY throughout, one exception (#4's Telegram-scoped `SAFE_NOW`). Every sentence in this section must trace to a row in `CAPABILITY_INVENTORY.md`'s master table with Public Claim Status ≥ the sentence's strength.
- **Must NOT say:** any capability from the `REJECT` list (see §9 of this document) in any form, including as a "coming soon" aside — this section is exclusively present-tense, current-state.
- **CTA:** soft, e.g. a link to the pilot-mechanics section, not the main form yet.

### Section 7 — Пример из практики
- **Purpose:** ground everything above in one concrete, checkable before/after exchange — evidence, not abstraction.
- **Visitor question:** "Покажите, как это выглядит на самом деле."
- **Pain addressed:** P8 (typical question) and P10 (atypical/business-decision question) side by side, exactly the distinction the current site already models well.
- **Evidence:** #9's tested guardrail matrix; the current site's own `EXAMPLES` pattern is already a reasonable implementation of this and should be preserved/evolved, not replaced with something weaker.
- **Claim ceiling:** QUALIFY, with the disclaimer already on the current site ("примеры поведения системы, а не гарантия конкретного ответа в каждой ситуации") — keep it; it is doing real claim-safety work.
- **Must NOT say:** present a fabricated example implying a capability that doesn't exist (e.g. do not add an example depicting an automatic discount decision, upsell charge, or lock code — none of those are built).
- **CTA:** none — still evidence, not conversion.

### Section 8 — Как проходит пилот
- **Purpose:** mechanics of engagement — this is also strong evidence (#17 is one of the best-supported claims in the whole inventory) so it doubles as proof, not just process.
- **Visitor question:** "Что конкретно произойдёт, если я оставлю заявку?"
- **Pain addressed:** P6 (object knowledge not centralized) — the readiness gate exists precisely because of this pain.
- **Evidence:** #17 (`QUALIFY`, matches the existing public claim closely already).
- **Claim ceiling:** QUALIFY/SAFE_NOW mix, matching current site's `CLIENT_STEPS` closely — this section needs the least structural change of any on the page.
- **Must NOT say:** that the channel-manager step of any future pilot-chain extension performs a live OTA connection (#11 metadata-only/not-live).
- **CTA:** primary — this section leads directly into the form.

### Section 9 — Условия и цена
- **Purpose:** state the commercial model exactly as already contractually correct.
- **Visitor question:** "Сколько это стоит и когда я начинаю платить?"
- **Pain addressed:** none new — this is the resolution of the "what do I have to commit to" anxiety implicit since the hero.
- **Evidence:** #17, #18a's underlying pricing constant (not #18a itself, which is `REJECT` — see §9 below), `RU_PUBLIC_SITE_CONTRACT.pricing`.
- **Claim ceiling:** `SAFE_NOW` (`CLAIMS_REGISTER.md` claim #3) — this is the single best-evidenced claim on the entire site. Preserve exactly: setup free before pilot; 14-day pilot clock starts only after full readiness; 1000₽/property/month continuation only if the client decides to continue; no automatic paid transition.
- **Must NOT say:** that continuation is billed automatically (#18b, recurring billing loop, is `PLANNED`/`FUTURE_ONLY`, not built).
- **CTA:** primary, reinforcing section 8's.

### Section 10 — CTA / форма заявки
- **Purpose:** convert.
- **Visitor question:** "Как начать?"
- **Evidence/claim ceiling:** N/A — form mechanics, not a claim.
- **CTA:** the form itself (current `EarlyAccessObjectForm` pattern).

## 5. Homepage vs. deeper pages

| Topic | Recommendation | Why |
|---|---|---|
| Guest communication | **Stays on homepage** (sections 3, 6, 7) | It's the strongest-evidenced, most central capability — burying it on a sub-page would undersell the one thing ASI can back up best. |
| Pilot / how it works | **Stays on homepage** (section 8) | Core conversion path; already well-supported; splitting it off adds a click before the strongest CTA. |
| Pricing (commercial terms) | **Stays on homepage** (section 9) | Same reasoning — it's short, simple, and already correct; no reason to hide it behind a click. |
| Dynamic pricing (the recommendation-engine capability) | **Deep-dive candidate for a separate page**, homepage keeps only the one-line summary in section 6 | The full honest framing (what factors are real vs. placeholder, why it's a recommendation not a live push) needs more room than a homepage card allows without becoming a wall of qualifiers that hurts the section's pacing. |
| Location intelligence | **Already a separate product/page today — keep separate**, homepage should not attempt to re-explain it | It has its own claim-ceiling framing already mandated in `docs/commercial-product-positioning-v1.md`; duplicating it on `/ru` risks drifting out of sync with that document. |
| Operations (readiness/cleaning/legal gating) | **Stays on homepage as a one-paragraph grouped item** (section 6, group 2); no separate page yet | Not enough distinct, safely-claimable content to justify its own page today; a deep page here would either repeat the checklist framing or reach into `REJECT`-tier detail (real МВД filing, deposit capture) that must not be public. |
| OTA / channel economics | **No page at all yet, anywhere** | Nothing here is `SAFE_NOW`/`QUALIFY` (#11 `FUTURE_ONLY`, #21 `REJECT`) — a dedicated page would either be empty of real claims or would leak roadmap content as if it were current. Section 4 may reference the *problem* (commission/channel complexity) without claiming ASI solves it. |
| Reputation | **No page yet** | #24 is real but thin and mostly backend-facing (`REJECT`-adjacent customer relevance); not enough to justify standalone treatment; may earn a one-line mention in a future revision once/if it's surfaced in the dashboard in a customer-visible way. |

## 6. Current capability grouping (customer-facing language, no repository/module names)

| Group | What the visitor is told | Underlying capabilities | Claim ceiling |
|---|---|---|---|
| Ответы гостям по данным объекта | ASI answers routine guest questions from the specific object's confirmed data, in Telegram, and hands off anything needing judgment to a person | #4, #8, #9 | SAFE_NOW (Telegram scope) / QUALIFY |
| Проверка готовности объекта перед заездом | Before check-in details are released, ASI checks that the object is actually ready — physically (cleaning) and on paper (documents/deposit/rules) — both, not just one | #2, #3a | QUALIFY |
| Рекомендованная цена с учётом объекта | ASI suggests a price using season, how far ahead the booking is, nearby competition, and what's known about the object's location — as a recommendation, not an automatic price change | #13, #14 | QUALIFY |
| Личный кабинет | An operator can see bookings and pilot status in one place | #16 | QUALIFY |

Deliberately not grouped onto the homepage: internal-only or backend-only rows (#1, #10, #12, #18a, #33 — real, but `REJECT` under the ceiling rule because they are not independently customer-facing benefits; see `CAPABILITY_INVENTORY.md`'s ceiling-rule section for why). Upsell detection (#29a, `QUALIFY`) is technically eligible but thin enough that including it risks reading as a bigger feature than it is (detection only, no execution) — recommend leaving it off the homepage for now rather than needing a qualifier-heavy sentence to keep it honest.

## 7. Competitor-positioning frame

- **Vs. PMS / channel-manager suites (RealtyCalendar, Bnovo, TravelLine, Контур.Отель):** do not claim to replace them — ASI does not sync rates or manage bookings across OTAs today (#11 `FUTURE_ONLY`). Position as complementary: these solve inventory/booking mechanics well; ASI is not competing there. The honest differentiation is narrower and structural — the readiness-gate example in section 6/group 2 — not a claim that these suites are deficient.
- **Vs. chatbots (RU-native and international):** other chatbots answer generically; ASI's answers are grounded specifically in the confirmed data of one object, with a tested (not just designed) boundary for when to stop and hand off (#9's 100-phrase matrix). This is a real, specific difference, not a blanket "we're smarter" claim.
- **Vs. dedicated pricing tools (Revkit, Apartcab, PriceLabs/Beyond):** do not claim ASI's pricing is more sophisticated today — Revkit already does daily market-data-driven pricing with live pushes into RealtyCalendar/Bnovo/TravelLine, which ASI does not (#11 not live). The honest, narrow claim is that ASI's recommendation already factors in location/audience context (#13↔#14), which was not found to be advertised by Revkit — state this as ASI's own feature, not as a claim about what Revkit lacks internally (unverified).
- **Vs. isolated automation tools generally:** each does its one job well; ASI's genuine, current differentiator is that a small number of its own decisions already require more than one real condition to be true at once (see §3) — a first step toward connecting decisions across a property, not yet a full unified system.

No blanket "competitors don't do X" statement should appear anywhere on the site — every comparison must be framed as a fact about ASI's own confirmed behavior, per `POSITIONING_MAP.md`'s explicit instruction against unsupported competitor attacks.

## 8. Pain-to-capability matrix

| Pain | Consequence | Current market response | Remaining gap | ASI's current response | Human's role | Future direction (if any) |
|---|---|---|---|---|---|---|
| P8 — repetitive guest questions, night messages | Staffing cost/fatigue if staffed; slow replies hurt reviews if not | Manual reply via Telegram/MAX (WhatsApp gone since 2026-02-12), or generic non-object-specific auto-reply | Answers grounded in the actual object, with a real handoff boundary | Answers routine questions from the object's confirmed data via Telegram (#4/#8/#9) | Decides anything atypical or judgment-based | — |
| P9 — safely disclosing access details | Risk of disclosing to the wrong person | Manual host judgment | An automated, confidence-scored gate | Identity-confidence check before disclosure (#8) | Still the only party who can act on disclosure, since no lock integration exists | Locks/access is a confirmed future direction (#20), not yet public (see §9) |
| P16 — coordination overhead as portfolio grows | Profit doesn't scale proportionally with headcount (qualitative, not quantified) | Hiring more staff, which doesn't reduce the coordination itself | A system where decisions—not just individual functions—are connected | Two of ASI's own decisions already require multiple real conditions together (readiness gate; pricing×location) | Everything not covered by those narrow connections | Full cross-module orchestration is a confirmed research direction, not yet public as a feature (#23) |
| P2 — fragmentation / switching cost | New tools must prove they don't duplicate what's already paid for | RealtyCalendar/Bnovo/Контур.Отель already bundle several functions | Specific unbuilt connective functions (payout reconciliation, cross-domain readiness) inside those bundles | Not a claim to make here — ASI doesn't yet close these gaps either | Operator remains the one reconciling money and cross-checking readiness manually | OTA payout reconciliation is a confirmed future direction (#21), not yet public |
| P5 — legal/МВД/deposit readiness easy to skip | Fines; legal/reputational exposure | Hotel-class PMS (Контур.Отель, Bnovo) have real МВД e-filing; apartment-class tooling (RealtyCalendar) largely doesn't | Real e-filing integration, on either side | A checklist that gates check-in info release on legal readiness (#3a) — not filing itself | Actually files with МВД, collects the deposit, verifies documents | Real МВД filing is a confirmed future direction (#3b), research-first, not yet public |
| P6 — object knowledge not centralized before arrival | Operator must be reachable for basic questions | Informal (memory, sticky notes) | A real go/no-go gate tied to structured data | Field-level readiness gate before the pilot clock starts (#17) | Supplies the actual object data | — |
| P13 — cleaning/turnover coordination at scale | Guest arriving to an unready unit — high-severity failure mode | RealtyCalendar's Автопилот auto-dispatches to a cleaner and rotates lock codes; ASI does not yet | Automated dispatch to the human cleaner | Tracks cleaning/linen/inspection status and gates check-in release on it (#2) — dispatch is a manual draft only | Sends the actual message to the cleaner today | Automated dispatch to a real executor is a confirmed future direction (#26b), not yet public |
| P4 — OTA commission/payout complexity | Manual cross-checking of gross vs. net vs. tax base | PMS-level revenue stats exist; no reconciliation | Multi-OTA payout/commission reconciliation | None | Does all reconciliation manually | Confirmed future direction (#21), highest-conviction market gap, not yet public |
| P15 — repeat guests not recognized/nurtured | Missed direct-rebooking opportunity (value unquantified) | No RU tool found doing this well either | A genuine retention/rebooking capability | Tracks identity confidence and a repeat-stay count only (#8) — no retention/marketing layer | Would have to build any retention outreach manually | Guest CRM/loyalty are research-stage, not yet public |

## 9. Claims to deliberately omit (evidence/maturity insufficient — `REJECT` per `CAPABILITY_INVENTORY.md`)

- Smart locks/access in any form (#20) — confirmed future direction, zero implementation.
- OTA payout/commission reconciliation (#21) — confirmed future direction, zero implementation, and the owner explicitly does not treat it as scheduled.
- Real МВД e-filing, deposit payment capture, document verification (#3b, #22) — checklist exists; the filing/payment/verification itself does not.
- Any live OTA/channel-manager sync with a named platform (#11) — every named OTA is planned/on-request/unknown in the code's own registries.
- WhatsApp in any form (#6, #7) — not built, and market-moot in Russia since 2026-02-12 regardless.
- Guest CRM, loyalty programs, repeat-guest incentives beyond the identity/confidence check (#27, #28).
- Upsell/cross-sell *execution* (#29b) — only detection exists.
- Direct-booking tooling, owner-statement generation, fiscal-receipt handling (#30, #32, #34).
- Security/sensor monitoring in any form (#36a/#36b) — confirmed future direction, zero implementation.
- A general "ASI connects everything" or "ASI replaces your other software" claim, in any form — the narrow, real connections (§3) may be shown; the general claim may not.
- Any specific coordination-overhead percentage, retention-value multiplier, or review-score-improvement number — general principles may be stated qualitatively; no RU-STR-specific magnitude exists.
- Any specific competitor commission percentage or market-share figure stated as a current, dated fact without a citation.
- Any blanket claim about what a named competitor's product does or doesn't do internally.
- Live weather/event/market-data feeds for pricing, or automatic price publication to any platform — the recommendation engine is real; those specific inputs and the OTA push are placeholders.
- Automatic recurring billing for the 1000₽/month continuation (#18b) — the price is real; the automated billing mechanism is not.
- Any English startup vocabulary from the EN/international site ("Operations on autopilot," "Runtime," "Orchestration," "operational layer," "end-to-end automation") — flagged in `ROADMAP_PUBLIC_BOUNDARY.md` as explicitly bad fits for RU copy.

## 10. Roadmap visibility recommendation

**No roadmap on the acquisition page.** Reasoning:
1. The homepage's one job (§1) is five-second comprehension of what ASI *is*, not what it *intends to become*. Every additional section competes for that attention budget.
2. `ROADMAP_PUBLIC_BOUNDARY.md` already establishes that `ROADMAP_CONFIRMED` status (locks, МВД filing, OTA reconciliation, contractor dispatch, OTA-mix analysis, security) carries no public-communication authority by itself — a roadmap section would need its own separate wording decision per item, which is exactly the kind of scope this document is not authorized to make (no claim upgrade may come from Strategic Status).
3. Visually separating "now" from "future" on the same page is achievable in principle, but the safer, simpler design is to not attempt it on the page whose entire purpose is to be unambiguous to a first-time, non-technical reader. A future-directions section — however carefully labeled — creates exactly the risk the task warns against: future features visually resembling available ones, or a skimming reader conflating the two sections.
4. If product-direction communication is ever wanted, it belongs on a **separate, clearly-titled page** (e.g. "куда движется ASI" / "направления развития"), never on `/ru` itself, and that page's copy would need its own claims-register pass at the time it's written — this document does not pre-authorize any wording for it.

## 11. Final proposed homepage skeleton

1. Hero
2. Проблема масштабирования (рост объектов → рост координации)
3. Стоимость общения с гостями
4. Почему уже автоматизированное всё равно не снимает эту нагрузку
5. Модель ASI: где заканчивается автоматизация и начинается человек
6. Что ASI делает сегодня
7. Пример из практики
8. Как проходит пилот
9. Условия и цена
10. CTA / форма заявки

This differs from a naive feature-catalogue structure in three deliberate ways: (a) three consecutive problem-framing sections (2–4) precede any ASI claim, matching the task's explicit problem-first ordering; (b) the "model" (5) is stated once, conceptually, before the capability list (6), rather than being inferred from a list of features; (c) no roadmap/future section exists on this page at all (§10).
