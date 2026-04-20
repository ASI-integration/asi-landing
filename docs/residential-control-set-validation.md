# Residential Control Set — Validation

_Date: 2026-04-19 | Cases: 28_

---

## How to use this document

Each case defines:
- Location archetype and OSM profile
- Expected engine outputs (ranges, not exact values)
- Known failure modes of the current engine for this case

Cases are ordered by archetype. Validate each case by running `buildAnalysis()` with realistic OSM fixtures or a live Overpass fetch for a representative address.

---

## Case format

```
CASE-N  [Archetype label]
Location: [City context + representative OSM profile]
Expected:
  commercialStrength (evergreenIndex range): X–Y
  environmentQuality (100 - friction range): X–Y
  audienceFit type: [type]
  strategyFit: [strategy]
  operationalSuitability: [tier]
  confidence: [tier]
  Key validation point: [what to check specifically]
Engine risk: [known failure mode]
```

---

## Strong Urban Core

### CASE-01 [Business district core — Moscow Delovoy Tsentr / City area]
**Profile:** Metro 200 m (weight 9), 3 office buildings 300–600 m, hospital 800 m, convention center 700 m. OSM elements: 60+. Friction: roads moderate (40), industrial 0, nightlife 0.1.

Expected:
- commercialStrength: evergreenIndex 72–88
- environmentQuality: 100 - 35 = ~65 (urban but manageable)
- audienceFit: `business_corporate`, audienceFitScore 80–95, `lockedMode=true`
- strategyFit: `short_term` or `selective_premium_short_term`
- operationalSuitability: `semi_auto` (urban, some management needed)
- confidence: `high`

Key validation: `businessClusterDetected = true`. `demandFlowLabel = 'устойчивый поток'`. Primary driver label correctly names top office object.

Engine risk: If office magnets are `office_anon` subtype (45% weight) → audienceFitScore drops to 50–60 even though visible offices are real. Check subType assignment.

---

### CASE-02 [Mixed urban — tourist + business balance]
**Profile:** Metro 350 m, attraction (museum) 500 m, 2 business objects 600–900 m, mall 700 m. OSM elements: 45+. Friction: roads moderate (32), nightlife 0.05.

Expected:
- commercialStrength: evergreenIndex 60–75
- environmentQuality: ~72
- audienceFit: `MIXED` locationType, audienceSharePct 45–58, no lock → `BUSINESS` by default
- strategyFit: `short_term` or `hybrid`
- confidence: `medium` (no clear audience lock)

Engine risk: Audience split causes `fallbackMode=false` but `lockedMode=false` → audience confidence is medium but output looks confident. Must flag `lockedMode=false` as medium confidence signal.

---

### CASE-03 [High-friction business core — industrial-adjacent office zone]
**Profile:** Factory 400 m (industrial subtype), 2 offices 500–800 m, metro 700 m. Industrial landuse 350 m. Friction: industrial 24, roads 18.

Expected:
- commercialStrength: evergreenIndex 55–70
- environmentQuality: 100 - 48 = ~52 (elevated concern)
- audienceFit: `business_corporate` (factory drives BUSINESS lock)
- strategyFit: `hybrid` (elevated friction blocks premium short_term)
- operationalSuitability: `semi_auto`
- confidence: `medium` (good demand signals, but elevated friction adds uncertainty)

Engine risk: Factory at 400 m (weight 5.5 × 0.55 = ~3.0) + metro → BUSINESS lock at ~65% share. Correctly identifies corporate demand but doesn't flag that industrial environment affects guest comfort.

---

## Quiet Premium

### CASE-04 [Premium residential — Patriarshie Prudy / Arbat style]
**Profile:** Metro 600 m, attraction 400 m, few restaurants (food cluster weak), no industrial, no major roads within 300 m. Low competitor count (3). OSM elements: 30+. Friction: roads 8, nightlife 0.05, industrial 0.

Expected:
- commercialStrength: evergreenIndex 35–52 (few magnets → low commercial)
- environmentQuality: 100 - 15 = ~85 (quiet)
- audienceFit: `premium_comfort` (low friction + decent demand + low supply)
- strategyFit: `selective_premium_short_term`
- operationalSuitability: `full_auto`
- confidence: `medium` (low demand signals but environment well-covered)

Engine risk: **Current engine fails here** — evergreenIndex 35–52 maps to "weak" or "viable" band. Quiet premium locations are systematically underscored because the engine is demand-magnet-first. `premium_comfort` audience type doesn't exist yet.

---

### CASE-05 [Premium residential — no metro, very quiet]
**Profile:** No metro. 1 attraction 700 m. 0 competitors. 4 food places 300 m. Friction 8. Low element count (18).

