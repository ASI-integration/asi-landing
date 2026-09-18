# Roadmap Public Boundary (v1)

Grounding material for `asi-website-editor`. Separates what ASI ultimately intends to become from what it can truthfully promise today. Both are needed by the Website Editor, but it must always know which side of this line a given sentence falls on. Cross-reference: `CAPABILITY_INVENTORY.md` for status per capability, `CLAIMS_REGISTER.md` for exact wording per claim.

## Can be sold/described today (present tense, no qualifier needed beyond what's already correct)

- Automated guest replies to routine questions, from the property's own data, via Telegram, with escalation to a human for anything requiring judgment. (`CAPABILITY_INVENTORY.md` #4, #8, #9)
- Free setup before the pilot; a 14-day pilot clock that starts only after full readiness is confirmed; 1000₽/property/month continuation, only if the client decides to continue; no automatic paid transition. (#17, #18)
- Object/pilot readiness tracked against concrete required fields (address, check-in/out times, Wi-Fi, rules, photos, channels) as a real go/no-go gate. (#17)

## Can be described as pilot/beta (present tense, with an explicit "pilot/limited" qualifier)

- Guest identity confidence-scoring and repeat-stay recognition, with a security gate before disclosing sensitive access details. (#8) — qualifier: this is a backend safety mechanism, not a guest-facing "loyalty" feature.
- Booking-lifecycle and turnover (cleaning/linen/inspection) status tracking that gates release of check-in instructions. (#1, #2) — qualifier: cleaner notification is a manual draft, not automated dispatch.
- Legal/deposit/МВД readiness as an internal operator checklist. (#3) — qualifier: this is a checklist, not a filing/payment/verification service.
- Pricing recommendations informed by seasonality, lead time, competitor signals, and location/audience context. (#13) — qualifier: recommendation only, never pushed live to an OTA; weather/event/market-data feeds are placeholders today.
- Location analysis (residential) as an open-map-based read with explicit data-completeness limits. (#14) — qualifier already mandated in `docs/commercial-product-positioning-v1.md`'s tone; reuse it.
- Location analysis (commercial/retail) with the same qualifier plus an explicitly lower confidence ceiling (55–70% per internal roadmap docs) — must never be described as more mature than the residential product.
- Owner/operator dashboard covering bookings, ops, pricing, and channel-connection status. (#16) — qualifier: describes what an operator can see/do, not a claim of full end-to-end production-proven reliability.

## May only be described as planned/future (never present tense)

- Live channel-manager/OTA sync with any named platform (Avito, Booking.com, Airbnb, Суточно.ру, Яндекс Путешествия, etc.). (#11)
- ASI's own recurring subscription billing loop for the 1000₽/property/month continuation fee (the pricing figure itself is real and current; the automated billing mechanism is not). (#18)
- A general, all-domain cross-module orchestration ("one system connecting every operational decision") — the specific, narrow, real cross-module links (#23: readiness gates check-in; location informs pricing) may be described now; the general claim may not.
- Smart access/lock integration. (#20)
- OTA payout/commission reconciliation and unified financial reporting. (#21)
- Guest-facing deposit/booking payment processing. (#22)
- Any WhatsApp-based guest communication (doubly future/non-viable: not built, and now blocked nationwide in Russia since 2026-02-12 — if this channel is ever revisited, it should not be WhatsApp).
- A "replaces your other software subscriptions" claim, in any specific or general form, until the concrete gaps it would rest on (payout reconciliation, cross-domain readiness) are actually built and proven.

## Must not yet appear on acquisition pages at all

- Anything from the "IDEA_ONLY" tier of `CAPABILITY_INVENTORY.md` presented as a current feature: smart locks (#20), OTA payout reconciliation (#21), guest-facing deposit/payment processing (#22), WhatsApp outbound messaging (#6).
- The international ("Guest Autopilot"/"ASI Micro Hotels"/"Rental Autopilot") positioning and terminology on RU pages — it is a different product line, gated off, and its English slogans ("Operations on autopilot. Humans on exceptions.", "Runtime", "Orchestration", "End-to-end automation", "Operational layer", "Full-stack hospitality automation") are explicitly the kind of language flagged as bad fits for the RU public site (see the task's own language guidance) — none of this vocabulary should leak into RU copy, and RU copy should not casually assume the visitor already knows about it.
- Specific commission percentages, RU-competitor pricing, or market-share numbers stated as current facts on a public page without a citation and date — market conditions and competitor pricing/coverage move quickly (WhatsApp's Feb 2026 block itself is a fresh example of how fast the ground can shift here) and a stale specific number is worse than a general statement.
- Any blanket claim about what a named competitor does or doesn't do internally (e.g. "конкуренты не умеют X") — this research verified competitor claims from public vendor materials only, not internal audits, and `POSITIONING_MAP.md` explicitly instructs against unsupported competitor attacks.

## The critical distinction, restated

ASI's internal roadmap documents (`docs/platform-90-percent-roadmap.md`, `docs/blueprints/ASI-OPS-CONTOUR-BLUEPRINT.md`) are unusually candid about separating "honest ceiling" from aspiration — they use vocabulary like "proxy," "pilot," "not sellable yet," and explicit percentage ceilings precisely to prevent claims inflation. The public site (both RU and EN) should inherit that same discipline. Where the two currently diverge — the EN site speaks as if an integrated "operating intelligence" already exists across bookings/payments/communication/access/cleaning/maintenance/pricing, while the internal docs rate several of those same areas (finance/ledger, commercial location, cross-module orchestration) well below "sellable" — the internal docs are the more accurate source, and any future RU (or corrected EN) copy should match the internal docs' honesty level, not the EN site's current aspirational framing.
