# Location validation harness report
Generated: 2026-04-21T19:03:07.898Z

Cases: success=0 · warning=5 · failed=0
Reasons: timeout=0 · provider_failure=0 · weak_data=5 · normal_completion=0
Checks: pass=25 · warn=5 · fail=0
Cache: hits=0 · misses=5 (dir: scripts/location-validation-harness/osm-cache)

## Cases
- **ny_times_square** — Times Square, Manhattan, New York, NY, USA
  - outcome: warning (weak_data) · duration=22.5s
  - coords: 40.75645, -73.98650 · elements=18 · cache=MISS · fallback=true · provider_failure=true
  - summary: demand=mixed · pressure=low · evergreen=5 · score=23 · strategy=mid_term
  - checks: fail=0 · warn=1 · confidence=low
    - PASS demand_type: demandType=mixed
    - PASS accessibility: stops=10
    - PASS competitor_pressure: pressure=low competitors=1
    - PASS score: evergreen=5 score=23
    - PASS proxy_estimates: adr≈1600₽ occ≈33%
    - WARN signal_quality: low confidence (elements=18 fallback_query=true)
- **paris_la_defense** — La Défense, Puteaux, Paris, France
  - outcome: warning (weak_data) · duration=24.5s
  - coords: 48.89190, 2.23870 · elements=54 · cache=MISS · fallback=true · provider_failure=true
  - summary: demand=mixed · pressure=low · evergreen=5 · score=27 · strategy=mid_term
  - checks: fail=0 · warn=1 · confidence=low
    - PASS demand_type: demandType=mixed
    - PASS accessibility: stops=12
    - PASS competitor_pressure: pressure=low competitors=0
    - PASS score: evergreen=5 score=27
    - PASS proxy_estimates: adr≈1600₽ occ≈37%
    - WARN signal_quality: low confidence (elements=54 fallback_query=true)
- **tokyo_station** — Tokyo Station, Chiyoda, Tokyo, Japan
  - outcome: warning (weak_data) · duration=19.5s
  - coords: 35.68124, 139.76712 · elements=67 · cache=MISS · fallback=true · provider_failure=true
  - summary: demand=transport-led · pressure=low · evergreen=53 · score=65 · strategy=hybrid
  - checks: fail=0 · warn=0 · confidence=medium
    - PASS demand_type: demandType=transport-led
    - PASS accessibility: stops=12
    - PASS competitor_pressure: pressure=low competitors=1
    - PASS score: evergreen=53 score=65
    - PASS proxy_estimates: adr≈3400₽ occ≈62%
    - PASS signal_quality: medium confidence (elements=67 fallback_query=true)
- **osaka_dotonbori** — Dotonbori, Chuo Ward, Osaka, Japan
  - outcome: warning (weak_data) · duration=21.1s
  - coords: 34.66870, 135.50110 · elements=285 · cache=MISS · fallback=true · provider_failure=true
  - summary: demand=transport-led · pressure=high · evergreen=100 · score=74 · strategy=short_term
  - checks: fail=0 · warn=1 · confidence=medium
    - PASS demand_type: demandType=transport-led
    - WARN accessibility: no transport stops detected (may be sparse OSM)
    - PASS competitor_pressure: pressure=high competitors=94
    - PASS score: evergreen=100 score=74
    - PASS proxy_estimates: adr≈5400₽ occ≈65%
    - PASS signal_quality: medium confidence (elements=285 fallback_query=true)
- **berlin_messe** — Messe Berlin, Berlin, Germany
  - outcome: warning (weak_data) · duration=2.56s
  - coords: 52.50160, 13.27810 · elements=18 · cache=MISS · fallback=false · provider_failure=false
  - summary: demand=transport-led · pressure=low · evergreen=36 · score=35 · strategy=mid_term
  - checks: fail=0 · warn=2 · confidence=low
    - PASS demand_type: demandType=transport-led
    - WARN accessibility: no transport stops detected (may be sparse OSM)
    - PASS competitor_pressure: pressure=low competitors=3
    - PASS score: evergreen=36 score=35
    - PASS proxy_estimates: adr≈1800₽ occ≈52%
    - WARN signal_quality: low confidence (elements=18)