Expected:
- commercialStrength: evergreenIndex 20–38
- environmentQuality: ~90
- audienceFit: `premium_comfort` (only valid type — low demand, no magnets, clean env)
- strategyFit: `selective_premium_short_term` with note "нет метро — целевая аудитория с личным транспортом"
- operationalSuitability: `full_auto` (quiet, low turnover)
- confidence: `low` (sparse elements, single attraction magnet)

Engine risk: evergreenIndex < 30 → `risky` rating → system recommends against. But this is a viable premium unit for a specific guest. Current output is actively misleading.

---

## Family-Friendly District

### CASE-06 [Suburban family residential — Butovo / Mitino style]
**Profile:** Metro 900 m, 2 schools within 600 m, mall 800 m, park nearby. 5 competitors. OSM elements 25. Friction: roads 14, industrial 0, nightlife 0.

Expected:
- commercialStrength: evergreenIndex 38–52
- environmentQuality: ~80
- audienceFit: `leisure_tourist` (fallback) or MIXED — no strong business/tourist magnets
- strategyFit: `mid_term` or `hybrid`
- confidence: `low–medium` (school magnets are weak, mall is moderate)

Engine risk: `education_local` weight is 1.5 (very weak). Schools don't drive STR demand. Engine may assign TOURIST fallback mode with low audienceFitScore — correct label, but reason is "no business magnets" not "tourist strength". `fallbackMode=true` must be surfaced.

---

### CASE-07 [Family district — good schools, park, moderate metro]
**Profile:** Metro 1100 m (borderline for hasMetro=false), 3 schools 400–700 m, park. Mall 1.2 km. Competitors 6. Friction 12. Elements 22.

Expected:
- commercialStrength: evergreenIndex 28–42
- environmentQuality: ~86
- audienceFit: `leisure_tourist` (fallback — low audienceFitScore < 30)
- strategyFit: `mid_term`
- operationalSuitability: `semi_auto` (family stays are multi-day but need flexibility)
- confidence: `low` (weak magnets, no business/tourist anchor)

Engine risk: hasMetro = false (1100 m > 1000 m threshold — wait, threshold is 1500 m in `buildAnalysis`). Actually metro at 1100 m IS counted as metro magnet (CATEGORY_RADIUS.metro = 1200 m) and hasMetro uses 1500 m threshold. So hasMetro=true, accessibility_score += 60. This inflates location_score. But this doesn't drive STR demand in family district.

---

## Transport-Heavy but Noisy

### CASE-08 [Major railway station zone — Kurskaya style]
**Profile:** Railway station 200 m, metro 300 m, 5+ food/shops. 8 competitors. Friction: transitCorridor 0.8, roads 22, nightlife 0.15. Elements 55.

Expected:
- commercialStrength: evergreenIndex 55–72 (strong transport magnets)
- environmentQuality: 100 - 55 = ~45 (elevated)
- audienceFit: `transient_transport`, `demandType = 'transport-led'`
- strategyFit: `short_term` (high demand) but with semi_auto required
- operationalSuitability: `semi_auto` or `manual_only` (24h arrivals, noise, turnover)
- confidence: `medium–high`

Engine risk: `transitCorridor01 = 0.8` correctly elevates friction. But strategy still says `short_term` without flagging that a 24h transport hub means unusual guest hours and complaint risk. `manual_only` should be triggered by `demandType='transport-led' AND friction > 50`.

---

### CASE-09 [Airport proximity zone — 2 km from Sheremetyevo]
**Profile:** Airport 1.9 km (material hub, large runway score). No metro. Railway 800 m. Friction: aviation 18, roads 12. Elements 30.

Expected:
- commercialStrength: evergreenIndex 45–62
- environmentQuality: 100 - 35 = ~65
- audienceFit: `transient_transport`
- strategyFit: `short_term` (high turnover, airport demand)
- operationalSuitability: `semi_auto` — early/late arrivals, but environment manageable
- confidence: `medium`

Engine risk: `isMaterialAirportMagnet` requires attractionScore ≥ 3.8 OR (distance ≤ 2200 AND score ≥ 2). At 1.9 km, airport weight 8 × permanence 1.25 × decay(1900) → need to verify. Decay at 1900 m: 1/(1 + (1900/520)^1.55) = 1/(1 + (3.65)^1.55) ≈ 1/(1+7.4) ≈ 0.12. attractionScore ≈ 8 × 1.25 × 0.12 ≈ 1.2 — this may FAIL `isMaterialAirportMagnet` threshold. Known risk: airport at 1.9 km may not count as material anchor.

