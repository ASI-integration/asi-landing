# Location real-world calibration — 2026-10-15

Baseline: PR457 70f1ab9be0e82a99c0814ff5d766a0cfbdc2cfbd, stacked above PR456 c3cb5d42c910b99eb563e3b37fafeb927d82e256.

## Verified changes
- Tourist-only credible anchors no longer enter fallback solely because business anchors are absent.
- Duplicate food POIs are removed before cluster weighting. Twelve copies of one cafe cannot manufacture a cluster.
- Thresholds, caps, taxonomy, commercial access and the 56 historical expectations are unchanged.
- Offline observation validator explicitly distinguishes complete caller claims from external verification. It is a benchmark utility, not a production authorization or geographic-proof gate.
- Dated OSM/Nominatim raw responses are pinned by SHA256; tests validate bytes, object identity and straight-line calculations.

Focused scoring RED: 3 pass / 2 fail. Corrected: 5/5 pass.
Initial full regression: 699/699 (684 baseline +15 new at that point); final CI adds further evidence and malformed-input tests.
Historical calibration: 44/56 before AND after. All12 failures remain fatal in CI. No full-calibration acceptance claimed.

## Evidence and limitations
See evidence/2026-10-15/evidence-matrix.json and manifest.json.
24 Nominatim responses, including empty searches, plus one OSM full-way response are archived. Source URLs, retrieval times, ODbL attribution and SHA256 are recorded.
Candidate straight-line distances: Sochi hotel/theatre484m, Nizhny candidate/theatre221m, Samara candidate/museum181m, Zelenogradsk candidate/museum205m, Svetlogorsk candidate/hall334m. These are centroid distances, NOT walking routes or verified property entrances.
Palace square-to-palace158m is an identity-resolution diagnostic, not a subject-to-magnet acceptance.
Estosadok1108m is distance to a bus stop with a resort name; it is NOT a ski-lift distance.
Overpass requests failed with timeouts/502/504. Subsequent OSM object requests returned429 and acquisition was stopped. No alternative account, IP, credential or restriction bypass was used.
Named official-source excerpts corroborate addresses only. They are dated links, not archived page snapshots.
No complete POI inventory, validated pedestrian graph, real opposite-bank route, monthly demand series, property-use permission or financial performance was obtained.

## Gate assessment
| Gate | Result |
|---|---|
| GEO_GROUND_TRUTH | HOLD: useful dated candidates and conflicts, not complete routes/identity/POI coverage |
| CALIBRATION_56 | FAIL:44/56; all12 unchanged failures recorded |
| REGRESSION | Local PASS; exact final Linux receipt required |
| EVERGREEN | Structural spatial proxy only; not observed year-round demand |
| SEASONALITY | HOLD: spatial flow stability is not monthly occupancy |
| PROPERTY_TYPE | HOLD: retail/building identity and legal use need verification |
| ENTITLEMENTS | Existing reconciliation/access regression included; no live grants/payment changes |
| COMMERCIAL_RELEASE | HOLD |

## Architecture findings retained
Scoring uses existing radii/decay and straight-line/spatial-barrier heuristics; this sprint does not invent 1/3/5/10km network walking behavior. The audience calculation and barrier-adjusted attraction require broader evidence-bound consistency work before route-aware claims. An isolated museum cannot prove city-scale tourism or score85/88. Gross modeled income does not establish net profitability without costs, occupancy and actual market evidence.
No dashboard/PDF/public score contract was changed. Existing integration tests exercise the shared contracts; they do not independently validate financial or geographic truth.

## Next acceptance action
Obtain a reviewed, open-data benchmark for the11 real failed addresses: confirmed building/entrances, qualified actual anchors, pedestrian routes including barriers, property-use facts and dated seasonal-demand evidence. Resolve the address conflicts before proposing any expectation or scoring change. The remaining synthetic88 case requires a defensible contract decision, not fabricated geographic evidence.
