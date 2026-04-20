# Residential V1 — Readiness Assessment

_Date: 2026-04-19 | Honest evaluation_

---

## 1. What is finished-level

### Environment quality layer
**Status: FINISHED for V1 purposes.**

`NeighborhoodEnvironmentLayer` is the best-implemented residential signal in the engine.
- 6 sub-components (roads, industrial, aviation, nightlife, transit, stack)
- OSM-coverage confidence (high/medium/low)
- Soft commercial modifier correctly implemented
- Narrative copy covers strong-commercial-tense, calm, uneven, and severe cases
- Suitable for direct use in residential output without additional tuning

### Gravity/demand scoring core
**Status: PRODUCTION for commercial; USABLE PROXY for residential.**

`evergreenIndex` and `locationScore.location_score` are stable and tested. For residential STR, the commercial demand signals (metro, hospital, business, attraction) are also relevant — an office cluster near a property drives corporate rental demand. The calibration is Moscow-centric but produces defensible results for major Russian cities.

The income model (ADR × occupancy × 30d) is a rough proxy — not production-grade for residential reporting, but acceptable for indicative framing.

### Competitor pressure
**Status: USABLE.**

`calcCompetitorPressure()` with density multiplier is a reasonable proxy for STR market saturation. The 800 m competitor radius is defensible for residential.

---

## 2. What is still proxy

### Audience fit (BUSINESS/TOURIST binary)
**Status: PARTIAL PROXY.**

The current `AudienceAnalysis` correctly identifies BUSINESS vs TOURIST character of a location, but:
- `business_corporate` is inferred indirectly from BUSINESS mode — sometimes correct, often inflated by office_anon or bank clusters
- `leisure_tourist` is reliable when strong attractions exist; unreliable in TOURIST fallback mode
- `premium_comfort` does not exist at all
- `medical_related` is a rough inference from hospital magnet presence
- `transient_transport` is not surfaced as an audience type — only as `demandType`

For a production residential report, citing "audience: BUSINESS" when the driving signal is 3 anonymous office nodes at 900 m is misleading.

### Strategy fit
**Status: PROXY.**

`recommendStrategy()` is 3-line demand+seasonality logic. It:
- Does not integrate environment friction
- Does not have `selective_premium_short_term` or `cautious_manual_only` paths
- Does not integrate audience type
- Can recommend `short_term` for nightclub-adjacent noisy locations

This is the biggest single source of misleading output for residential users.

### Operational suitability
**Status: NOT PRESENT.**

`manual | semi_auto | full_auto` logic does not exist anywhere. For a property manager evaluating operational risk, this is a critical missing output.

### Confidence layer
**Status: NOT PRESENT (except OSM coverage in env layer).**

No overall decision confidence is computed. The same output format is shown for:
- A dense urban location with 70 OSM elements and a business cluster
- A suburban property with 8 OSM elements and one unnamed office

### Explanation copy for residential
**Status: COMMERCIAL-ORIENTED PROXY.**

`top_positive_factors[]` and `top_negative_factors[]` are written for commercial analysis. The copy mentions "командированные", "конкурентное давление", "досуговый спрос" — appropriate for commercial but needs residential framing (guest comfort, stay duration, operational load, neighborhood character).

---

## 3. Fragile audience/strategy zones

### `premium_comfort`
Entirely absent. Quiet high-value residential locations are scored as "weak" or "risky" commercial locations. The engine actively misrepresents these properties.

### `transient_transport` at friction edge
Transport-hub locations (railway/airport) with elevated friction (score 45–60) receive `short_term` strategy with no friction caveat. Real output for a manager: noisy 24h-turnover property recommended for automated short-term without any warning. This is wrong.

### TOURIST fallback zone
Any location without business or tourist magnets receives TOURIST mode by default with `fallbackMode=true`. The audienceFitScore is 0–15 but the label is still "TOURIST audience" without clear signaling that this is a null result, not a genuine tourist location.

### University-adjacent
Universities contribute to evergreenIndex (weight 6) but are excluded from BUSINESS_CATEGORY_IDS and TOURIST_CATEGORY_IDS. University-adjacent locations appear with decent score but undefined audience — scored as TOURIST fallback, which is incorrect.

### Medical-related single-clinic
A polyclinic (hospital category, weight 7) at 700 m generates the same BUSINESS signal as a major medical center. Single-clinic inference has low reliability.