---

### CASE-10 [Small regional airport, 1.5 km, low traffic]
**Profile:** Small aerodrome 1.5 km (but low ATM). Railway 1.2 km. No metro. Friction: aviation 12, roads 8. Elements 20.

Expected:
- commercialStrength: evergreenIndex 25–40
- audienceFit: `transient_transport` or MIXED
- confidence: `low` (sparse elements, small airport)

Engine risk: `demandType='transport-led'` may not trigger if airport attractionScore < 9 and transport share < 45%. Correct behavior: small airports should NOT classify as transport-led unless there's clear evidence.

---

## Medical-Adjacent

### CASE-11 [Major hospital cluster — Sechenov / NMIC style]
**Profile:** 2 hospitals within 600 m (weight 7 each), convention center 1 km. Metro 500 m. Friction 20. Elements 40.

Expected:
- commercialStrength: evergreenIndex 62–78
- environmentQuality: ~80
- audienceFit: `medical_related` (hospitals dominate, audienceSharePct = BUSINESS ≥ 65%)
- strategyFit: `hybrid` (medical visits 3–14 days → not pure STR)
- operationalSuitability: `semi_auto`
- confidence: `high`

Engine risk: Hospital at 600 m (weight 7, decayed) has high attraction score. `primaryAudience = BUSINESS`, `primaryDriverLabel` shows hospital correctly. Currently labeled as BUSINESS, not `medical_related` — need specific medical inference.

---

### CASE-12 [Single outpatient clinic, 600 m]
**Profile:** Polyclinic 600 m (hospital category but small facility). No other strong magnets. Metro 900 m. Elements 15.

Expected:
- commercialStrength: evergreenIndex 30–45
- audienceFit: `medical_related` (weak) or BUSINESS with low confidence
- confidence: `low–medium` (single magnet, small facility)

Engine risk: Engine treats polyclinic identically to NMIC — same category ID, same weight. No size/tier signal in OSM. Will over-report medical confidence.

---

## Tourist-Heavy but Weak for Living

### CASE-13 [Tourist center — Red Square / Kremlin area]
**Profile:** Multiple attractions < 500 m (weight 8 each). Entertainment 400 m. Mall 300 m. Metro 200 m. 12+ competitors. Friction: nightlife 0.35, transit 0.6, roads 18. Elements 70.

Expected:
- commercialStrength: evergreenIndex 82–95
- environmentQuality: 100 - 62 = ~38 (elevated friction — tourist center is busy)
- audienceFit: `leisure_tourist`, audienceSharePct ≤ 35, lockedMode=true
- strategyFit: `short_term` (high demand justifies despite friction)
- operationalSuitability: `manual_only` (nightlife, transit, high competitor pressure)
- confidence: `high`

Engine risk: High nightlife01 + transit should trigger `manual_only` but current engine doesn't have this. Strategy = short_term is correct for demand but incomplete without operational warning.

---

### CASE-14 [Tourist cluster but far from center, weak]
**Profile:** 1 attraction 800 m (city-level museum). No other tourist anchors. Metro 1.1 km. 3 competitors. Friction 15. Elements 18.

Expected:
- commercialStrength: evergreenIndex 25–40
- audienceFit: `leisure_tourist` via TOURIST fallback — audienceFitScore < 25
- strategyFit: `mid_term`
- confidence: `low` (single weak anchor, fallbackMode likely)

Engine risk: Single attraction at 800 m with moderate decay → audienceFitScore very low. TOURIST mode is correct but engine may show confident TOURIST label without flagging weak signal.

---

## Suburban Weak

### CASE-15 [Suburban periphery — no anchors]
**Profile:** No metro (2 km). No business magnets. School 500 m. Supermarket 400 m. 1 competitor. Friction 8. Elements 12.

Expected:
- commercialStrength: evergreenIndex 10–22
- environmentQuality: ~92
- audienceFit: TOURIST fallback, audienceFitScore ≈ 0–15
- strategyFit: `cautious_manual_only` (demand too weak)
- confidence: `proxy_only` (only weak magnets, sparse data)

Engine risk: Engine will output `mid_term` strategy with some income estimate. This is actively wrong — there is no viable STR demand here. `cautious_manual_only` must be a valid strategy that blocks income estimate display.

---

### CASE-16 [Suburban residential, one bus route, no metro]
**Profile:** Bus stop 100 m (transit stop, not metro). School 400 m. Few food places. 2 competitors. Friction 10. Elements 10.

Expected:
- commercialStrength: evergreenIndex 8–18
- confidence: `proxy_only`
- audienceFit: TOURIST fallback (no viable audience)

