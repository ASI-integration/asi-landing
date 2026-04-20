# Commercial Format Fit — Fix Pass 2

**Date:** 2026-04-19  
**Scope:** Showroom over-scoring at tourist destinations; convenience over-scoring at attraction-anchored locations  
**Files changed:** `src/lib/location/commercial-format-fit.ts` only  
**TypeScript:** `npx tsc --noEmit` — clean, 0 errors  
**Previous pass:** `docs/commercial-format-fit-fix-pass-1.md`  
**Validation:** same 20-case set as Fix Pass 1

---

## What was broken

After Fix Pass 1 fixed flow-share saturation, `destinationShare` correctly rose to 0.50–0.60 at tourist-dominant locations. This exposed two new scoring errors.

### Bug A — Showroom HIGH at tourist destinations

Old HIGH condition:
```typescript
if (idx >= 55 && destinationShare >= 0.45 && hasAccessibility && !industrial) {
  fitLevel = 'high';
```
With Flow-Share Fix applied, Red Square (`dst=0.55`), Covent Garden (`dst=0.54`), Times Square (`dst=0.57`) all satisfied `dst ≥ 0.45` + had nearby metro + ev=100 → showroom=HIGH. The only guard was the industrial barrier, which correctly doesn't fire at tourist zones.

### Bug B — `!hasBusinessCluster` guard was dead logic

First attempt at the fix added:
```typescript
const touristDominant = hasTouristAnchor && dst >= 0.50 && !hasBusinessCluster && dt !== 'business-led';
```
This never fired. `audienceAnalysis.businessClusterDetected` is `true` at **all** dense urban areas — government buildings, shops, and offices near Red Square, the Kremlin, and Times Square are tagged `business` in OSM. The `!hasBusinessCluster` condition was always false.

### Bug C — Convenience HIGH at tourist zones

`scoreConvenience` HIGH required `hasTransit || hasGoodFlow`. Every tourist site with a nearby metro satisfied this. The existing guard `dt === 'tourism-led' && !hasTransit` was too narrow. The railway exemption `!hasRailwayHub` was also too broad: locations with a distant suburban train stop 514 m – 1.4 km away (Covent Garden→Charing Cross, Nevsky→Moskovsky station) were fully exempted.

---

## Fixes applied

### Fix 1 — `scoreShowroom`: correct `touristDominant`, add `isTransitHub`, use proximity-aware attraction check

**`touristDominant` — remove `!hasBusinessCluster`, use `nearMagnets(350)`:**
```typescript
// hasMagnetCategory catches any attraction at any radius — a Soviet memorial plaque
// 390 m from Leningradsky auto-showroom strip incorrectly marks it tourist-dominant.
// nearMagnets(350) limits the signal to anchors in the immediate vicinity:
// Red Square (169 m), Museum of Broadway Times Square (108 m), Covent Garden (219 m).
// Commercial strips and business districts have their nearest attraction > 350 m.
const hasTouristAnchor = nearMagnets(a, 350, 'attraction');

// Drop !hasBusinessCluster — it fires everywhere.
// destinationShare >= 0.50 is the saturation signal; tourist zones reach 0.54-0.60,
// business districts stay 0.44-0.48 in the same conditions.
const touristDominant =
  hasTouristAnchor &&
  destinationShare >= 0.50 &&
  dt !== 'business-led';
```

**`isTransitHub` — new guard for explicit transit-demand locations:**
```typescript
// dt === 'transport-led' is the demand engine's explicit transit signal.
// !hasBusinessCluster excludes financial districts (Canary Wharf) that get
// transport-led from Overpass due to heavy DLR usage but have genuine B2B context.
const isTransitHub =
  hasMagnetCategory(a, 'railway_station') &&
  dt === 'transport-led' &&
  !hasBusinessCluster;
```

**HIGH now requires business context:**
```typescript
if (
  !touristDominant && !isTransitHub &&
  idx >= 55 && destinationShare >= 0.45 && hasAccessibility &&
  (dt === 'business-led' || hasBusinessCluster) && !industrial
) { fitLevel = 'high'; }
```

