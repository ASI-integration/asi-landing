# Claims Register (v2)

Grounding material for `asi-website-editor`. For every claim: status, supporting evidence, scope/population, allowed public wording (in plain Russian, per `AGENTS.md` → Language And Style), and prohibited stronger wording. Deterministic claim-safety rules already exist in `scripts/site-audit/contracts/ru-public-site.mjs` (`UNSUPPORTED_CLAIM_PATTERNS`, `OBSOLETE_JARGON_PATTERNS`) — this register is the editorial layer above that regex floor, not a replacement for it.

Status values: **SAFE_NOW** (may publish as-is) / **QUALIFY** (may publish only with the stated qualifier attached) / **EVIDENCE_NEEDED** (do not publish until the named evidence exists) / **FUTURE_ONLY** (may describe as a direction/roadmap item, never as current) / **REJECT** (do not publish in any form given current evidence).

**This register tracks Public Claim Status only — never Strategic Intent.** `CAPABILITY_INVENTORY.md` v2 separates Maturity, Public Claim Status (here), and Strategic Intent as three independent fields. A capability the owner has confirmed as `NEXT_BUILD` does not earn a better claim status here until its Maturity actually changes — see `ROADMAP_PUBLIC_BOUNDARY.md`'s explicit warning against leaking strategic intent into present-tense or beta copy.

**Absence-of-evidence discipline for market/competitor facts:** where this register or the documents it cites could not confirm whether a competitor has a given feature, integration, or market-availability path, the correct phrasing is "не найдено в проверенных источниках" / "не найден готовый путь интеграции" / "публично не заявляется" / "требует прямой проверки у вендора" — never "не существует" or "не работает," unless a source explicitly states the negative. This applies throughout `POSITIONING_MAP.md` and `PAIN_MAP.md` as well.

---

## 1. Core product claim: automated guest communication with human escalation