Engine risk: accessibility_score gets +5 per stop up to 40 pts. 3 bus stops → +15 pts. But bus stops near suburban areas are not commercial demand drivers. Over-inflates accessibility_score.

---

## Mixed Medium-City Residential

### CASE-17 [Regional city center — Kazan / Samara style]
**Profile:** Metro 400 m (some Russian cities have metro). 2 business objects 600–900 m. 1 attraction 700 m. Mall 500 m. 6 competitors. Friction 22. Elements 38.

Expected:
- commercialStrength: evergreenIndex 52–68
- environmentQuality: ~78
- audienceFit: BUSINESS or MIXED (audienceSharePct 48–58)
- strategyFit: `hybrid`
- confidence: `medium`

---

### CASE-18 [Regional city without metro — major street]
**Profile:** Railway station 800 m (no metro). 3 offices 500–1000 m. Mall 600 m. 8 competitors. Friction: roads 22, industrial 0. Elements 32.

Expected:
- commercialStrength: evergreenIndex 45–60
- environmentQuality: ~72
- audienceFit: BUSINESS (railway as transport anchor, offices as business)
- strategyFit: `hybrid`
- confidence: `medium`

---

### CASE-19 [Mid-size city center — no metro, tourist-led]
**Profile:** No metro. Kremlin/fortress attraction 400 m. River embankment nearby. 2 restaurants. 4 competitors. Friction 12. Elements 20.

Expected:
- commercialStrength: evergreenIndex 42–55
- audienceFit: `leisure_tourist` (genuine, not fallback)
- strategyFit: `short_term` (tourist demand, seasonal peak)
- confidence: `medium` (attraction is real anchor, but seasonal risk)

---

## Edge Cases — Strong Score but Questionable Environment

### CASE-20 [High-score industrial-adjacent zone]
**Profile:** Office cluster 400 m (5 named offices, demandType=business-led). Metro 300 m. Industrial landuse 280 m. Factories 350 m. Friction: industrial 0.75, roads 0.45.

Expected:
- commercialStrength: evergreenIndex 65–78 (strong magnets)
- environmentQuality: 100 - 58 = ~42 (elevated-high concern)
- audienceFit: `business_corporate` (office cluster dominates)
- strategyFit: `hybrid` (friction blocks premium; business demand justifies some STR)
- confidence: `medium` (good demand, concerning environment)

Engine risk: `industrialBarrier()` check — industrial01 = 0.75 with metro anchor. The escape hatch fires: `ind <= 0.85 AND hasMetroAnchor AND evergreenIndex >= 60` → NO barrier for commercial scoring. But for residential this is wrong — 280 m from a factory is bad for guests even if metro is nearby.

---

### CASE-21 [Strong score but nightlife zone]
**Profile:** Entertainment 300 m, attraction 500 m, metro 400 m. Nightclubs within 350 m: 3. Bars within 300 m: 5. Friction: nightlife 0.65.

Expected:
- commercialStrength: evergreenIndex 62–78
- environmentQuality: 100 - 52 = ~48
- audienceFit: `leisure_tourist` (entertainment+attraction dominant)
- strategyFit: current engine → `short_term`. Should be `cautious_manual_only` or `manual_only`
- operationalSuitability: `manual_only` (nightlife01 > 0.6)

Engine risk: nightlife01 = 0.65 but strategy is still `short_term`. This is a known gap — nightlife score doesn't influence strategy.

---

## Edge Cases — Good Environment but Weak Demand

### CASE-22 [Quiet prestigious street, no anchors]
**Profile:** No metro (1.8 km). No magnets within 600 m. 0 competitors. Friction 6. Elements 22.

Expected:
- commercialStrength: evergreenIndex 8–20
- environmentQuality: ~94
- audienceFit: `premium_comfort` (low demand but exceptional environment)
- strategyFit: `selective_premium_short_term` with low confidence note
- confidence: `low–medium`

Engine risk: evergreenIndex < 20 → `risky` band → negative framing dominates output. This suppresses the valid premium comfort positioning.

---

### CASE-23 [Calm residential, good metro, no business]
**Profile:** Metro 500 m. Park nearby. Food cluster (6 cafes, 300 m). 2 competitors. No business/tourist magnets. Friction 12. Elements 28.

Expected:
- commercialStrength: evergreenIndex 30–45 (metro + food cluster)
- environmentQuality: ~88
- audienceFit: TOURIST fallback (no anchors) → low audienceFitScore
- strategyFit: `mid_term` or `hybrid`
- confidence: `low` (fallback mode, weak magnet profile)

---

## Edge Cases — Mixed Signals

