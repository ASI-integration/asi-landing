# Residential Audience Fit — V1 Tuning Plan

_Date: 2026-04-19_

---

## Overview

Current state: AudienceAnalysis supports `BUSINESS | TOURIST | FAMILY`. FAMILY is declared but never computed. For residential short-term rental (STR) analysis, five priority audience types are needed, plus two Phase 2 types.

Audience fit must be derived from **OSM magnets + environment + foot-traffic** — not from score alone.

---

## Priority audience types (V1)

### 1. `business_corporate`

Maps to current `BUSINESS` mode. Most mature of the five.

**Supporting signals:**
- Named offices, business parks, factories, industrial zones within 1–1.5 km
- `businessClusterDetected = true` (≥2 non-bank magnets within 1 km)
- Hospital / convention center within 1.2 km
- `demandFlowLabel = 'устойчивый поток'`
- audienceSharePct ≥ 60
- Metro within 1 km (access for corporate travelers)

**Limiting signals:**
- All business magnets > 2 km
- `audienceSharePct < 40` with no cluster
- High nightlife friction (nightlife01 > 0.4) → corporate guests avoid these zones
- industrial01 > 0.6 without metro anchor (real industrial zone, not office-adjacent)

**Common false positives:**
- Bank clusters (3–4 bank branches within 500 m): trigger audienceSharePct but generate no STR demand
- Single large anonymous `office` polygon (office_anon subType): gets 45% weight penalty but still inflates score in suburbs with sparse magnets
- `landuse=commercial` strips (commercial subType): retail context, not corporate lodging demand

**Common false negatives:**
- Hospitals where medical staff travels but audienceSharePct stays below 65 lock threshold because tourist magnets (shopping_major, attraction) happen to be nearby
- Convention centers that are far (1.2–1.8 km) but generate strong periodic demand spikes — distance decay kills signal even though event demand is real

**Current reliability: MEDIUM-HIGH** when cluster is detected; MEDIUM when single anchor only.

---

### 2. `transient_transport`

Partially covered by `demandType === 'transport-led'`. No dedicated audience type.

**Supporting signals:**
- `demandType === 'transport-led'`
- Railway station within 600 m (high relevance) or 800–1400 m (moderate)
- Airport within 2 km (material hub, not helipad)
- Metro within 500 m AND high transitCorridor01 (> 0.4)
- `footTraffic.modifierTier === 'strong'` with high transitShare (> 0.45)

**Limiting signals:**
- Railway station is freight-only (railway=rail, usage=freight)
- Airport is a helipad/small GA strip (`isMaterialAirportMagnet = false`)
- Transit corridor without actual terminus or hub (just bus stops)
- `environmentalFrictionScore > 55` AND `nightlifeRaw > 12` → transit location but poor guest comfort

**Common false positives:**
- Dense bus stop networks (transitCorridor01 high) in suburban residential areas → not transport hubs
- Secondary train platforms at far-suburban commuter stops → they attract commuters not transit guests

**Common false negatives:**
- Airport hotels / proximity zones where airport magnet fails `isMaterialAirportMagnet` threshold (attractionScore < 3.8 and distance > 2.2 km) even though the location clearly serves aviation workers/travelers
- Multi-modal transport nodes (e.g., bus terminal + rail) where individual magnet scores are moderate but combined effect is strong

**Current reliability: MEDIUM** — `transport-led` inference is present but not surfaced as audience type.

---

### 3. `leisure_tourist`

Maps to current `TOURIST` mode. Reliable when tourist magnets are strong.

**Supporting signals:**
- Attractions within 600 m (weight 8, strong pull)
- Entertainment + shopping_major cluster (≥2 categories, combined)
- Stadium within 1 km
- audienceSharePct ≤ 35 (hard lock to TOURIST)
- `demandType === 'tourism-led'`
- High destination share in foot-traffic (destinationShare > 0.4)

**Limiting signals:**
- Tourist magnets are regional draws (city-scale museums, etc.) but property is far (> 800 m) → demand exists but decays sharply
- `fallbackMode = true` (tourist because no business, not because tourism is strong)
- Environmental friction elevated/high → tourist guests also sensitive to noise/environment quality
- No metro or walkable transit → tourists without cars avoid location

**Common false positives:**
- Single attraction at 900–1000 m triggers TOURIST mode but doesn't drive meaningful STR demand
- `fallbackMode = true` creates a TOURIST label for locations with simply no business magnets — these are not tourist locations, just undifferentiated

