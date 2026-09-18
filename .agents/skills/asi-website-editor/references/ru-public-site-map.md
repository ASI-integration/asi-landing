# RU public site map (v0)

Mapping and configuration only — this file holds no editorial answers. `scripts/preflight.mjs`'s `ROUTE_MAP` constant must stay in sync with the table below, the same convention `asi-staging-acceptance` uses for its fixed identity constants.

- Production public host: `https://www.asi-global.ru` — **pre-edit visitor-baseline reading only.** Never audited or cited as post-edit verification of a task branch's source changes.
- Local verification target: `http://127.0.0.1:3101` — start with `npm run dev -- --hostname 127.0.0.1 --port 3101` from the current task branch, run `npm run site:audit -- --base-url http://127.0.0.1:3101<route>` against it, then stop the server. This is the **only** valid post-edit deterministic-auditor target, because it renders the edited branch's source rather than unchanged production. Port `3101` is fixed here (distinct from the default dev port `3000` and from `asi-staging-acceptance`'s fixed staging port `3001`) so it never collides with another local server; keep `LOCAL_VERIFICATION_PORT` in `scripts/preflight.mjs` in sync with this value.
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