### CASE-24 [Transport + business + tourist overlap]
**Profile:** Railway station 400 m. Convention center 600 m. Museum 500 m. Metro 700 m. 10 competitors. Friction: transit 0.55, roads 0.4. Elements 50.

Expected:
- commercialStrength: evergreenIndex 70–82
- audienceFit: MIXED (all three types pulling)
- demandType: `mixed` or slight `transport-led`
- strategyFit: `short_term` or `hybrid`
- confidence: `medium` (strong signals but mixed audience → no single audience lock)

---

### CASE-25 [Strong hospital + strong nightlife]
**Profile:** Hospital 400 m (major). Metro 600 m. Nightclubs 280 m × 2. Bars 300 m × 4. Friction: nightlife 0.65, roads 0.2.

Expected:
- commercialStrength: evergreenIndex 58–72
- audienceFit: `medical_related` (hospital dominant in business magnets)
- environmentQuality: 100 - 48 = ~52
- strategyFit: `cautious_manual_only` (medical demand real, but nightlife makes auto-STR risky)
- confidence: `medium` (good demand signal, clear conflict between audience and environment)

---

### CASE-26 [Tourist anchor nearby but strong industrial]
**Profile:** Museum 600 m. Industrial zone 200 m (factories). Metro 800 m. Friction: industrial 0.85, roads 0.3. Elements 35.

Expected:
- commercialStrength: evergreenIndex 40–55 (attraction pulls, industrial limits)
- environmentQuality: 100 - 55 = ~45
- audienceFit: `leisure_tourist` (tourist pull but limited by environment)
- strategyFit: `hybrid` (tourist demand exists but environment limits premium)
- confidence: `medium`

Engine risk: `industrialBarrier()` check: industrial01 = 0.85 → above 0.85 threshold → industrial barrier applies. But this is for commercial format fit, not for residential audience. Residential guests at 200 m from a factory are affected regardless of metro proximity.

---

### CASE-27 [University district — student area]
**Profile:** 2 universities within 700 m. Metro 500 m. Food cluster. 4 competitors. Friction 15. Elements 35.

Expected:
- commercialStrength: evergreenIndex 50–65 (metro + universities + food)
- audienceFit: `BUSINESS` mode possible (universities count as business magnets? No — university is its own category, not in BUSINESS_CATEGORY_IDS). Actually: universities are NOT in BUSINESS_CATEGORY_IDS, NOT in TOURIST_CATEGORY_IDS → they don't feed audience analysis at all.
- audienceFit: TOURIST fallback (no business/tourist magnets beyond metro)
- strategyFit: `hybrid` or `mid_term` (university = mid-term semester demand, not STR)
- confidence: `low` (student demand not modeled)

Engine risk: University magnets contribute to evergreenIndex (weight 6) but contribute ZERO to audienceAnalysis (not in either BUSINESS or TOURIST category sets). This is a gap — university-adjacent locations appear with decent score but audience is labeled TOURIST by fallback.

---

### CASE-28 [Gentrified industrial — high score, mixed reputation]
**Profile:** Metro 300 m. Former factory converted to creative space (tagged as office/attraction in OSM). Bars 250 m × 3. Food cluster. Competitors 9. Friction: nightlife 0.35, industrial 0.2 (residual OSM tags). Elements 45.

Expected:
- commercialStrength: evergreenIndex 68–80
- environmentQuality: 100 - 40 = ~60
- audienceFit: `MIXED` or `leisure_tourist` (creative cluster = tourist-adjacent)
- strategyFit: `short_term` (high demand) with friction caveat
- operationalSuitability: `semi_auto` (bar density, active evenings)
- confidence: `medium` (good coverage, mixed signals)

---

## Summary of key failure patterns across control set

| Failure pattern | Cases | Priority to fix |
|---|---|---|
| `premium_comfort` audience type missing → quiet locations get `risky` rating | 04, 05, 22 | HIGH |
| `cautious_manual_only` strategy missing → weak demand locations get `mid_term` | 15, 16, 25 | HIGH |
| Nightlife friction not blocking `short_term` strategy | 21, 25 | HIGH |
| `fallbackMode=true` not surfaced as low-confidence | 06, 14, 23, 27 | MEDIUM |
| University-adjacent audience not modeled | 27 | MEDIUM |
| Airport at 1.8–2.2 km may fail `isMaterialAirportMagnet` threshold | 09 | MEDIUM |
| Industrial barrier escape hatch fires for residential (metro nearby = OK for commercial, not for guests) | 20, 26 | MEDIUM |
| Suburban bus stops inflate accessibility_score | 16 | LOW |
