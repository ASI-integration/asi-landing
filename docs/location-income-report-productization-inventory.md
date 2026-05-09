# Location / Income Potential Report Productization Inventory

Date: 2026-05-09

Goal: inventory and productize the Location / Income Potential Report without changing the scoring/math engine.

## Existing Routes

Public demo and product pages:

| Route | File | Role |
| --- | --- | --- |
| `/ru/location-analysis` | `src/app/ru/location-analysis/page.tsx` | RU fast preview/demo entry. Uses `LocationIntelligenceDemo`. Supports `?mode=residential` and `?mode=commercial`. |
| `/features/location-analysis` | `src/app/features/location-analysis/page.tsx` | EN fast preview/demo entry. Uses `LocationIntelligenceDemo`. |
| `/ru/location-report` | `src/app/ru/location-report/page.tsx` | Empty state explaining that full reports now use permalink IDs, not session-only data. |
| `/ru/location-report/[reportId]` | `src/app/ru/location-report/[reportId]/page.tsx` | RU persisted report permalink. Renders residential or commercial report by stored JSON version. |
| `/location-report/[reportId]` | `src/app/location-report/[reportId]/page.tsx` | EN/global persisted report permalink. |
| `/ru/location-report/sample` | `src/app/ru/location-report/sample/page.tsx` | Safe sample full report, explicitly marked demo/sample. |
| `/ru/otchet-po-dohodnosti-obektov` | `src/app/ru/otchet-po-dohodnosti-obektov/page.tsx` | Product packaging page for the report. |
| `/ru/kak-my-ocenivaem-dohodnost-obektov` | `src/app/ru/kak-my-ocenivaem-dohodnost-obektov/page.tsx` | Methodology page. |

Legacy/report routes to treat carefully:

| Route | File | Status |
| --- | --- | --- |
| `/report` | `src/app/report/page.tsx` | Legacy EN landing page for a generated report product. Contains stronger old positioning and should not be used as the canonical location-report route. |
| `/report/[id]` | `src/app/report/[id]/page.tsx` + `src/lib/report/generator.ts` | Legacy deterministic demo generator. It bypasses the OSM/canonical location engine and uses hash-based fake values via `src/lib/location/scoring.ts`. Do not promote for the current product. |

## API / Backend Surface

| Route | File | Role |
| --- | --- | --- |
| `GET /api/address-suggest` | `src/app/api/address-suggest/route.ts` | Address suggestions via provider pipeline. |
| `POST /api/address-resolve` | `src/app/api/address-resolve/route.ts` | Resolve selected suggestion to coordinates. |
| `POST /api/location-geocode` | `src/app/api/location-geocode/route.ts` | Plain geocoding. |
| `POST /api/location-demo-analyze` | `src/app/api/location-demo-analyze/route.ts` | Fast preview analysis: fetch OSM, run `buildAnalysis`, cache residential/default results, return `LocationAnalysis` plus metadata. |
| `POST /api/location-full-report/request` | `src/app/api/location-full-report/request/route.ts` | Creates async full-report request with `queued` status. |
| `GET /api/location-full-report/request/[requestId]` | `src/app/api/location-full-report/request/[requestId]/route.ts` | Polls async request status and returns `reportId` when completed. |
| `POST /api/location-full-report/process` | `src/app/api/location-full-report/process/route.ts` | Processes queued request: geocode if needed, fetch OSM, run `buildAnalysis` with spatial foundation, build residential/commercial report, persist permalink. |
| `POST /api/location-standalone-report` | `src/app/api/location-standalone-report/route.ts` | Persists an already-built standalone report and returns `reportId`. |
| `GET /api/location-standalone-report/[reportId]` | `src/app/api/location-standalone-report/[reportId]/route.ts` | Fetches persisted report JSON. Accepts residential v1 and commercial v2 reports. |
| `POST /api/location-report` | `src/app/api/location-report/route.ts` | Older paywall wrapper around `LocationScoreOutput`. Uses canonical OSM analysis but only returns preview/full score payload, not the productized full-report permalink. |
| `POST /api/location-competitors` | `src/app/api/location-competitors/route.ts` | Separate competitor market-data route. Not wired into the current permalink full report. |
| `POST /api/location-analyze` | `src/app/api/location-analyze/route.ts` | Proxy to `ASI-automation-core`; separate from the OSM demo/full-report path. |

Persistence:

| Table | Migration | Role |
| --- | --- | --- |
| `location_standalone_reports` | `supabase/migrations/20260415000002_location_standalone_reports.sql` | Stores report JSON for permalink pages. |
| `location_report_requests` | `supabase/migrations/20260421000001_location_report_requests.sql` | Stores async full-report request lifecycle. |

## Components

| Component | File | Role |
| --- | --- | --- |
| `LocationIntelligenceDemo` | `src/components/LocationIntelligenceDemo.tsx` | Address input, suggestion/resolve flow, fast preview UI, and CTA buttons to demo permalink or async full report. |
| `LocationStandaloneFullReport` | `src/components/location/LocationStandaloneFullReport.tsx` | Residential full report renderer for `LocationStandaloneReport` v1. Print-ready. |
| `CommercialReportView` | `src/components/location/CommercialReportView.tsx` | Commercial/spatial report renderer for `LocationCommercialReport` v2. Print-ready. |
| `LocationReportProductView` | `src/components/location/LocationReportProductView.tsx` | Contract-driven sample/full-report deliverable view using `FullLocationReport`. Print/PDF ready. |
| `location-intelligence-locale.tsx` | `src/components/location-intelligence-locale.tsx` | Locale copy and labels for the demo UI. |
| `ru-demo-copy.ts` | `src/components/ru-demo-copy.ts` | RU demo safety copy and disclaimers. |

## Data Flow

