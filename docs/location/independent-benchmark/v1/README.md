# Independent Russian geographic benchmark v1.0.0

As of 2026-10-15. Baseline: PR #461, `350602c409a87dea9144de48527bf14a6adf056d`.

This benchmark audits all 11 exact addresses behind 12 failing calibration assertions. It is evidence adjudication, not proof of numeric demand, profitability or commercial readiness. Eight subjects have supported identity findings at explicitly different scopes (site, historic property, occupant or indexed museum complex); three remain ambiguous. Only two have corroborated primary-source map pins. All walking routes, monthly demand, legal unit use and profitability remain unverified. Calibration remains 44/56 and fatal.

## Priority adjudications

| Subject | Finding | Remaining limitation |
| --- | --- | --- |
| Moscow, Bolshaya Pirogovskaya 2 | University compound includes several buildings; clinic at building 1, rectorate at building 4 | Exact suffix required; institutional visitors do not prove corporate accommodation demand |
| Nizhny Novgorod, Bolshaya Pokrovskaya 2 | Regional tourism source identifies Dom-sunduk and coffee cluster; object map pin is 10 m from cached building way 1047123841 | Another address node is 1,222 m away; corner alias, entrance and legal residential use unverified |
| Gelendzhik, waterfront 1 | Weak accommodation candidate; street/settlement ambiguity unresolved | Do not silently choose central promenade or infer nonexistence |
| Svetlogorsk, Lenina 8 | Kaliningrad-region operator lists a restaurant occupant | Occupant evidence is not exclusive building use or dwelling suitability |

Sochi's operator map pin is 13 m from the cached hotel building centroid. These separations are spherical point comparisons, not walking distances or cadastral surveys. Nizhny's map link uses object `pt`, not viewport `ll`. Anapa's current operator source is Rossiyanka; the More Leto booking page explicitly disclaims official status. Sheregesh's apartment classification is dated 2024. Zelenogradsk's historical demolished hotel must not classify its residential replacement. Estosadok requires a corpus; a resort-named bus stop is not a ski lift.

## Files and interpretation

- `benchmark.json`: exact addresses, scoped identities, EPSG:4326 candidates, OSM identities, cached footprint, candidate magnets, distances, barriers, audiences, provenance and gaps.
- `benchmark.csv`: review index; candidate coordinates do not imply an adjudicated building.
- `reconciliation.json`: 12 retained failures, source issues, unsupported numeric expectations and unproven model errors. `displayAssertion` is a prior display label, not a literal source assertion.
- `sources/`: factual annotations and independent blind reviews. Raw public HTML remains in the owner's private report archive; it is not republished. Digest pins an annotation's bytes, not publisher truth. Cached OSM exports remain in the preceding versioned evidence folder with attribution.

Two independent reviewers assessed identities/audiences before receiving model scores. A separate reviewer inspected this implementation and its evidence boundaries. Neither reviewer establishes measured bookings, legal rights or independently surveyed walking access.

The official Hermitage page could not be directly retrieved; its evidence is indexed official information plus reviewer records. The unreadable Garant snapshot is explicitly excluded. Historical and secondary sources retain those labels. No new OSM/Nominatim/Overpass requests were made after the earlier rate-limit blocker. Successful HTTP responses alone do not prove usable evidence.

## Integrity and acceptance

`node scripts/acceptance/independent-geo-benchmark.cjs` verifies source digests, address/review bindings, coordinate and OSM bindings, primary pins, footprint vertices and all computed point distances. It returns geographic and commercial HOLD even when integrity passes. Hashes are not cryptographic signatures of publishers. Canonical fixture hashes normalize CRLF; geographic JSON/CSV is pinned to LF for reproducibility on Windows and Linux.

The separate `geo-source-acquisition.cjs` helper is a bounded HTTP **status probe**, not a body downloader. It validates all allowlisted HTTPS URLs before requests, never follows redirects, waits between calls, cancels bodies and stops the entire batch on an error/restriction. Mock tests prove these controls; they do not prove external page completeness. Historical page acquisitions have their own receipts in the owner archive.

The workflow runs offline regression/security integration, evidence integrity and typecheck separately from the fatal 56-case calibration gate. No scoring thresholds, golden assertions, caps, access controls or production paths are altered. No numeric correction is justified by this incomplete geographic inventory.

Next evidence gate: resolve exact building/corpus identifiers for ambiguous subjects and obtain lawful, reproducible entrance-to-magnet pedestrian routes and current magnet inventories. Then independently adjudicate numeric expectations; never infer profit from commercial activity or Evergreen/seasonality proxies alone.
