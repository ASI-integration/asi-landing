# ASI Cabins — Worldwide Property Discovery Crawler (Draft v1)

## Geographic scope (owner decision, 2026-11-04)

**WORLDWIDE**, every urban centre with **strictly more than 1,000,000 residents** under the UN's **World Urbanization Prospects 2025 / DEGURBA** harmonised definition. City/urban-centre population is **not** municipal population; metropolitan totals can differ considerably from other sources.

The current published shortlist contains **500 eligible cities in 125 countries/areas**, after the owner's explicit country exclusions:

- **Exclude:** Bangladesh (**BD**), Myanmar (**MM**), North Korea (**KP**), Timor-Leste (**TL**).
- **Include**, among other places: **Russia (RU, 7 cities)**, **Japan (JP, 9)**, **Taiwan (TW, 3)**, **South Korea (KR, 5)**. These counts and the full dataset are generated from the same source.
- These exclusions are choices about suitability for this particular project; the software **does not** score entire countries by subjective labels such as "dirty". Other risks (official travel advisories, lodging legality, tourism volume, commercial vacancy and accessibility) need separate, independently sourced reviews. They have not been applied automatically.
- **All approved countries** are eligible for discovery; no arbitrary regional/country whitelist.

Canonical research file in this branch: [data/world_cities_1m_2025.csv](data/world_cities_1m_2025.csv). Provenance/counts: [data/world_cities_1m_2025.manifest.json](data/world_cities_1m_2025.manifest.json). Official source: [UN WUP 2025 File F21](https://population.un.org/wup/downloads?tab=Cities).

## Components

- `scope.py`: single-source-of-truth owner exclusion policy and strictly >1,000,000 threshold.
- `global_cities.py`: Python standard-library parser for the downloaded UN WUP 2025 XLSX, with country selection, source provenance, JSONL and Excel-compatible CSV.
- `crawler.py`: read-only property-page discovery, domain allowlist, robots.txt fail-closed checks, public-address DNS checks, redirects disabled, minimum 2s delay, page limits, approximate property extraction, candidate scoring and errors.
- `campaign.py`: resumable, single-command crawl runner; tracks per-source city offsets and preserves existing leads between batches. Stops on access failures/uncertain completeness rather than falsely advancing progress.
- `sources.json`: early property directory candidates; **all DISABLED** until site-specific terms, robots and real search URL formats are verified. No live property scraping or outreach has yet happened.
- `cities.py`: retained *legacy* GeoNames 9-country/low-population tool; **not used in the worldwide 1m+ campaign**.
- `market_tiers.py`: new three-level research order; keeps unknown financing, partner interest, profitability, and Evergreen separate from measured demand.\n- `test_*.py`: offline tests. 

## Recreate the worldwide city list

On the authorised Windows computer, from its `H:\ASI-Cabins-Crawler\app` working directory:

```powershell
C:\Python314\python.exe H:\ASI-Cabins-Crawler\app\global_cities.py --input H:\ASI-Cabins-Crawler\WUP2025-F21-DEGURBA-Cities_Pop.xlsx --output H:\ASI-Cabins-Crawler\world_cities_1m_2025.jsonl
```

The UN data file was obtained from:
```
https://population.un.org/wup/assets/Download/Cities/WUP2025-F21-DEGURBA-Cities_Pop.xlsx
```

Expected local outputs:
```
H:\ASI-Cabins-Crawler\world_cities_1m_2025.jsonl
H:\ASI-Cabins-Crawler\world_cities_1m_2025.csv
H:\ASI-Cabins-Crawler\world_cities_1m_2025.manifest.json
```

**Important:** Rebuilding the UN geographic catalog does *not* access any real estate portal or assert that a place is safe, tourist-popular or suitable for a cabin hotel. No credential or API key is required for this import.

## Market attractiveness ranking — 2026 evidence screen

The world list has now been **prioritised for property research**, rather than traversed alphabetically.

- Full sortable 500-city research ranking: [data/market-priority-2026.csv](data/market-priority-2026.csv).
- Documented sources, limitations and score coverage: [data/market-priority-2026.manifest.json](data/market-priority-2026.manifest.json).
- Legacy **48-city** demand/safety exploratory queue (superseded for first-pass work by the 11-city Tier I below): [data/ranked-city-catalog-focus.jsonl](data/ranked-city-catalog-focus.jsonl).
- Original worldwide 500-city city population source remains preserved separately.

The 0–100 **preliminary research-priority** score has four components:

| Component | Maximum | Actual data basis |
| --- | ---: | --- |
| Tourism demand | 40 | When available, city-specific *2025* Euromonitor arrivals for one of its published top-ten inbound destinations; otherwise latest 2019–2024 *country* arrivals from UN Tourism / Our World in Data. Country-wide proxy is capped at 30 points; stale years are flagged. |
| Safety screen | 35 | 2026 Global Peace Index *Safety & Security* country domain (20); recent UNODC intentional-homicide rate per 100,000 in the country (15). Homicides ≠ overall crime, nor neighbourhood-level safety. |
| Urban scale | 15 | UN WUP 2025 urban-centre population (log scale, not direct travel demand). |
| Independently confirmed 2025 city tourism signals | 10 | 5 points if listed in Euromonitor's top ten by international arrivals + 5 points if in its overall top ten city destinations. Other cities receive no *verified top-ten bonus*, **not** a claim they have poor infrastructure. |

Research sources: [UN WUP](https://population.un.org/wup/downloads?tab=Cities), [UN Tourism country arrivals via OWID](https://ourworldindata.org/grapher/international-tourist-trips), [UNODC homicide via OWID](https://ourworldindata.org/grapher/homicide-rate-unodc), [IEP Global Peace Index 2026](https://gpi.economicsandpeace.org/), [Euromonitor 2025](https://lp.euromonitor.com/newsroom/press-releases/december-2025/euromonitor-international-unveils-worlds-top-100-city-destinations-for-2025).

Missing inputs are **not converted into invented real-world measurements**: they earn no model points and trigger explicit evidence grades and missing-data flags. A country's total tourists or homicide rate must never be misreported as a city's tourists or crime rate. Country-level conflict signals create a **SAFETY_REVIEW**, but do **not** silently erase Russia or any other non-excluded country.

Top tier counts for the 2026 screening: **6 A-PRIORITY, 38 B-SHORTLIST, 4 B-SAFETY_VERIFY**. All **500** cities remain in the full ranking; the **48-city** focused queue is only for first-pass search effort.

**This is NOT a financial investment ranking.** It lacks comparable city hotel occupancy, average daily rate, property supply, rent/price per usable square metre, renovation cost, permitted lodging conversion and local competitive capacity. Those must be verified from property and accommodation sources before computing operating margins or ROI.

Rebuild the ranking from local, separately downloaded data files:

```powershell
C:\Python314\python.exe H:\ASI-Cabins-Crawler\app\market_priority.py --city-catalog H:\ASI-Cabins-Crawler\world_cities_1m_2025.jsonl --tourism-csv H:\ASI-Cabins-Crawler\market-data\tourism.csv --homicide-csv H:\ASI-Cabins-Crawler\market-data\homicide.csv --gpi-csv H:\ASI-Cabins-Crawler\market-data\gpi_2026.csv --country-info H:\ASI-Cabins-Crawler\market-data\countryInfo.txt --output H:\ASI-Cabins-Crawler\ranking
```

When approved property sources exist, use this **focused** list for the first campaign:

```powershell
C:\Python314\python.exe H:\ASI-Cabins-Crawler\app\campaign.py --execute --city-catalog H:\ASI-Cabins-Crawler\ranking\ranked-city-catalog-focus.jsonl --output H:\ASI-Cabins-Crawler\ranked-crawl-results --batch 3
```

**No property source is currently enabled or approved.** Do not run live crawling before verifying each provider's access rules and the listing extraction.

## Evergreen Index + demand-magnet bridge (existing ASI engine, no duplicate scorer)

**Important distinction:** Evergreen is property-address-based. It cannot be measured for an entire city without verified points of interest and an exact site coordinate. The authoritative implementation is already on `main` at:
- `src/lib/location/config.ts` — magnet taxonomy, permanent/semi/temporary multipliers, category radius caps and base weights.
- `src/lib/location/gravity-scoring.ts` — continuous distance attenuation, magnet attraction, clustering and competitor pressure.
- `src/lib/location/location-score.ts` — demand-score blend `0.6 × evergreenIndex + 0.4 × magnet_score`; composite `location_score` contains other validated factors and must not be confused with this demand blend.
- `src/lib/location/location-scoring-rules.ts` — source-of-truth score policy.

The existing magnet equation is **`W × P × D`**: class weight × permanence multiplier × distance-decay factor. Some verified magnetic anchor weights: **metro 9; airport / landmark 8; medical 7; major hotel / university / convention 6; business 5.5; railway hub / major mall 5; supermarket 1.2; cafe 1**. Weights and caps are owned by the primary ASI location engine, **not** this crawler. Regional or specialised transport and medical hubs are handled separately by the engine; avoid treating distant airports as walking-distance magnets.

New **`evergreen_bridge.py`** accepts the **actual saved output** of the production ASI location analysis, with explicit site coordinates, ASI integrity flags, precomputed `evergreenIndex`, magnet score, and magnet items with distances. It copies numeric results from the original engine and **refuses to publish them** if the original integrity evidence is missing/blocked, its calculated components are missing, or its demand blend fails a consistency check. It does not scrape or guess magnets.

Example command **only after genuine geocoded ASI reports exist** (the input file is not currently present):

```powershell
C:\Python314\python.exe H:\ASI-Cabins-Crawler\app\evergreen_bridge.py --asi-reports H:\ASI-Cabins-Crawler\verified-property-location-reports.jsonl --output H:\ASI-Cabins-Crawler\ranking\property-evergreen.json
```

`verified-property-location-reports.jsonl` requires one JSON object per property with `location_id`, `country_code`, `city_code`, `latitude`, `longitude`, and an `analysis` object from existing ASI. `analysisIntegrity.analysisIncomplete=false` and `scoreBlockedDueToIncompleteData=false` are required; a failed data-quality gate does not become a zero score.

## Popularity and hotel-demand stability (different from Evergreen)

The new `city_resilience.py` links independently sourced annual city data to the existing global ranking **by exact UN WUP city identifier**. It does not override the global screening score. For each city it exposes:
- Annual hotel occupancy (2024, 2025) and year-on-year change.
- City visitor counts (2024, 2025), visitor growth and domestic visitor share.
- ADR with original **currency units**, explicitly not treated as profit.
- A provisional **0–100 two-year demand-resilience proxy** where enough source evidence exists.
- Seasonality **NOT_MEASURED** without monthly hotel/overnight data; property Evergreen **NOT_MEASURED** without geocoded ASI report.
- Country security review continues separately; GPI country scores do not represent street crime or a city's financial returns.

This two-year proxy uses 35 points for hotel occupancy level, 30 for its year-to-year consistency, 25 for domestic visitor share and 10 for year-on-year visitor growth. Weights are **research heuristics**, not validated forecasting parameters. No year-round/seasonality claim is supported until multiple years of monthly figures are added.

**Verified example for 2025:** Moscow NF Group hotels: 73.7% occupancy versus 76% in 2024, ADR RUB 10,400, 26.5 million city visitors, 23.7 million domestic; New York City CoStar hotels: 84.1% versus 84.3%, ADR USD 333.71, 65 million city visitors, 52.4 million domestic. The calculated two-year proxy is **Moscow 82.73** vs **NYC 89.96**. These are *different property-market measurement populations*, so they do not prove that one city has higher ROI. Data sources and limitations accompany the benchmark file.

Research outputs:
- [data/city-hotel-benchmarks-2025.json](data/city-hotel-benchmarks-2025.json) — sourced 2024/2025 hotel and visitor facts for Moscow and NYC.
- [data/city-stability-overlay.csv](data/city-stability-overlay.csv) — 500-city spreadsheet; only the two cities with adequate local source data have stability scores.
- [data/city-stability-overlay.manifest.json](data/city-stability-overlay.manifest.json) — formula and limitations.

Local regenerate:

```powershell
C:\Python314\python.exe H:\ASI-Cabins-Crawler\app\city_resilience.py --ranking H:\ASI-Cabins-Crawler\ranking\market-priority-2026.csv --benchmarks H:\ASI-Cabins-Crawler\city-hotel-benchmarks-2025.json --city-catalog H:\ASI-Cabins-Crawler\world_cities_1m_2025.jsonl --output H:\ASI-Cabins-Crawler\ranking
```

**Required before any profit claim:** actual convertible property inventory, legal change-of-use evidence, rent, renovation CAPEX, corridor/bathroom costs, room ADR for the target cabin format, accommodation tax, host staffing/security/cleaning, energy and maintenance, booking costs, and currency/payment risks. The model must not auto-infer these from gross hotel-market ADR.


## Three research groups — 500-city business-development queue

The owner's new decision divides opportunities into **I / II / III** to concentrate property search, funding eligibility reviews, and local agent/partner scouting where evidence is strongest. The groups **do not** certify property returns or the willingness of financiers, local partners or agents to participate.

| Group | Count | Action | What this means |
| --- | ---: | --- | --- |
| I — HIGH | **11** | Start property-market verification, financing-program discovery and initial partner identification | Independently corroborated strong city demand, preliminary country-safety information; **not verified ROI** |
| II — MEDIUM | **90** | Second search wave, fill evidence gaps, verify regulations | Plausible medium/high demand or strong local demand despite needing extra risk/legality checks |
| III — RESERVE | **399** | Store in watch/research backlog; no full property-crawl priority | Missing data, weak preliminary signal or country-risk issues not yet offset by independently measured city demand |

**Top 11 by research priority:** London, Tokyo, Paris, Kuala Lumpur, Dubai, Madrid, Barcelona, Milan, Rome, Istanbul, New York. The first group is intentionally small (2.2% of the 500 cities). **Osaka, Seoul, Singapore and Moscow are in Group II**, not excluded. Moscow's documented domestic visitor share and two-year hotel-demand resilience permit conditional research, while its national risk-review gate remains in force. **Mecca is in Group II**: the Saudi 2026 real-estate ownership law imposes special rules on non-Saudi parties in Makkah/Madinah; legal eligibility must be assessed before finance/property negotiations. [Saudi REGA law](https://rega.gov.sa/en/laws-and-decisions/regulations-and-by-laws/rules/law-of-real-estate-ownership-and-investment-by-non-saudis/).

The deliverables separate **four requested dimensions**: (a) demand high/medium/low/unknown, (b) profitability *UNVERIFIED_NO_SITE_COSTS*, (c) population high (5m+), medium (2–5m), low (1–2m), and (d) Evergreen/magnet strength *UNVERIFIED_NO_ASI_SITE_REPORT* until a real geocoded property is analysed by the existing ASI location engine. City-level stability has a real two-year indicator for Moscow and NYC only. A fifth independently enforced field carries risk and regulatory gates.

The matrix also has **financing_program_status=NOT_RESEARCHED** and **local_partner_interest_status=NOT_VERIFIED** for *every city*. Priority describes what the business-development team should research first; it is **not a prediction** of grant eligibility, contract profits or agent enthusiasm. Project financing also depends on local legal form, operator licensing, foreign participation rules, collateral, available incentives and contract economics.

Tier CSV and machine-readable research queues:

- [Three-tier 500-city master CSV](data/market-tiers-2026.csv).
- [Methodology, counts and evidence-gate manifest](data/market-tiers-2026.manifest.json).
- [Group I — 11-city research queue](data/city-catalog-i-high.jsonl).
- [Group II — 90-city queue](data/city-catalog-ii-medium.jsonl).
- [Group III — 399-city reserve](data/city-catalog-iii-reserve.jsonl).

Rebuild the three tiers from the already generated ranking and city hotel evidence:

```powershell
C:\Python314\python.exe H:\ASI-Cabins-Crawler\app\market_tiers.py --ranking H:\ASI-Cabins-Crawler\ranking\market-priority-2026.csv --stability H:\ASI-Cabins-Crawler\ranking\city-stability-overlay.csv --output H:\ASI-Cabins-Crawler\ranking
```

Once legitimate property listing sources have been configured and explicitly enabled, **start with Group I**:

```powershell
C:\Python314\python.exe H:\ASI-Cabins-Crawler\app\campaign.py --execute --city-catalog H:\ASI-Cabins-Crawler\ranking\city-catalog-i-high.jsonl --output H:\ASI-Cabins-Crawler\tier1-crawl-results --batch 3
```

Group II uses the same command with `city-catalog-ii-medium.jsonl` and a **separate output directory**. Group III is a research reserve. These outputs are already generated locally but there are still **zero approved/enabled live listing providers**, so executing a property crawl is not yet operational. Read-only preview works without network requests; **40/40 offline tests passed** after this tier implementation.

**Progression / funding gate:** City interest → actual vacant eligible building listings → ASI real address Evergreen + magnets → lawful accommodation conversion → comparable nightly revenue/occupancy and lease/fitout/operating-cost model → verified financing programs and legally qualified partners → underwriting and contract decision. **High-demand cities can be unprofitable if site rent or conversion costs are too high.**

## How to engage the crawler after provider approval

First, configure *verified, permitted property listing sources* in `sources.json`. A public source serving several countries can use `"country_codes": ["*"]` with a **fixed HTTPS allowlisted domain** and an approved `search_url_template`, such as a search query containing `{city}` and `{country_code}`. The crawler will **always skip MM, BD, KP, TL**, even if a custom catalog accidentally contains them. The same policy prevents explicitly enabling excluded countries.

Once a source has passed the access review, enable it and run the **Group I** command above. The original full 500-city catalog remains available as a fallback but should not be the first run.

Repeat **the identical command** to resume. It writes `results\leads.csv`, `results\leads.json`, `results\crawl-errors.json` and `results\campaign-state.json`; the cursor advances only after a source run without errors. To check readiness without any network requests, omit `--execute`. There is **no** automatic scheduler or 24/7 deployment: once provider-specific live acceptance has been completed, a separately approved server job could repeat this command.

**No live sources are currently enabled.** The source-specific work is not complete, so `--execute` is intentionally blocked until an actual site has been configured and reviewed.

## Property assessment / legal limits

The purpose is to discover commercial premises suited for potential conversion into ASI private two-person indoor micro-cabins—not to find sellers of standalone cabins. Prioritise transport access, usable interior area, flexible commercial floors, former hotels/hostels, local demand and achievable rent. Extracted listing details are only research clues.

Every shortlisted property requires human validation of lawful overnight accommodation, fire protection/egress, accessible circulation, plumbing, sanitation, ventilation, acoustics, rent, actual site availability and the local landlord's consent. A high automatically computed suitability score is **not** permission to operate.

## Boundaries

All repository changes stay inside `tools/cabins-crawler/`, including research data. Nothing has been merged to `main`, deployed, scheduled or connected to the existing Universal Engine. Do not enable production or send commercial outreach without approved real-source evidence and owner decision.