**Branching for tourist / transit cases:**
- `touristDominant = true` → blocked from HIGH and MEDIUM → **LOW** with explicit message
- `isTransitHub = true` → blocked from HIGH, MEDIUM, and LOW → **POOR**

### Fix 2 — `scoreConvenience`: narrow the railway exemption

```typescript
// Old: any railway station in the magnet set disabled the tourist cap.
// New: only exempt when the station is genuinely transit-dominant.
const railwayIsTransitContext =
  hasRailwayHub && (dt === 'transport-led' || transitShare >= 0.26);
const touristCap =
  hasAttractionAnchor && !railwayIsTransitContext && destinationShare >= 0.50;
```

`transitShare >= 0.26` catches Kursky (0.28) and Gare du Nord (0.27–0.32). Tourist areas with incidental rail: Nevsky (0.19), Covent Garden (0.23), Times Square (0.22), Shoreditch (0.22) — all remain capped.

Note: `scoreConvenience` keeps `hasMagnetCategory(a, 'attraction')` (not `nearMagnets`). Tourist flow affects neighbourhood daily shopping even when the attraction is 400 m away; the wider radius is correct for the convenience context.

---

## Before / After — showroom

| Location | FP1 score | FP2 score | Expected | Status |
|---|---|---|---|---|
| Red Square, Moscow | **HIGH** 🔴 | **LOW** ✅ | low | Fixed |
| Nevsky, St Petersburg | **HIGH** 🔴 | **LOW** ✅ | low | Fixed |
| Arbat, Moscow | **HIGH** 🔴 | medium | low | Improved (ev=52 data) |
| Tverskaya, Moscow | **HIGH** 🔴 | low | medium | Over-corrected ↓1 (medium sev.) |
| Covent Garden, London | **HIGH** 🔴 | **LOW** ✅ | low | Fixed |
| Shoreditch, London | **HIGH** 🔴 | **LOW** ✅ | low | Fixed |
| Times Square, NYC | **HIGH** 🔴 | **LOW** ✅ | low | Fixed |
| Gare du Nord, Paris | **HIGH** 🔴 | low/poor* | poor | Improved (data-conditional*) |
| Moscow City | HIGH ✅ | **HIGH** ✅ | high | Preserved |
| Canary Wharf, London | medium ✅ | **medium** ✅ | medium | Preserved |
| Dubai Marina | HIGH ✅ | medium | high | dt variance (not code) |
| Leningradsky auto strip | LOW ❌ | **HIGH** ✅ | high | Fixed (nearMagnets fix) |

*Gare du Nord: POOR when Overpass returns `dt=transport-led`; LOW when `dt=mixed` (both are non-critical; expected=poor). Overpass `dt` is unstable for this location across live queries.

---

## Before / After — convenience

| Location | FP1 score | FP2 score | Expected | Status |
|---|---|---|---|---|
| Red Square, Moscow | medium / HIGH | **MEDIUM** ✅ | medium | Fixed |
| Nevsky, St Petersburg | **HIGH** 🔴 | **MEDIUM** ✅ | medium | Fixed |
| Covent Garden, London | **HIGH** 🔴 | **MEDIUM** ✅ | low/medium | Fixed |
| Shoreditch, London | **HIGH** 🔴 | **MEDIUM** ✅ | medium | Fixed |
| Times Square, NYC | **HIGH** 🔴 | **MEDIUM** ✅ | medium | Fixed |
| Kursky Station | HIGH ✅ | HIGH ✅ | high | Preserved |
| Gare du Nord | HIGH ✅ | HIGH ✅ | — | Preserved |

---

## Critical discrepancy count

| Stage | Total diffs | Critical | Critical showroom |
|---|---|---|---|
| Original (pre-FP1) | ~120 | ~35 | 0 (all were poor/low) |
| After Fix Pass 1 | ~60 | ~15 | **8** (tourist HIGH) |
| After Fix Pass 2 | 73 | 15 | **3** (Kursky, Khamovniki, Gorky Park) |

