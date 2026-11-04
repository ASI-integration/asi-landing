# ASI Cabins — Property Discovery Crawler (v1)

Purpose: identify **indoor commercial premises** that could host private, two-person ASI micro-cabins. It does not search for cabin manufacturers or make any claim that a property is legally usable for accommodation.

## Markets and property strategy

- **Japan first:** Osaka (initial 50–100 m², 3–5 cabin pilot) and Tokyo. Secondary market: Taipei, Taiwan.
- Prioritize vacant/underused commercial floors, offices, former hotels/hostels and hospitality-convertible premises near transit.
- Larger property searches (roughly 100–1,200 m²) are also supported for multi-cabin installations. Upper-floor assets are preferable to prime ground-floor retail; basement/windowless assets need specific fire/ventilation review.
- Each 9–13 m² two-person cabin needs a bed, private bathroom/shower, work surface and effective sound isolation; feasibility cannot be inferred from real estate listings alone.

## Current implementation

- Read-only HTTPS GETs. No browser automation, API credentials, forms, authentication, CAPTCHA evasion or robots bypass.
- Explicit domain allowlist, public-DNS checks, no redirects, per-host robots.txt permission, 1 MB page cap, configurable pages/source (hard cap 50), minimum 2-second delay.
- HTML title / meta / anchor extraction; area conversion from m², 坪, 평 and square feet; heuristic monthly rent and floor extraction. No unsupported claims about missing facts.
- Scores each candidate using area, property type, transit context, reuse signals and upper floor. Ground-floor retail is penalized.
- Deduplication by canonical URL. Exports leads.json, leads.csv and crawl-errors.json. All leads are marked legal_use=UNVERIFIED.

## Local use (Python 3.10+; standard library only)

From the repository root:

```sh
python tools/cabins-crawler/crawler.py
python -m unittest discover -s tools/cabins-crawler -p 'test_*.py' -v
```

The first command only validates the configuration and shows source counts. **It does not access the network.**

After reviewing the target website's terms, robots.txt, public listing URL format and selectors, change its `enabled` flag to `true` in `sources.json` and run:

```sh
python tools/cabins-crawler/crawler.py --execute --output cabins-crawler-output
```

**Important:** The source URLs in `sources.json` are public listing directories verified by a search, not approved scraping targets or tested extraction adapters. Every source is disabled until robots/terms and matching listing URLs are individually reviewed. Some sources render content with JavaScript, in which case this intentionally simple version may find no listings; do not bypass their access controls.

Output fields: `id`, `market`, `city`, `source`, `url`, `title`, `description`, `area_m2`, `monthly_rent`, `currency`, `floor`, `score`, `signals`, `cautions`, `legal_use`, `found_at`.

## Human review before a pilot

For a property marked promising: verify the owner/operator contact, lawful overnight accommodation use, zoning/change-of-use permission, egress/fire rules, ventilation, plumbing, acoustic separation, loading/access, all-in rent and usable area. Any property can fail this review even with a score of 100.


## Southeast Asia: every recorded settlement with at least 2 residents

The regional catalog covers **all 11 SEA countries**: Brunei (BN), Cambodia (KH), Indonesia (ID), Laos (LA), Malaysia (MY), Myanmar (MM), Philippines (PH), Singapore (SG), Thailand (TH), Timor-Leste (TL) and Vietnam (VN). Japan and Taiwan remain separate East Asian pilot markets.

Instead of an arbitrary population floor such as 50,000, import **all GeoNames populated places with recorded population >= 2**, including villages and towns. For broader coverage, use `--include-unknown` to include places with **unrecorded population**, marked as `population_status=unknown`. Those records are leads for verification, **not confirmed to have 2+ inhabitants**. This is as complete as the available GeoNames data, not a guarantee every real settlement appears. The source data is updated independently by GeoNames and is distributed under CC BY 4.0 (attribution: [GeoNames](https://www.geonames.org/)). Do not use GeoNames city population as an exact current census.

Create a fresh city catalog (Python 3.10+; **downloads the 11 publicly available GeoNames country ZIPs**, but does not access any property website):

```sh
python tools/cabins-crawler/cities.py --download --include-unknown --output H:/ASI-Cabins-Crawler/cities.jsonl
```

This creates `H:/ASI-Cabins-Crawler/cities.manifest.json` with per-country counts, unknown-population counts, archive hashes and attribution. The example uses the owner's existing H: drive. To use cached archives again, omit `--download` and add `--cache-dir H:/ASI-Cabins-Crawler/geonames`. No arbitrary city-size cap or fixed shortlist applies.

When *real property listing sources have been approved, their per-city search URL templates configured, and the appropriate sources explicitly enabled*, launch one resumable batch:

```sh
python tools/cabins-crawler/campaign.py --execute --city-catalog H:/ASI-Cabins-Crawler/cities.jsonl --output H:/ASI-Cabins-Crawler/results --batch 3
```

Repeat **that same command** to resume automatically. The runner saves `results/campaign-state.json` with each source's city offset and **merges** earlier leads into the results instead of overwriting them. It stops advancing a source whenever robots permissions, HTTP errors or a page limit block complete collection. After the source is repaired, repeat the same command. To inspect readiness without network requests, omit `--execute`. A separate scheduler can call the identical command at an owner-approved cadence; none is installed yet.

The lower-level `crawler.py --execute --city-catalog ... --city-offset N --city-batch 10` interface remains available for manual targeted batches, but **its export writes a fresh output** and must not replace the resumable runner's output directory.

Sources for an all-city search require `country_codes` (e.g. `["ID", "MY"]`) and an approved `search_url_template` with a fixed HTTPS domain. Variables supported in its path/query are `{city}`, `{country}`, `{country_code}`, `{admin1}` and `{geonames_id}`. City names are URL-escaped and resulting URLs must remain within `allowed_domains`. Example for a **hypothetical, explicitly approved** property portal only:

```json
{
  "name": "EXAMPLE ONLY — NOT AN APPROVED SOURCE",
  "market": "Southeast Asia",
  "city": "Regional",
  "enabled": false,
  "country_codes": ["ID", "MY", "SG"],
  "allowed_domains": ["example.com"],
  "search_url_template": "https://example.com/for-lease?location={city}&cc={country_code}",
  "listing_link_pattern": "/listings/[0-9]+"
}
```

Do **not** enable this placeholder. No SEA property portal is currently vetted for live crawling. Building the city catalog does not constitute scraping, verifying, or contacting listings. Site robots/terms, local legality, per-city URL coverage, data quality and rate restrictions all need source-specific verification.

## Launch and ownership

When the source adapters pass live acceptance checks, **run the `campaign.py --execute` command above**. The runner handles the cursor; a separate job scheduler could invoke the identical command repeatedly. There is currently no active scheduler, unattended deployment, automatic owner outreach, or ASI Engine integration. Such activation requires a separate, owner-controlled release decision.

## Deployment boundary

This is independent research tooling, not an ASI Engine lane. It has no scheduler, database writes, live deployment, auto-email outreach, or production service credentials. Do not deploy or merge into `main` before owner review and a verified source-specific pilot.
