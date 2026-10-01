# ASI public claim-to-evidence matrix v1

Updated: 2026-10-01

Purpose: keep public marketing, Terms, pricing/payment wording, and the accepted product contour aligned. A claim is public-safe only when the boundary in this matrix is preserved.

| Area | Public-safe claim | Required boundary | Evidence / source of truth |
|---|---|---|---|
| Brand | Operations on autopilot. Humans on exceptions. | Automation applies to supported/configured workflows; exceptions and unsupported external actions stay human-controlled. | `src/app/page.tsx`, `src/app/rental-autopilot/page.tsx` |
| Guest communication | ASI can answer routine guest messages from grounded property/booking context. | Sensitive, ambiguous, payment, legal, or unsupported actions escalate to an operator. | communication orchestrator + handoff-lock; `src/app/features/communication/page.tsx` |
| Channel Manager | ASI works above an existing Channel Manager and can prepare/import operational data. | Pilot connection/import may be manual or semi-automated; direct provider API sync is claimed only after that provider integration is accepted. | roadmap `ch-first-real-adapter`; `ChannelManagerConnectionFlow.tsx` |
| OTA publishing | ASI can prepare publication/channel actions. | Do not claim automatic publication to every OTA. Live outbound publishing remains provider-specific. | roadmap `ch-outbound-publish`; publishing preparation UI |
| Pricing | ASI can prepare pricing recommendations using operational/location signals. | Recommendations are not automatically published unless a specific accepted provider integration supports it. | `PricingIntelligencePanel.tsx`; RU homepage |
| Guest access | ASI can coordinate access readiness and release instructions. | Direct smart-lock/PIN automation is claimed only for a configured supported lock integration. Mechanical keys/key boxes remain valid flows. | communication/readiness workflows; public FAQ |
| Cleaning / maintenance | ASI can create, track, and escalate tasks/readiness checks. | External worker assignment/delivery depends on the configured workflow/integration; otherwise operator/manual handoff applies. | booking-ops lifecycle/alerts; public FAQ |
| Payments | Registration/pilot does not automatically activate a paid plan. | Provider and payment methods depend on market/configuration. No recurring or paid activation without explicit customer acceptance. | RU payment/early-access pages; `src/app/offer/page.tsx` |
| RU payment provider | YooKassa is the intended RU processor when enabled. | Public copy must continue to state that payment acceptance is disabled until moderation/configuration is complete. | `PilotCheckoutCta.tsx`, YooKassa disabled tests |
| International billing | Paid international service may be introduced later. | Current Terms state no paid international subscription is offered; price/refund/frequency must be published before activation. | `src/app/offer/page.tsx` |
| Legal / deposit / MVD | ASI can track readiness, collect required state, and create operator work. | Do not claim external e-sign, booking-deposit PSP execution, or external MVD submission until their roadmap blockers are accepted. | roadmap legal-e-sign / legal-payment-provider / legal-mvd-external-send |
| SLA | ASI uses reasonable efforts to keep service available and provides support through published channels. | No fixed uptime %, response time, or maintenance-notice guarantee unless a paid service plan separately defines it. | `src/app/offer/page.tsx` |
| ROI / staffing | ASI is designed to reduce manual coordination and allow portfolios to scale with less operational overhead. | No fixed ROI, guaranteed payback period, or guaranteed staff elimination. | public FAQ |
| International domain | International canonical marketing origin is `https://www.guestautopilot.com`. | Apex redirects to `www`; do not publish `asi-global.com` as canonical/hreflang. | `src/config/publicOrigins.ts`, nginx config, brand-system doc |
| RU domain | Russian public origin is `https://asi-global.ru`. | RU legal/contact identity stays on the RU property and is not reused as international legal identity. | `src/config/publicOrigins.ts`, `ruCompliance.ts` |
| Trial | Setup/pilot can start without automatic paid conversion; the operational trial starts under the terms shown for the active market. | A paid plan starts only after explicit plan acceptance; do not use “trial converts” wording. | rental-autopilot CTA, RU commercial timeline, Terms |

## Forbidden until evidence changes

Do not publish the following as current production facts: “99% automation”, “full operational automation”, “runs itself”, “replaces your ops team”, automatic channel sync/publishing across all providers, automatic pricing publication, guaranteed payback/staff reduction, or a fixed uptime/support SLA.

When a blocked capability becomes accepted, update the roadmap/evidence first, then update this matrix and the public copy in the same change.
