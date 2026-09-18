# RU public site map (v0)

Mapping and configuration only — this file holds no editorial answers. `scripts/preflight.mjs`'s `ROUTE_MAP` constant must stay in sync with the table below, the same convention `asi-staging-acceptance` uses for its fixed identity constants.

- Production public host: `https://www.asi-global.ru`
- Supported markets in v0: `ru` only. The structure below is designed so additional RU routes, and later additional markets, can be appended without rewriting this Skill.

## Routes

| Route | Source | Focused test | Auditor entrypoint |
|---|---|---|---|
| `/ru` | `src/app/ru/page.tsx` | `src/app/ru/__tests__/homepage-design.test.ts` | `npm run site:audit -- --base-url https://www.asi-global.ru/ru` |

## Surface classification

Default auto-edit-eligible scope (subject to the owner gate in `scripts/preflight.mjs`):

- ACQUISITION
- PRODUCT_EXPLANATION
- FORM

Default read-only scope — never automatically rewritten by this Skill:

- LEGAL
- AUTH
- UTILITY
- REPORT_PRODUCT
- dashboard, admin, API, payment, and Runtime-behavior pages

## Adding a route

1. Add a row to the table above with its source path, focused test path, and auditor entrypoint.
2. Add the matching entry to `ROUTE_MAP` in `scripts/preflight.mjs`.
3. Classify the route per the surface classification above; do not add a LEGAL/AUTH/UTILITY/REPORT_PRODUCT route to the auto-edit-eligible set.