Fast preview/demo:

1. User enters address in `LocationIntelligenceDemo`.
2. Client calls `/api/address-suggest`.
3. User selects suggestion, or fallback geocoding runs.
4. Client calls `/api/location-demo-analyze` with `{ lat, lon, locale, spatialFoundation? }`.
5. API fetches OSM via `fetchOsmData`, then runs `buildAnalysis`.
6. API returns `LocationAnalysis` plus `AnalysisMeta` warnings/confidence.
7. Client renders score, demand explanation, magnets, competition, income orientation, and CTA.

Demo permalink from current preview:

1. Client builds `LocationStandaloneReport` or `LocationCommercialReport` from the in-memory `LocationAnalysis`.
2. Client posts report JSON to `/api/location-standalone-report`.
3. API stores JSON in `location_standalone_reports`.
4. Client routes to `/ru/location-report/[reportId]` or `/location-report/[reportId]`.

Async full report:

1. Client posts address/mode/locale/delivery intent to `/api/location-full-report/request`.
2. API stores request in `location_report_requests` with `queued`.
3. Client triggers `/api/location-full-report/process`.
4. Processor geocodes if needed, fetches OSM, runs `buildAnalysis(..., { spatialFoundation: true })`.
5. Processor builds residential or commercial report and persists it.
6. Processor marks request `completed` with `report_id`.
7. Client polls status endpoint and opens the permalink.

## Storage And Report Passing

Current full report rendering does not depend on `sessionStorage`. Persisted report pages fetch by `reportId`.

Current browser storage usage:

| Storage | File | Purpose | Report dependency? |
| --- | --- | --- | --- |
| `sessionStorage` | `src/components/LocationIntelligenceDemo.tsx` | Stores last/previous RU city hint for address autocomplete only. | No. |
| `localStorage` | `src/app/report/[id]/ReportView.tsx` | Legacy fake report paywall/free-report/comparison state. | Legacy only; not canonical. |
| `localStorage` | `src/app/compare/page.tsx` | Legacy report comparison list. | Legacy only. |

New boundary:

| File | Role |
| --- | --- |
| `src/lib/location/report-contract.ts` | Stable product contract for fast preview and full commercial report structures. |
| `src/lib/location/report-state.ts` | Report state/permalink helpers: `reportId`, `requestId`, `status`, `source`, and URL construction. |

## Canonical Data Usage

Used by current canonical location logic:

| Canon / logic | File | Used by |
| --- | --- | --- |
| Magnet categories, weights, radius, colors | `src/lib/location/config.ts` | OSM classification, gravity scoring, UI labels/colors. |
| OSM classification | `src/lib/location/overpass.ts` | `fetchOsmData`, `classifyElement`. |
| Gravity, demand, cluster, competitor pressure | `src/lib/location/gravity-scoring.ts` | `buildAnalysis`, demo and full report processing. |
| Audience fit | `src/lib/location/audience-scoring.ts` | `buildAnalysis`, report and UI audience sections. |
| Canonical signal taxonomy | `src/lib/location/signals/location-signal-taxonomy.ts` | Audience/scoring explainability and weak-signal safety. |
| Residential prime magnet policy | `src/lib/location/residential-prime-magnets.ts` | `buildLocationStandaloneReport`, RU visible magnet filtering. |
| Income potential / strategy | `src/lib/location/location-score.ts` | `LocationScoreOutput`, preview income range, report income strategy. |
| Competition pressure | `src/lib/location/gravity-scoring.ts` and `competitors.ts` | OSM competitor pressure in current reports; separate market route is not wired into full report. |
| Commercial format fit | `src/lib/location/commercial-format-fit.ts` | Commercial preview/report. |
| Spatial foundation | `src/lib/location/spatial-foundation.ts` | Full async report path when processing uses `spatialFoundation: true`. |

Known bypasses / non-canonical surfaces:

| File | Bypass |
| --- | --- |
| `src/lib/location/scoring.ts` | Old deterministic hash/LCG scoring. Not OSM/canonical. Used by legacy `/report/[id]`. |
| `src/lib/report/generator.ts` | Fake report generator for legacy `/report/[id]`. Invents market values from address hash. Do not use for sellable report output. |
| Static marketing visuals in product pages | UI illustration only. Must remain labeled as examples/demo and avoid factual claims. |

## Product Structure

Fast demo report:

- Address / object summary
- Overall score
- Short demand explanation
- Top 3 demand drivers
- Main risks
- Preview income potential range when `LocationScoreOutput` is available
- CTA to full report
- Confidence / data-quality note

Full commercial report:

- Executive summary
- Score breakdown
- Demand drivers
- Primary magnets
- Secondary magnets
- Target audience fit
- Competition overview
- Income potential
- Risks and limitations
- Recommended strategy
- OTA/channel strategy note
- Next steps
- Confidence / data quality notes

## Missing / Broken Links Found

- `GET /api/location-standalone-report/[reportId]` previously rejected commercial `v2-commercial` reports even though creation and page rendering accepted them. Fixed to accept both persisted report versions.
- Legacy `/report/[id]` still bypasses canonical location logic. Keep it out of current product CTAs or replace later.
- Full report delivery via email/Telegram is represented in request intent but not implemented as an actual sending pipeline.
- `/api/location-competitors` exists but is not integrated into the permalink full report; current report competition is OSM/gravity based.
- `LocationReportProductView` sample route exists for product packaging, but persisted canonical reports still render through the existing v1/v2 report components.

## Print / PDF Readiness

- `LocationStandaloneFullReport`, `CommercialReportView`, and `LocationReportProductView` now use the `location-report-print` print scope.
- Unnecessary nav/buttons are hidden with `print-hide`.
- Browser print can be used as "Save as PDF"; no server-side PDF infrastructure is added.