---

## 4. Readiness percentage — honest assessment

### As demo (showing the tool to potential users)
**Current: ~72%**

The demo is convincing for:
- Urban business-district locations (correct audience, reasonable score)
- Tourist-center locations (correct audience, reasonable friction)
- Environment quality narrative (strong layer)

The demo fails for:
- Quiet premium locations (labeled "risky" or "weak")
- Transport-hub + noisy locations (no warning)
- Suburban locations (fallback mode looks confident)
- Any location where a manager would actually act on the output

After this workstream (7 docs implemented): **~82%** — adding `premium_comfort`, `cautious_manual_only`, confidence framing would significantly improve demo quality.

---

### As standalone sellable product
**Current: ~58%**

A product sold to property managers or investors needs to:
1. Correctly identify audience type with confidence signal → PARTIAL
2. Recommend a viable strategy that integrates environment → MISSING
3. Flag operational risk → MISSING
4. Calibrate income estimates to location quality → ROUGH PROXY
5. Not recommend "short_term" for nightclub-adjacent industrial zones → CURRENTLY DOES

A property manager acting on the current output for a non-obvious location could make a wrong investment decision. The output is not decision-grade.

After this workstream implemented: **~72–75%** (audience types added, strategy fixed, confidence layer visible, `cautious_manual_only` prevents worst-case misleading advice).

---

### As core decision engine (decision-grade)
**Current: ~52–58%**

Decision-grade requires:
- Audience type derivation that accounts for signal quality (not just score) → PROXY
- Strategy fit that integrates environment, audience, demand together → MISSING
- Operational suitability output → MISSING
- Calibrated confidence that prevents false confidence display → MISSING
- Income model validated against real STR market data → NOT VALIDATED
- Control set with ≥25 cases producing correct outputs in automated tests → NOT BUILT
- Field validation (physical visit confirmation of key cases) → NOT DONE

The engine is not decision-grade today. It is a well-structured commercial scoring tool being repurposed for residential, missing 3 key residential sub-models.

After full implementation of this workstream: **~68–72%** as core engine. Getting to 90% requires:
- Income model calibration against real market data
- Control set automated testing (not just docs)
- Field validation of 8–10 cases
- Regulatory/legal zone awareness (STR ban areas)
- University and mid-term relocation audience models

---

## 5. Can we honestly say 90–95% residential readiness now?

**No.**

Claiming 90–95% readiness today would be misleading because:

1. **Three entire output fields are missing**: operationalSuitability, confidence layer, warnings
2. **Two audience types exist only as proxy**: premium_comfort (absent), transient_transport (inferred, not surfaced)
3. **Strategy fit is 3-line logic** that ignores environment — the most important residential-specific signal
4. **Quiet premium locations are actively misscored** — the engine labels them "weak" or "risky"
5. **No control set testing exists** — the 28 cases in the validation doc are defined but not run against actual engine output
6. **Income estimates are unvalidated proxies** — no market data calibration for residential STR

The honest position:
- After implementing this workstream: **~72–78% across the board** (demo 82%, standalone 75%, engine 72%)
- To reach 90%: need income calibration, control set automated testing, field validation, and University/Phase-2 audience types

---

## 6. Fastest path to ~90%

**Step 1 (1–2 cycles): Implement the 3 missing output fields**
- `operationalSuitability` (1–2 days): purely rule-based, no new data needed
- `confidence` layer (1 day): aggregate existing signals
- `warnings[]` (0.5 days): derive from existing negative factors

**Step 2 (1–2 cycles): Fix strategy fit**
- Add `selective_premium_short_term` and `cautious_manual_only` paths
- Integrate `environmentalFrictionScore` into strategy decision
- Fixes the nightclub/industrial false-positive recommendations

**Step 3 (1 cycle): Add `premium_comfort` audience type**
- Pure rule based: low friction + low competition + decent accessibility
- Fixes the quiet-location false-negative problem

**Step 4 (1–2 cycles): Run control set against live engine**
- Run all 28 cases
- Fix the 6 identified failure patterns
- Add automated snapshot tests

**Step 5 (external dependency): Income model calibration**
- Needs real STR market data (Avito, Ostrovok, ЦИАН)
- Without this, income estimates remain rough proxies
- This step alone moves from ~78% to ~85%

**Rough timeline to 90%: 3–5 focused cycles + income data access**
