# ASI Brand System

## REFERENCE IMPLEMENTATION

**guestautopilot.com** is the approved visual reference for all ASI customer-facing sites.

## RULE

All ASI customer-facing sites share **one visual system**.  
There is **no separate Russian visual identity**.

`asi-global.com` remains out of scope / nonexistent.

## MANDATORY

- **Shiro** is the official recurring brand signature (approved artwork under `/brand/shiro-badge.png`).
- Shared typography, palette, spacing, hierarchy, content widths, cards, buttons, borders/radii, imagery treatment, section rhythm, navigation visual language, and responsive behavior.

## SHARED (appearance)

| Layer | Location |
| --- | --- |
| Color + type scale | `tailwind.config.js` (`asi.*`, `fontFamily.serif`) |
| Token constants | `src/config/brand/tokens.ts` |
| Token bridge for RU ThemeProvider | `src/styles/brand/asi-brand.css` + `src/app/globals.css` `[data-theme]` |
| Section / eyebrow / CTA primitives | `src/components/site/primitives.tsx` (re-exported via `src/components/brand`) |
| Shiro / LogoMark | `src/components/site/Shiro.tsx`, `LogoMark.tsx` |
| Brand wrappers | `src/components/brand/*` |

Shared brand code must **not** contain market merchant identity, INN, Russian legal/payment routes, YooKassa, tariff, or country-specific CTA destinations.

## MARKET-SPECIFIC (content / business / legal)

- Language and copy
- Campaign messaging
- Pricing / tariff
- Legal documents and seller identity
- Payment providers and fail-closed messaging
- Contacts
- Country-specific imagery where justified
- Navigation *labels and routes* (visual chrome stays shared)

RU market content lives under `src/config/ruCompliance.ts`, `src/config/ruNav.ts`, and `src/components/ru/*`.

## SHIRO CONTRACT

- Use existing approved artwork; do not invent a different Russian cat.
- Prefer `BrandShiro` / `Shiro` with `signature` for footer lockups; smaller sizes for inline accents.
- Provide meaningful `alt` text; decorative pairing may use `aria-hidden` on adjacent ornaments only.
- Recur as a signature, not in every content section.

## SITE MAPPING

| Surface | Visual system | Content |
| --- | --- | --- |
| guestautopilot.com | ASI brand | Western / Claude-owned |
| www.asi-global.ru | Same ASI brand | RU closed-beta market |

## NEXT

RU-DESIGN-02 — full Russian homepage visual migration using this shared foundation.
