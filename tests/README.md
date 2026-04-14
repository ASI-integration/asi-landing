# Testing — asi-landing

Pragmatic smoke / regression / accessibility suite.  
Target: **asi-global.ru** (override with `BASE_URL` env var for local runs).

---

## Quick start

```bash
# Smoke — pages, header, navigation, broken links
npm run test:smoke

# Responsive — overflow / layout on desktop + tablet + mobile
npm run test:responsive

# Accessibility — axe critical/serious violations
npm run test:a11y

# Lighthouse — performance / a11y / SEO scores
npm run lighthouse

# All Playwright tests across all viewports
npm run test:e2e

# Open last HTML report
npm run test:e2e:report
```

**Local dev server (override base URL):**
```bash
BASE_URL=http://localhost:3000 npm run test:smoke
```

---

## What's covered

### `smoke.spec.ts` — runs on `desktop` (Chrome)

| Section | What it checks |
|---------|---------------|
| A. Pages 404 | Each key page returns HTTP < 400, body visible |
| B. Header | Present, logo link, "Доходность объектов" nav link, login button, no duplicate "Контакты", no overlapping links |
| C. Navigation flows | Home→Revenue report, Revenue→Methodology, Methodology→Revenue, Contacts link |
| D. Broken links | No `href="#"` or empty hrefs; all RU nav links return < 400 |

**Pages covered:** `/` · `/ru` · `/ru/otchet-po-dohodnosti-obektov` · `/ru/kak-my-ocenivaem-dohodnost-obektov`

---

### `responsive.spec.ts` — runs on `desktop` + `tablet` + `mobile`

| Check | Detail |
|-------|--------|
| No horizontal scroll | `scrollWidth <= clientWidth` |
| Header visible | On RU pages |
| No right-edge overflow | No element's `getBoundingClientRect().right > viewportWidth + 1px` |
| Main content visible | `<main>`, `<article>`, or `<section>` visible |

---

### `a11y.spec.ts` — runs on `desktop` (Chrome)

Uses `@axe-core/playwright` with `wcag2a`, `wcag2aa`, `best-practice` tags.

- **Fails** on `critical` and `serious` violations  
- **Logs** `moderate` / `minor` violations as informational (doesn't fail)

---

### `scripts/lighthouse.mjs` — standalone Node script

Runs Lighthouse desktop audits on all 4 key pages.  
Checks: Performance · Accessibility · Best Practices · SEO

**Score warning thresholds** (warns, doesn't exit with failure):
- Performance: 50
- Accessibility: 80
- Best Practices: 80
- SEO: 80

**Outputs:**
- Console: score table
- Files: `lighthouse-reports/<slug>.html` + `<slug>.json`

Audit a single page:
```bash
node scripts/lighthouse.mjs --page /ru/otchet-po-dohodnosti-obektov
```

---

## Artifacts on failure

| Artifact | Location |
|----------|----------|
| Screenshots (on failure) | `test-results/` |
| Traces (on first retry) | `test-results/` |
| HTML test report | `playwright-report/index.html` |
| Lighthouse HTML reports | `lighthouse-reports/*.html` |
| Lighthouse JSON data | `lighthouse-reports/*.json` |

Open HTML report:
```bash
npm run test:e2e:report
# or directly:
npx playwright show-report
```

---

## Adding a new page to the smoke suite

1. Open `tests/smoke.spec.ts`
2. Add to `SMOKE_PAGES`:
   ```ts
   { path: '/ru/new-page', label: 'New page' },
   ```
3. If it uses `RuPublicNavHeader`, also add to `RU_NAV_PAGES`.
4. Repeat in `tests/responsive.spec.ts` (`PAGES` array) and `tests/a11y.spec.ts` (`PAGES` array).
5. For Lighthouse, add to `DEFAULT_PAGES` in `scripts/lighthouse.mjs`.

---

## Playwright projects (viewports)

| Project name | Device |
|-------------|--------|
| `desktop` | Desktop Chrome (1280×720) |
| `tablet` | iPad gen 7 (810×1080) |
| `mobile` | Pixel 5 (393×851) |

Run a specific project:
```bash
playwright test --project=mobile
```