**Common false negatives:**
- Weekend leisure demand from multiple nearby food+entertainment clusters is not captured because `food` and `entertainment` categories have low weight (1–5) and cluster detection requires strong/medium strength magnets
- Tourist zones with seasonal peaks: seasonality_score proxy (footTraffic.stability01) doesn't model summer vs winter well

**Current reliability: MEDIUM** when anchored by strong attractions; LOW in fallback mode.

---

### 4. `premium_comfort`

NOT implemented. No OSM proxy currently captures this.

**Supporting signals (to build):**
- Absence of environmental stressors: environmentalFrictionScore < 20, concernLevel = 'low'
- Absence of: industrial01, nightlife01, major transit corridor
- Presence of: upscale amenities (no direct OSM tag, but can infer from `attraction` + low friction)
- Low competitor density (supply_score ≥ 70)
- Good accessibility (hasMetro OR accessibility_score ≥ 60)
- `locationScore.location_score ≥ 70` in a quiet zone

**Limiting signals (to build):**
- Any nightlife01 > 0.2 → not premium quiet
- industrial01 > 0.1 → industrial smell/noise concern
- High competitor density (supply_score < 40) → premium positioning hard to sustain
- transport corridor heavy → noise stress

**Common false positives (expected):**
- High evergreenIndex from strong commercial magnets in busy locations → good demand but NOT premium quiet comfort
- Locations with score ≥ 75 in noisy urban core: strong commercial, poor residential premium comfort

**Common false negatives (expected):**
- Truly premium quiet residential neighborhoods often have low evergreenIndex (few magnets) but excellent living quality — current engine scores them as "weak" commercial

**Current reliability: NONE** — this audience type is entirely absent from the engine.

---

### 5. `medical_related`

Rough proxy via hospital magnet. Partially reliable.

**Supporting signals:**
- Hospital magnet within 1 km (category_id = 'hospital', weight 7)
- Multiple hospitals/medical clusters (≥2 within 1.5 km)
- Convention center within 1.2 km (medical conferences are a real driver)
- `primaryAudience = BUSINESS` with hospital as top magnet in primaryMagnets
- Moderate-good environment (friction < 40) — medical visitors need rest

**Limiting signals:**
- Hospital is small outpatient clinic (weak/local strength class) rather than regional medical center
- Hospital at > 1.5 km with no cluster → visiting patients/families park near hospital, not 1.5 km away
- `industrial01 > 0.4` near hospital area → medical-adjacent but unpleasant environment

**Common false positives:**
- Hospital that is a psychiatric facility or rural geriatric ward → doesn't generate significant STR demand
- Polyclinic (weight = 7 as hospital) at 800 m → inflates medical signal; in reality these serve local patients not out-of-town visitors

**Common false negatives:**
- Major regional oncology / cardiology centers with large catchment area — family members travel long distances and rent nearby for weeks, but hospital is 1.3–2 km away → distance decay kills the signal

**Current reliability: LOW-MEDIUM** — hospital detection works; demand inference is rough.

---

## Phase 2 audience types (low confidence, not V1)

### `student_education`
- Proxy: university magnet within 800 m
- Currently: university category exists (weight 6), but no student-audience logic
- Problem: universities drive mid-term seasonal rentals (semester), not STR — different strategy
- False positive risk: summer term → university closed → no student demand
- **Not reliable enough for V1**

### `relocation_midterm`
- No OSM proxy exists for relocation demand
- Would require external data (job postings, company relocations, new residential construction)
- **Not implementable from OSM signals**

---

## Implementation actions for V1

1. Add `ResidentialAudienceType` enum: `business_corporate | transient_transport | leisure_tourist | premium_comfort | medical_related`
2. Map current `AudienceAnalysis` output to `business_corporate`, `transient_transport`, `leisure_tourist`
3. Add `premium_comfort` classification rule: environmentalFrictionScore < 22 AND supply_score ≥ 65 AND accessibility_score ≥ 50
4. Add `medical_related` classification: hospital distance ≤ 1200 m AND strengthClass = 'strong' or 'medium' AND hospital is top-1 or top-2 magnet by attractionScore
5. Add `audienceFitReliability: 'high' | 'medium' | 'low'` per audience type
6. Do NOT promote `student_education` or `relocation_midterm` to V1 output