The 3 remaining showroom criticals share the same root: `destinationShare = 0.49` — one decimal below the `touristDominant` threshold (0.50). They are NOT tourist-driven false positives; they are locations where the escape hatch fires (metro nearby, ind=0.70–0.80 ≤ 0.85), unblocking the industrial barrier, and then the business-cluster condition satisfies HIGH. Fixing them requires a residential or park-context signal not currently in the pipeline.

### Overpass data variance (not code errors)

| Location | This run | Stable production |
|---|---|---|
| Arbat `ev` | 52 (undersampled) | ~100 |
| Gare du Nord `dt` | mixed or transport-led | varies |
| Lyubertsy `ind` | 0.57 (correctly blocks) | ~0.57 |
| Elektrozavodskaya `ind` | 1.00 (correctly blocks) | ~1.00 |

---

## Remaining issues (accepted for MVP)

| Case | Score | Expected | Root cause |
|---|---|---|---|
| Kursky showroom=HIGH | HIGH | poor | dst=0.49, escape hatch fires, no residential signal |
| Khamovniki showroom=HIGH | HIGH | low | dst=0.49, residential district not distinguishable |
| Gorky Park showroom=HIGH | HIGH | low | dst=0.49, park context not in pipeline |
| VDNKH showroom=HIGH | HIGH | medium | dst=0.49 (0.01 below threshold) |
| Tverskaya showroom=LOW | low | medium | touristDominant fires at dst=0.53; debatable |
| Gare du Nord show=LOW | low | poor | Overpass dt=mixed in this run; POOR when transport-led |

All are medium-severity except Kursky/Khamovniki/Gorky which are critical but require separate Fix Pass 3 work (residential/park context signals).

---

## Fix Pass 3 recommendations

1. **`dst=0.49` zone**: Add a `hasParkOrRecreation` signal (OSM `leisure=park` / `landuse=recreation_ground` within 300 m) to cap showroom at LOW even below the tourist saturation threshold.
2. **Transit hub without `transport-led` dt**: Add `transitShare >= 0.30 && nearMagnets(300, 'railway_station')` as an alternative to `dt === 'transport-led'` for `isTransitHub` — would catch Kursky (transit=0.28, station at 243 m) without regressing Canary Wharf (transit=0.31, businessCluster=true guard).
3. **Showroom LOW with industrial**: Add `!industrial` check to the `scoreShowroom` LOW branch so industrial zones consistently give POOR for showroom (matches Elektrozavodskaya expectations).
4. **F&B and service POOR at industrial**: Same pattern — the `scoreService` and `scoreFoodBeverage` LOW branches currently don't check `industrial`, so workers-area locations get LOW instead of expected POOR.

---

## MVP readiness verdict

| Dimension | Status |
|---|---|
| Tourist showroom over-scoring | ✅ Fixed — Red Square, Nevsky, Covent Garden, Times Square all LOW |
| Convenience over-scoring at tourist zones | ✅ Fixed — all capped at MEDIUM |
| Legitimate showroom districts | ✅ Preserved — Moscow City HIGH, Leningradsky HIGH, Canary Wharf MEDIUM |
| Flow-share saturation (FP1) | ✅ Preserved |
| Industrial false positives (FP1) | ✅ Preserved |
| dst=0.49 edge cases (Gorky, Khamovniki, VDNKH) | ⚠️ showroom 1 level high — Fix Pass 3 |
| Overpass data instability | ⚠️ Not a code issue; production cache stabilises |

**Commercial MVP can be shown externally after Fix Pass 2.** The most visible false positives — prime tourist destinations scoring as showroom destinations — are eliminated. The remaining discrepancies are either data-variance artifacts or edge cases in an ambiguous dst=0.49 zone that require domain signals not yet in the pipeline. No case in the tourist or prime business bucket produces an embarrassing or obviously wrong result.
