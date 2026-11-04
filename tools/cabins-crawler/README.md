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

## Deployment boundary

This is independent research tooling, not an ASI Engine lane. It has no scheduler, database writes, live deployment, auto-email outreach, or production service credentials. Do not deploy or merge into `main` before owner review and a verified source-specific pilot.
