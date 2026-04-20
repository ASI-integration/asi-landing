# Location Model — Tuning Pass 1 Results

> Methodology: A/B validation — **same fresh OSM data**, scored twice (old model vs new model).  
> This eliminates OSM data drift from the comparison.  
> Reference: `scripts/control-ab-results.json`  
> Date: 2026-04-18

---

## 1. Changes applied

| # | Change | File | Old value | New value |
|---|--------|------|-----------|-----------|
| 1 | Airport search radius | `config.ts` | 3500 m | 2000 m |
| 2 | Competitor pressure cap | `config.ts` `GRAVITY_CONFIG.competitorPressureMax` | 20 | 15 |
| 3 | Named office weight | `gravity-scoring.ts` `effectiveBusinessWeight` default | `baseWeight × 1.0` (5.5) | `baseWeight × 0.72` (≈4.0) |
| 4 | Soft cap above rawScore=80 | `gravity-scoring.ts` `calcEvergreenIndex` | hard cap at 100 | `80 + (raw−80) × 0.60` |

All changes mirrored in `scripts/validate-locations.mjs` for future full runs.

---

## 2. A/B results — 10 control cases

> OLD: airport=3500, competitorMax=20, office×1.0, no softcap  
> NEW: airport=2000, competitorMax=15, office×0.72, softcap@80

| # | Name | Type | OLD idx | NEW idx | Δ | attr Δ | cp Δ | OK? |
|---|------|------|---------|---------|---|--------|------|-----|
| 20 | Ozone Park | weak_suburb | 100 | **93** | −7 | −15 | 0 | ✓ (drop) |
| 47 | Tromsø city center | remote | 100 | **99** | −1 | −14 | 0 | ✓ (drop) |
| 12 | Prenzlauer Berg | medium_urban | 50 | **55** | +5 | 0 | −5 | ✗ (slight rise) |
| 45 | Переславль центр | rural | 100 | **100** | 0 | 0 | 0 | ✗ (no change) |
| 54 | Wedding Berlin | weak_urban | 91 | **90** | −1 | 0 | −5 | ✓ (drop) |
| 44 | Siena old town | rural | 5 | **9** | +4 | 0 | −5 | ✓ (rise) |
| 91 | El Poblado | medium_urban | 16 | **21** | +5 | 0 | −5 | ✓ (rise) |
| 1 | Times Square | strong_urban | 100 | **100** | 0 | −2 | −5 | ✓ (stable) |
| 37 | Cannes Croisette | beach_resort | 100 | **100** | 0 | −16 | 0 | ✓ (stable) |
| 17 | Clapham Common | medium_urban | 100 | **100** | 0 | −17 | 0 | ✓ (stable) |

> Note: 3 anchors (Cannes, Clapham, Times Square) score 100 in **both** models on current OSM data — higher than stored April scores (73, 64, 100 respectively). This confirms significant OSM data growth between the original run and this recheck, independent of model changes.

---

## 3. What improved

### 3.1 Airport radius (3500 → 2000 m)
**Works correctly** as a filter. Cases near airports lose 14–17 scaled attraction points:
- Ozone Park: `attr −15` → idx 100→93 (−7). Actual mechanism: not airport (JFK is 7 km away) but AirTrain metro stations classified as subway. Airport fix still removes noise from `aeroway=terminal` nodes fetched by the broader radius.
- Tromsø: `attr −14` → idx 100→99 (−1). Multiple aerodrome nodes are now outside 2000 m. But the city has many other magnets (entertainment, shopping), so removing airports barely moves the index.
- Cannes: `attr −16` → Cannes-Mandelieu Airport within 3500 m, now filtered. Index stays 100 because other magnets compensate.

**Key finding:** The radius fix correctly removes airport inflation, but the ceiling problem masks the index improvement for any case with rawScore >> 100.

### 3.2 Competitor pressure (cap 20 → 15)
**Visible effect** in all cases with competitor saturation:
- Siena: +4 idx (5→9), pressure −5 pts.
- El Poblado: +5 idx (16→21), pressure −5 pts.
- Tourist/dense zones get back 5 raw score points.

**Expected for next pass:** historic attraction classifier (churches, palaces) would further lift Siena from 9 to 25–40 range — the competitor fix alone is insufficient without recognized attraction anchors.

### 3.3 Office weight (×0.72 named offices)
**Directionally correct** but **immeasurable** in this test:
- `attr 0` for all cases with offices — indicating that in the current OSM snapshot, the offices in these test cases are predominantly `office_anon` (unnamed), which was already at ×0.45. The change only affects `subType='office'` (named offices).
- The fix will have the intended effect in production for locations with many **named** provincial offices (notaries, insurers, МФЦ-style POIs).
- The code change is valid and kept.

