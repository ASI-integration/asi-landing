# Implementation roadmap, gaps and acceptance

Priority follows dependency and risk, not a promised schedule. Baseline and source citations are in ARCHITECTURE and SOURCE-AUDIT. The full independently reviewed file-by-file gap matrix accompanies the private evidence bundle.

| Capability | Existing / delivered | Remaining work and gate |
| --- | --- | --- |
| Universal address and geography | Existing provider pipeline, LocationAnalysis, H3/heatmaps; shared property revision in slice | Authenticated immutable snapshot adapter; independently resolve ambiguous buildings and actual entrance routes |
| Residential strategies/purchase | Existing qualitative scores; new LTR/STR/purchase cash ledger | Real purchase/rent/operating datasets; scenario-specific evidence, financed and unlevered comparisons |
| Pedestrian traffic | Existing labeled OSM proxy; new sample extrapolation helper | Repeated dated counts, direction/line/weather/weekends; no full-day measurement inferred from10min |
| Commercial demand and categories | Existing six-category fit reused | Dated tenant/category sales, micro-location competition, seasonality and concentration risk |
| Retail premises | Existing floor/frontage/entry caps retained; cells add windows/utilities | Surveyed steps/widths/ceilings/fit-out, ventilation/wet-core/power permits, accessibility and code professional review |
| Irregular subdivision | New unequal connected cell partitions, constraints and bounded assignment | Polygon/cut generator, actual egress/common-route graph, engineering-approved topology and costs |
| Whole vs split | New common ledger, additional unit capex/opex and comparable outputs | Full bill of quantities, lease-up scenarios, category defaults and risk sensitivity |
| Financing and returns | NPV, conventional IRR, debt/exit cash and deposit segregation | Amortization, VAT/tax engine, dated cash, break-even and uncertainty intervals |
| Utility charges | Missing/negative meter safeguards | Multi-tenant/common shares, tariff periods, residual allocation and reconciliation receipts |
| Booking Ops / Strigunov | Existing scope/revision/advisory boundaries unchanged | Read-only authorized actuals adapter; independent operational acceptance remains separate |
| Report/access/payment | Existing auth/payment/access code untouched | New authenticated report adapter must reuse grants and audit legacy entitlement behavior before exposing economics |
| Evidence / privacy | Source hashes, classifications and private review bundle | Acquisition authentication, licensing registry, immutable object store, field-level lineage and revocation |
| Geographic calibration | Existing PR462 baseline HOLD | 12 remaining failures require independent truth; no threshold/golden manipulation |

## Sequenced gates

**G0 — this sprint:** private full-source inventory/review; architecture/gaps; additive pure models; deterministic focused tests; independent code review; exact-head Linux CI; draft PR only. All outputs remain advisory. PASS here only establishes the tested implementation behavior.

**G1 — scoped property adapter:** reuse canonical address/geography and authenticated property snapshots. Acceptance: same building/entrance/evidence revision across residential and commercial; cross-account ID, stale revision, ambiguous building, expired source and forged source label all rejected or held appropriately. Public geodata caching cannot expose private plans or economics. Paid report routes require existing authentication and entitlement even if scenario calculation succeeds.

**G2 — surveyed layout pilot:** obtain one owner-authorized nonproduction property package: dimensioned plan, actual entrance/window/wall measurements, utility capacity evidence, legal-use/sublease rights, current anonymized rent comparables and cost quotes. Acceptance: independent engineer checks polygon area conservation, no overlap, all access routes, hard wall/cut constraints, common circulation, simultaneous utility capacity and fit-out feasibility. Include unequal and L-shaped units, impossible basement food use, unknown exhaust, no-step requirements and tenant conflicts. No automated approval from image appearance.

**G3 — economic underwriting:** independent spreadsheet cross-check with cash timing, taxes, deposits, capex contingency, vacancy, collection losses, rent escalation, repairs, debt and exit. Acceptance: whole-versus-split comparator identifies both a split-winning and whole-winning case for explainable cash differences; rent-free and delays reduce receipts; refundable liabilities never create profit; missing taxes/market rents block net-return claims. Sensitivity and break-even tests need manually verified expected results; scenarios remain estimates until actuals exist.

**G4 — geographic/commercial benchmark:** metro, residential, suburban, coastal/resort, mountain and smaller-city cases with provenance, coordinate uncertainty, actual entrance routes, barriers, population/demand data and confidence. Acceptance: POI use differs from building use; opposite-side street count differs from storefront flow; map layers state units/time/method; no observed sales or traffic from OSM. Existing 44/56 calibration remains separately visible until legitimate evidence resolves it.

**G5 — authenticated advisory product:** add report/UI adapters and read-only Booking Ops actuals, with access-control integration tests, historical payment reconciliation review, privacy retention/deletion, deterministic versioned reports and explicit owner/survey/legal signoff. No executor/Custodian authority and no guest sends. Real installation or live-commercial acceptance requires separate authorization and evidence.

## Executable acceptance mapping

`src/lib/real-estate-intelligence/__tests__/unified-scenarios.test.ts` covers scoped shared revision, unresolved/stale evidence, synthetic traffic rejection, incompatible use, seasonal STR, retained basement caution, unequal15/25 vswhole40 and6common area, L-shaped union, overlap/corner errors, blocked structural merges, entrances, aggregate power, utility unknown/absent distinction, category count/affordability, search truncation, ID collision, fit-out/vacancy/collection, stale-course-profit correction, tenant/own deposits, NPV/IRR, annual timing, unknown tax, financing/exit, nonfinite inputs, meter readings and sampled traffic. Test counts and exact run receipts are recorded in final reports rather than predeclared here.

The dedicated Linux workflow is offline and read-only, uses pinned actions and exact source SHA, runs focused tests/typecheck/lint and uploads receipts. It does not deploy, send messages, use production secrets or claim to close baseline calibration. Existing source and golden files are unchanged; broad completed suites are not rerun merely to inflate counts.

## Next concrete owner input

Provide one authorized property evidence package for G2 (dimensioned plan plus utility/legal-use documentation and dated rent/capex evidence). This unlocks a defensible real-property comparison; Hetzner access does not supply these missing facts.
