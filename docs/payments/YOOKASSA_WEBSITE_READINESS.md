# YooKassa website merchant readiness (v1)

Map of public RU surfaces prepared for YooKassa merchant review.
Live payments and production deploy are **not** enabled by this work.

## Published MVP (VERIFIED)

| Field | Value | Source |
| --- | --- | --- |
| Service | Ранний доступ: AI-коммуникации для посуточной аренды | `src/lib/payments/yookassa-env.ts` |
| Scope | 1 объект, 1 месяц | same |
| Price | 1000 ₽ | `COMMUNICATION_PILOT_PRICE_RUB` |
| Checkout API | `POST /api/yookassa/create-payment` | returns 503 + pending message when `YOOKASSA_ENABLED` is not `true` |
| UI entry | `/ru/payment`, `/ru/early-access#pilot-tariff` | `PilotCheckoutCta` |

## Legal / contacts routes

| Route | Purpose |
| --- | --- |
| `/ru/early-access` | Product + tariff + safe checkout CTA |
| `/ru/payment` | What is sold, delivery, payment method, checkout |
| `/ru/offer` | Public offer |
| `/ru/privacy` | Privacy policy |
| `/ru/refund` | Refund / cancellation |
| `/ru/contacts` | Contacts + legal entity |
| `/ru/how-it-works` | Platform overview; points MVP sale to early-access |

Footer/nav: `RuComplianceFooter`, `RuBottomQuickLinks`, `RuPublicNavHeader`.

## VERIFIED seller data (owner-confirmed, publishable on RU surfaces)

| Field | Value | Status |
| --- | --- | --- |
| Seller | Реутова Юлия Игоревна | VERIFIED |
| INN | 235307941957 | VERIFIED |
| Email | `support@asi-global.ru` | VERIFIED |
| Phone | `+7 995 889-49-03` | VERIFIED |
| Correspondence address | Ленинградская область, г. Мурино, ул. Оборонная, д. 37, корп. 1 | VERIFIED |
| MVP tariff | 1000 ₽ / 1 object / 1 month AI communications pilot | VERIFIED |
| Telegram | `@ASI_Support_Bot` | VERIFIED (support channel) |
| OGRN / OGRNIP | N/A — not provided for самозанятый; do not invent | N/A |

Source of truth: `src/config/ruCompliance.ts` (+ email via `productSupportEmail`).

## Explicitly out of scope here

- Enabling `YOOKASSA_ENABLED=true`
- Live charges, production deploy, merge to main
- Inventing postal index, apartment number, OGRN/OGRNIP, or other legal/price data
- Publishing seller postal details on international ASI Global marketing pages