- **Claim:** ASI answers routine guest questions from the property's own data and hands off anything requiring judgment to a human.
- **Status:** SAFE_NOW.
- **Supporting evidence:** `CAPABILITY_INVENTORY.md` #4 (Telegram send, PILOT), #8 (identity/memory), #9 (LLM guardrails tested against a 100-phrase matrix). This is also the existing, already-live public claim on `src/app/ru/page.tsx`/`how-it-works`/`early-access`, and it is the most evidence-backed claim in the whole inventory.
- **Scope/population:** one object at a time, during an active pilot; Telegram channel only.
- **Allowed wording:** «ASI отвечает на типовые вопросы гостей по данным вашего объекта. Когда нужно решение человека — автоматический ответ останавливается, и запрос передаётся вам.»
- **Prohibited stronger wording:** any claim that the reply logic has been proven against the real language model at guest scale (only guardrail logic is tested, not real-model behavior at scale — see #9); any claim of "full automation" or "no human needed" (already blocked by the deterministic auditor's `CLAIM_FULL_AUTOMATION`/`CLAIM_WITHOUT_HUMAN` patterns).

## 2. Channel scope: which messenger

- **Claim:** guest communication works via [channel].
- **Status:** SAFE_NOW for Telegram; **REJECT** for WhatsApp.
- **Supporting evidence:** `CAPABILITY_INVENTORY.md` #4 vs #6. Independently, Russia blocked WhatsApp nationwide on 2026-02-12 — the claim would be false for the RU market even if ASI built outbound WhatsApp send.
- **Scope/population:** RU market, current date.
- **Allowed wording:** «через Telegram» (или, при появлении реальной интеграции, «через Telegram и MAX»).
- **Prohibited stronger wording:** any mention of WhatsApp as a live or planned guest-communication channel for the RU market.

## 3. Pilot/pricing mechanics (setup, 14 days, continuation)

- **Claim:** free setup before the pilot; the 14-day pilot clock starts only after full readiness confirmation; continuation is 1000₽/property/month only if the client decides to continue; no automatic paid transition.
- **Status:** SAFE_NOW.
- **Supporting evidence:** `CAPABILITY_INVENTORY.md` #17 (real, tested readiness-gating engine) and #18 (real pricing constant, matches `RU_PUBLIC_SITE_CONTRACT.pricing`). This is one of the best code-supported claims in the entire inventory.
- **Scope/population:** RU market, per property.
- **Allowed wording:** exactly as already published — no change needed.
- **Prohibited stronger wording:** implying the 1000₽/month continuation is billed automatically (it is not — billing for this is PLANNED, see #18).

## 4. Location analysis

- **Claim:** ASI gives a defensible, address-specific spatial read of a location's short-term-rental viability.
- **Status:** QUALIFY.
- **Supporting evidence:** `CAPABILITY_INVENTORY.md` #14/#15; `docs/commercial-product-positioning-v1.md`'s own mandated honesty framing.
- **Scope/population:** residential is stronger-evidenced than commercial/retail (55–70% internal ceiling for commercial, vs. a higher, golden-fixture-tested ceiling for residential).
- **Allowed wording:** «Анализ на основе открытых данных, с явными ограничениями точности» / for commercial: «V1, только открытые карты, проксирующий поток» (exact framing already mandated internally — reuse it verbatim, do not soften it).
- **Prohibited stronger wording:** any guaranteed revenue or footfall number; "почти идеально" or a bare readiness percentage on a public page (explicitly forbidden by the source doc itself).

## 5. Pricing recommendation engine

- **Claim:** ASI recommends prices using multiple signals including location/audience context.
- **Status:** QUALIFY.
- **Supporting evidence:** `CAPABILITY_INVENTORY.md` #13 — real multi-factor engine, genuinely linked to location signals; but weather/events/market-data sources are explicitly `_placeholder` in the code itself, and the recommendation is never pushed live to an OTA.
- **Scope/population:** recommendation only, not live pricing.
- **Allowed wording:** «ASI рассчитывает рекомендованную цену с учётом сезона, дней до заезда, конкурентов и данных о локации объекта. Это рекомендация, а не автоматическая публикация цены на площадках.»
- **Prohibited stronger wording:** any claim that prices are automatically applied/pushed to an OTA; any claim of live weather/event/market-data feeds (the code itself labels these placeholders).

## 6. Channel manager / OTA connectivity

- **Claim:** ASI syncs listings/rates across OTAs (Avito, Booking.com, Airbnb, Суточно.ру, etc.).
- **Status:** REJECT.
- **Supporting evidence:** `CAPABILITY_INVENTORY.md` #11 — every named OTA is `planned`/`on_request`/`partner_access_required`/`unknown` in the code's own provider registries; no live adapter exists.
- **Scope/population:** N/A — no live scope exists.
- **Allowed wording:** none for "live sync." May describe channel connection as a roadmap direction only (`FUTURE_ONLY`): «Подключение к площадкам — в проработке.»
- **Prohibited stronger wording:** any present-tense claim of channel/OTA sync.

## 7. Legal/МВД/deposit handling

- **Claim:** ASI handles migration registration (МВД), deposit collection, or document verification.
- **Status:** REJECT for МВД filing, deposit payment, and document verification specifically; **QUALIFY** for the readiness-checklist framing.
- **Supporting evidence:** `CAPABILITY_INVENTORY.md` #3 — real workflow/checklist gating exists and is well-tested, but every status implying a real integration is explicitly suffixed `_placeholder` in the code; no МВД e-filing client, no payment capture, no document OCR exists.
- **Scope/population:** internal operator checklist only.
- **Allowed wording (if surfaced at all — likely an operator-facing, not public-acquisition, claim):** «ASI отслеживает готовность по документам, договору, депозиту и уведомлению МВД как чек-лист для оператора» — never as something ASI files/collects/verifies itself.
- **Prohibited stronger wording:** "автоматическая подача в МВД," "автоматический сбор депозита," or any claim of document verification.

## 8. Cleaning / turnover coordination

- **Claim:** ASI coordinates cleaning, linen, and inspection between guests.
- **Status:** QUALIFY.
- **Supporting evidence:** `CAPABILITY_INVENTORY.md` #2 — real, tested status-tracking and readiness-gating engine exists; but the message to the actual human cleaner is an explicit manual draft only, never an automated dispatch.
- **Scope/population:** internal task tracking, not automated dispatch.
- **Allowed wording:** «ASI отслеживает статус уборки, белья и осмотра между заездами и не разблокирует инструкции для следующего гостя, пока это не подтверждено.»
- **Prohibited stronger wording:** any claim that a cleaner is automatically notified/dispatched by ASI (it is not — a human sends the draft).

## 9. Smart access / locks

- **Claim:** ASI manages or integrates with smart locks.
- **Status:** REJECT.
- **Supporting evidence:** `CAPABILITY_INVENTORY.md` #20 — zero implementation found anywhere in the repository.
- **Allowed wording:** none. `FUTURE_ONLY` at most, and only once a real decision to build this is made — this document does not itself authorize adding it to any roadmap page.
- **Prohibited stronger wording:** any mention of lock/access-code management as a current or even near-term ASI feature.

## 10. OTA payout/commission reconciliation and finance

- **Claim:** ASI reconciles OTA payouts, commissions, or provides a unified financial view.
- **Status:** REJECT.
- **Supporting evidence:** `CAPABILITY_INVENTORY.md` #21 — no implementation; also the single highest-conviction market gap found (no RU competitor covers this either), which makes it a real future opportunity, not a safe current claim.
- **Prohibited stronger wording:** any present-tense financial-reconciliation claim.

## 11. Software subscription fragmentation ("replace N tools")

- **Claim:** ASI replaces the multiple separate subscriptions an operator currently pays for.
- **Status:** REJECT as a general claim; **EVIDENCE_NEEDED** even for a narrower version.
- **Supporting evidence:** `POSITIONING_MAP.md` — RU market leaders (RealtyCalendar, Bnovo) already bundle several functions (PMS + channel manager + CRM + housekeeping + sometimes pricing/МВД) into one subscription at low per-unit cost. The blanket fragmentation narrative is weaker than commonly assumed and would be an inaccurate, unsupported claim about the market, not just about ASI.
- **Scope/population:** N/A.
- **Allowed wording:** none for a "replaces your tools" claim today. A narrower, evidence-backed version is possible once specific gaps (payout reconciliation, cross-domain readiness gating) are actually built and proven — track as `FUTURE_ONLY`.
- **Prohibited stronger wording:** "заменяет все ваши подписки," "убирает N сервисов," any specific number of tools claimed to be replaced.

## 12. Integrated system vs. point tools ("connects the steps between functions")

- **Claim:** ASI is not another point tool — it connects the decisions and steps between operational functions, escalating humans only for exceptions.
- **Status:** QUALIFY for the narrow, real version; **FUTURE_ONLY** for the general version.
- **Supporting evidence:** `POSITIONING_MAP.md`/`CAPABILITY_INVENTORY.md` #23 — real, narrow, tested cross-module links exist today (physical-readiness gates check-in release; legal readiness independently gates the same release; location/audience signals weight pricing). ASI's own internal roadmap rates the *general* orchestration layer (`PlatformDecision`) at 45–60% achievable and explicitly not yet built.
- **Scope/population:** the specific pairs of modules named above, not "all domains."
- **Allowed wording (narrow, real):** «Перед тем как открыть гостю инструкции для заезда, ASI проверяет и уборку, и юридическую готовность (документы, депозит, уведомление МВД) — а не только один из этих пунктов.»
- **Prohibited stronger wording:** "единая система, которая связывает все процессы," "заменяет ручную координацию между сервисами" as a general, all-domain claim — this is the destination, not the current state (see `ROADMAP_PUBLIC_BOUNDARY.md`).

## 13. Team-scaling / coordination-overhead claim (Ringelmann-adjacent)

- **Claim:** scaling a hospitality operation by adding staff creates coordination overhead that grows faster than headcount, so profit does not grow proportionally with unit count.
- **Status:** EVIDENCE_NEEDED.
- **Supporting evidence:** this is a general, widely-accepted principle in organizational/management theory (the Ringelmann/social-loafing and coordination-cost literature is about group effort and coordination loss generally; it was not verified in this research pass as STR-industry-specific data). No RU-STR-specific quantification was found.
- **Scope/population:** unverified for this industry specifically.
- **Allowed wording:** may be used as a *framing question* rather than an asserted fact, e.g. «Больше объектов часто означает больше сотрудников и больше координации между ними» — descriptive, not quantified.
- **Prohibited stronger wording:** any specific multiplier, percentage, or "always"/"guaranteed" framing of the coordination-overhead effect.

## 14. Guest acquisition vs. retention economics

- **Claim:** retaining an existing guest is more economically valuable than repeatedly acquiring new guests.
- **Status:** EVIDENCE_NEEDED.
- **Supporting evidence:** a general, widely-accepted marketing-economics principle (acquisition typically costs more than retention across most industries); not verified with RU-STR-specific data in this research pass. Also relevant: ASI's own retention-facing capability is thin today — the CRM (#10) is an owner/lead pipeline, not a guest system, and the guest-memory module (#8) tracks identity/repeat-stay count but has no retention-marketing layer built on it.
- **Scope/population:** unverified for RU STR specifically; ASI's own capability gap here should also temper any claim that ASI already delivers on this economics point.
- **Allowed wording:** may reference the general principle qualitatively, without RU-STR-specific numbers, and should not imply ASI already has a retention feature beyond identity/repeat-stay recognition.
- **Prohibited stronger wording:** a specific RU-STR retention-value multiplier or percentage; any claim that ASI runs retention/loyalty campaigns (not built).

## 15. OTA complexity (commissions, payout timing, accounting treatment differ by platform)

- **Claim:** adding more OTAs increases reach but also commission exposure, reconciliation complexity, and accounting complexity; economics differ by platform.
- **Status:** SAFE_NOW, as a general/qualitative statement.
- **Supporting evidence:** `POSITIONING_MAP.md`/`PAIN_MAP.md` P4 — confirmed directionally (Суточно.ру 15–25% commission; commission is non-deductible under most спецрежимы; payout cadence and tax treatment genuinely differ by platform).
- **Scope/population:** general RU-market statement, not tied to a specific commission percentage that could go stale.
- **Allowed wording:** «Разные площадки — разные комиссии, сроки выплат и налоговый учёт. Сверка вручную занимает время.»
- **Prohibited stronger wording:** a specific commission percentage stated as universal/current without a source and date (rates change); any claim that ASI already reconciles this (see claim #10, REJECT).

## 16. Guest communication as a reputation/retention/upsell lever, not just support

- **Claim:** guest communication quality affects reviews, reputation, loyalty, and upsell — not only support-ticket resolution.
- **Status:** EVIDENCE_NEEDED (general principle, not RU-STR-specifically evidenced here) for the causal claim; SAFE_NOW as a plain descriptive statement without a magnitude.
- **Supporting evidence:** plausible and widely assumed in hospitality generally; this research did not find RU-STR-specific data quantifying the effect, and ASI itself has no upsell capability built (not in `CAPABILITY_INVENTORY.md`).
- **Allowed wording:** «Качество общения с гостем влияет не только на решение вопроса, но и на отзыв после проживания» — descriptive, no numbers, no upsell claim.
- **Prohibited stronger wording:** any claim that ASI currently drives upsell or measurably improves review scores (not built, not measured).

## 17. Dynamic pricing differentiation via integrated context

- **Claim:** ASI's pricing is better because it combines context (location, demand, seasonality) that competitors don't have.
- **Status:** QUALIFY.
- **Supporting evidence:** `POSITIONING_MAP.md` — ASI's pricing engine has a real, tested link to location/audience signals; RU-native competitor Revkit was not found to advertise this specific kind of context (per the market research pass, which did not access Revkit's algorithm internals — this is an absence-of-evidence finding, not a confirmed technical gap in Revkit).
- **Scope/population:** the comparison is based on public vendor materials, not verified internals of the competitor's algorithm.
- **Allowed wording:** «ASI учитывает данные локации объекта при расчёте рекомендованной цены» — a statement about ASI's own capability, not a comparative claim about what competitors lack.
- **Prohibited stronger wording:** "конкуренты не умеют этого" or any blanket claim about what Revkit/Bnovo/other named vendors do or don't do internally — this was not verified and would be an unsupported competitor attack.

## 18. International brand consistency

- **Claim:** (implicit, structural, not a specific sentence) — ASI is one coherent product/brand.
- **Status:** EVIDENCE_NEEDED / internal flag, not a publishable claim at all.
- **Supporting evidence:** `POSITIONING_MAP.md` — at least three distinct brand narratives currently coexist: the RU guest-communication pilot (`src/app/ru/**`), the EN "ASI Intelligence"/"ASI Micro Hotels" positioning (`src/app/page.tsx`), and a `/rental-autopilot` cross-link labeled "Rental Autopilot." These are not obviously the same product to a first-time visitor.
- **Recommendation:** this is a positioning-hygiene issue for `asi-website-editor` and site owners to resolve deliberately, not a claim to publish either way. Flagged here so it isn't silently perpetuated when RU pages are next edited.

## 19. Reputation / review-recovery tracking

- **Claim:** ASI tracks whether a guest issue was resolved before it became a public review, and classifies review severity.
- **Status:** QUALIFY.
- **Supporting evidence:** `CAPABILITY_INVENTORY.md` #24 — a real, tested module (`src/lib/partner-reputation/`), including one real Postgres integration test. This was missed in v1 of this register and is a genuinely stronger existing capability than the v1 inventory reflected.
- **Scope/population:** analysis only.
- **Allowed wording:** «ASI фиксирует, была ли проблема гостя решена до появления отзыва, и оценивает серьёзность отзыва.»
- **Prohibited stronger wording:** any claim that ASI responds to reviews, contacts review platforms, or issues compensation — the module's own migration explicitly disclaims all three.

## 20. Upsell / cross-sell

- **Claim:** ASI detects and/or executes guest upsell requests (extra services, early check-in, etc.).
- **Status:** QUALIFY for detection; **REJECT** for execution.
- **Supporting evidence:** `CAPABILITY_INVENTORY.md` #29 — real intent classification (`upsell_request`) exists; no execution/fulfillment exists anywhere.
- **Important existing violation:** `src/app/features/communication/page.tsx` (EN, international site — not RU, not edited by this task) currently claims ASI "Executes in-chat: upsells, payments, access codes, task dispatch." This is inaccurate against current evidence for three of the four items and should be corrected when that page is next touched.
- **Allowed wording (RU, if ever surfaced):** «ASI распознаёт, когда вопрос гостя похож на запрос дополнительной услуги» — detection only, never "оформляет" or "продаёт."
- **Prohibited stronger wording:** any claim that ASI charges for, confirms, or fulfills an upsell.
