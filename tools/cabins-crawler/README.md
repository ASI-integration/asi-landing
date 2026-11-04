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
- `test_*.py`: offline tests. 

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

## How to engage the crawler after provider approval

First, configure *verified, permitted property listing sources* in `sources.json`. A public source serving several countries can use `"country_codes": ["*"]` with a **fixed HTTPS allowlisted domain** and an approved `search_url_template`, such as a search query containing `{city}` and `{country_code}`. The crawler will **always skip MM, BD, KP, TL**, even if a custom catalog accidentally contains them. The same policy prevents explicitly enabling excluded countries.

Once a source has passed the access review, enable it and run:

```powershell
C:\Python314\python.exe H:\ASI-Cabins-Crawler\app\campaign.py --execute --city-catalog H:\ASI-Cabins-Crawler\world_cities_1m_2025.jsonl --output H:\ASI-Cabins-Crawler\results --batch 3
```

Repeat **the identical command** to resume. It writes `results\leads.csv`, `results\leads.json`, `results\crawl-errors.json` and `results\campaign-state.json`; the cursor advances only after a source run without errors. To check readiness without any network requests, omit `--execute`. There is **no** automatic scheduler or 24/7 deployment: once provider-specific live acceptance has been completed, a separately approved server job could repeat this command.

**No live sources are currently enabled.** The source-specific work is not complete, so `--execute` is intentionally blocked until an actual site has been configured and reviewed.

## Property assessment / legal limits

The purpose is to discover commercial premises suited for potential conversion into ASI private two-person indoor micro-cabins—not to find sellers of standalone cabins. Prioritise transport access, usable interior area, flexible commercial floors, former hotels/hostels, local demand and achievable rent. Extracted listing details are only research clues.

Every shortlisted property requires human validation of lawful overnight accommodation, fire protection/egress, accessible circulation, plumbing, sanitation, ventilation, acoustics, rent, actual site availability and the local landlord's consent. A high automatically computed suitability score is **not** permission to operate.

## Boundaries

All repository changes stay inside `tools/cabins-crawler/`, including research data. Nothing has been merged to `main`, deployed, scheduled or connected to the existing Universal Engine. Do not enable production or send commercial outreach without approved real-source evidence and owner decision.