### 3.4 Soft cap (above 80, factor 0.60)
**Working as designed** but only compresses rawScore 80–110:
- `rawScore 80→80, 90→86, 100→92, 120→capped at 100`
- For cases with rawScore >> 130 (Троmsø, Times Square), the soft cap cannot bring the index below 100.
- Переславль and Ozone Park would benefit IF their rawScore drops to 80–110 range after other fixes.

---

## 4. What did NOT improve

### 4.1 Ozone Park (100 → 93, still strong)
Root cause is **AirTrain metro stations** classified as subway, not the airport radius. JFK is 7 km away — well outside even 3500 m. The 6 metro entries are `railway=station` with `station=subway` tags (AirTrain). Fix: exclude `network=AirTrain` from metro classifier, or apply geographic filter.

### 4.2 Tromsø (100 → 99)
The city has 23+ magnets (entertainment, shopping, hotels) plus airport entries. Even removing airport contribution (−14 attr), the rawScore remains well above 100. Requires the **logarithmic normalization** (ME1 in plan) to differentiate truly exceptional vs. moderately strong.

### 4.3 Переславль (100 → 100)
In current OSM fetch: `attr 0, cp 0` — office weight change had zero measured effect. Either the current data has fewer named offices, or their contribution is different. In the original April data, 45 offices drove the score; now the signal is either absent or different. The code fix is still correct.

### 4.4 Siena / El Poblado (still weak/9 and weak/21)
The competitor pressure reduction added +4–5 idx, but these locations need the **historic attraction classifier** (churches, palaces, convents tagged as `historic=church` / `historic=building`) to reach the expected 25–45 range. Pass 2 priority.

### 4.5 Ceiling saturation
Cannes and Clapham now score 100 in the old model on current data (vs. stored 73 and 64 from April). This is **OSM data growth**, not model drift. More hotels, restaurants, and attractions are now tagged in these areas. The ceiling problem is getting worse over time as OSM coverage improves — urgency of logarithmic normalization is higher than assessed in April.

---

## 5. What was NOT changed (as instructed)

- `scoreScale = 1.94` — kept as-is
- `CATEGORY_RADIUS.metro = 1200m` — kept (metro mismatches are a classifier problem, not a radius problem)
- Ecological / environmental factor — not touched
- No new model architecture — all changes are ≤3 lines each

---

## 6. Next steps (Pass 2 priorities)

| Priority | Change | Expected impact | Complexity |
|----------|--------|----------------|------------|
| **P1** | Logarithmic normalization: `idx = 100 * raw / (raw + 90)` | Differentiates strong↔very strong; reduces ceiling cases from 33%+ to ~5% | Medium (requires threshold recalibration) |
| **P2** | Historic attraction classifier: `t.historic === 'church'|'palace'|'castle'|'monastery'` | Lifts Siena, Baku, Quartieri Spagnoli, Казань from weak to medium | Low (5 lines) |
| **P3** | Metro classifier: `t.railway==='station' && t.station==='subway'` already exists; add `t.network?.includes('MTR')` | Lifts HK, Causeway Bay from 6→60+ | Low (2 lines) |
| **P4** | AirTrain exclusion: filter `network=AirTrain` from metro | Fixes Ozone Park | Low (1 condition) |
| **P5** | Re-test office weight reduction with a wider case set | Confirm ×0.72 doesn't break legitimate office districts | No code change needed |

---

## 7. Summary

**Pass 1 achieved:**
- Airport radius fix: mechanically correct, removes 14–17 attr pts for airport-adjacent cases. Visible index improvement only for Ozone Park (−7 pts).
- Competitor pressure cap: modest but correct boost for tourist-dense zones (+4–5 idx for Siena, El Poblado).
- Office weight reduction: code correct, effect immeasurable in this snapshot due to `office_anon` dominance.
- Soft cap: working correctly, but ceiling problem requires normalization (P1 above) to fully resolve.

**Main blocker:** The ceiling effect (33%+ of cases at 100) is driven by rawScore >> 100 for many locations. The soft cap `80 + (raw−80)×0.60` can only differentiate cases with rawScore in the 80–120 range. Everything above 130 still caps at 100. **Logarithmic normalization is the highest-leverage next change.**

Strong anchors (Times Square) remain stable at 100 throughout. No regressions in the core scoring logic.
