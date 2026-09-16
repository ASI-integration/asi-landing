# YooKassa website merchant readiness (v1)

Map of public RU surfaces prepared for YooKassa merchant review.
Live payments and production deploy are **not** enabled by this work.

## Published MVP

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
| `/ru/contacts` | Contacts + legal entity (no invented phone/address) |
| `/ru/how-it-works` | Platform overview; points MVP sale to early-access |

Footer/nav: `RuComplianceFooter`, `RuBottomQuickLinks`, `RuPublicNavHeader`.

## Proven seller data (in repo)

- Self-employed: Реутова Юлия Игоревна
- INN: 235307941957
- Email: `support@asi-global.ru` (overridable via `NEXT_PUBLIC_CONTACT_EMAIL`)
- Telegram: `@ASI_Support_Bot`

## Owner input still required

- Public phone number (not published until confirmed)
- Correspondence address (page says “по запросу на email” until confirmed)
- OGRN/OGRNIP: not applicable for самозанятый; confirm if YooKassa asks for another registration id

## Explicitly out of scope here

- Enabling `YOOKASSA_ENABLED=true`
- Live charges, production deploy, merge to main
- Inventing legal/price/contact data beyond repo sources
