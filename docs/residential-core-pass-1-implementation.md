# Residential Core — Pass 1 Implementation

**Date:** 2026-04-19  
**Files changed:**
- `src/lib/location/types.ts` — new types
- `src/lib/location/residential-analysis.ts` — new file (all 4 blocks)
- `src/lib/location/gravity-scoring.ts` — wires residential layer into `buildAnalysis`
- `src/lib/location/index.ts` — exports

---

## 1. What was implemented

All 4 blocks implemented in a single additive layer (`ResidentialAnalysisOutput`) that sits on top of the existing commercial engine. Zero changes to commercial scoring path.

---

## 2. New fields / enum / output added

### Types (`src/lib/location/types.ts`)

```typescript
ResidentialAudienceType = 'premium_comfort' | 'mixed_use_adjacent' | 'standard_residential'
ResidentialStrategy     = 'short_term' | 'selective_premium_short_term' | 'hybrid' | 'mid_term' | 'cautious_manual_only'
OperationalSuitability  = 'full_auto' | 'semi_auto' | 'manual'
ResidentialAnalysisConfidence = 'high' | 'medium' | 'low'
```

### Interface `ResidentialAnalysisOutput`

| Field | Type | Description |
|---|---|---|
| `residentialAudienceType` | `ResidentialAudienceType` | Livability-first audience classification |
| `residentialStrategy` | `ResidentialStrategy` | Residential-aware strategy (5 values vs 3) |
| `operationalSuitability` | `OperationalSuitability` | How safely location can be auto-operated |
| `confidence` | `ResidentialAnalysisConfidence` | Honest signal-quality rating |
| `confidenceReasons` | `string[]` | Why confidence is what it is |
| `premiumComfortSignals` | `string[]` | Non-empty only when `premium_comfort` |
| `operationalNoteRu` | `string` | One-line RU operational guidance |
| `strategyRationaleRu` | `string` | One-line RU strategy rationale |

Added as optional field to `LocationAnalysis`:
```typescript
residentialAnalysis?: ResidentialAnalysisOutput
```

Always populated by `buildAnalysis` on fresh runs.

---

## 3. Strategy logic changes

### Before (commercial `recommendStrategy`)
```
demand > 75 && seasonality > 65  → short_term
demand > 55                       → hybrid
else                              → mid_term
```
No awareness of: environment friction, audience type, competition risk, data quality.

### After (residential `computeResidentialStrategy`)

Decision tree (in priority order):

**1. `cautious_manual_only`** triggers when:
- Friction is elevated/high AND locationScore < 68
- Nightlife burden (nightlife01 > 0.50) AND industrial burden (industrial01 > 0.50)
- Nightlife burden AND major road burden (majorRoads01 > 0.60)
- High competition + weak demand (demand < 45) + non-low friction

**2. `selective_premium_short_term`** triggers when:
- audienceType is `premium_comfort`
- environmentalFrictionScore < 28
- locationScore ≥ 56, audienceFitScore ≥ 36
- stability01 ≥ 0.50, not fallback mode

**3. `short_term`** — demand > 72 AND seasonality > 60 AND friction not elevated/high

**4. `hybrid`** — demand > 52

**5. `mid_term`** — fallback

Key difference: `short_term` is now **blocked** when friction is elevated/high. Strong but noisy urban locations no longer auto-route to `short_term`. They get `hybrid` instead, which is more honest.

---

## 4. How `premium_comfort` works

**Fires only when all conditions are met:**
- `concernLevel === 'low'` (environmentalFrictionScore < 25)
- `nightlife01 < 0.28`
- `industrial01 < 0.20`
- `majorRoads01 < 0.38`
- `aviation01 < 0.30`
- `harshUrbanStack01 < 0.30`
- `locationScore ≥ 48` (real demand presence, not empty)
- `stability01 ≥ 0.48` (predictable flow)

**Premium comfort signals** (shown to operator):
- Минимальная общая нагрузка среды (if friction < 15)
- Тихий ночной профиль (if nightlife01 < 0.15)
- Нет промышленных зон поблизости (if industrial01 < 0.10)
- Спокойная транспортная среда (if roads01 < 0.25)
- Высокая стабильность потока (if stability01 ≥ 0.65)
- Нет авиационной нагрузки (if aviation01 < 0.10)

**Will NOT fire** for:
- Any elevated/high friction location
- Locations with nightlife or industrial burden
- Locations with zero effective demand (locationScore < 48)
- Unstable flow (stability01 < 0.48)

---

## 5. How `operationalSuitability` works

**`manual`** when:
- strategy is `cautious_manual_only`
- confidence is `low`
- friction is elevated/high AND locationScore < 62

**`full_auto`** when all:
- confidence is `high`
- strategy is `short_term` or `selective_premium_short_term`
- environmentalFrictionScore < 38
- competitorPressureLevel is not `high`

**`semi_auto`** — everything else

---

## 6. How `confidence` works

Score-based system (starts at 2 = medium baseline):

| Condition | Δ score | Reason added |
|---|---|---|
| magnetCount ≥ 7 | +2 | |
| magnetCount ≥ 4 | +1 | |
| magnetCount ≤ 2 | −1 | "Мало магнитов" |
| audienceFitScore ≥ 55 | +2 | |
| audienceFitScore ≥ 32 | +1 | |
| evergreenIndex ≥ 65 | +1 | |
| stability01 ≥ 0.65 | +1 | |
| isFallbackMode | −2 | "Аудиторный режим: резерв" |
| Conflicting signals (strong gravity + elevated friction + weak demand) | −1 | "Конфликт сигналов" |
| Elevated/high friction + demand < 50 | −2 | "Высокая нагрузка + слабый спрос" |
| Elevated/high friction + demand ≥ 50 | −1 | "Повышенная нагрузка среды" |
| neighborhoodEnvironment.confidence === 'low' | −1 | "Разреженные данные карты" |
| strategy === cautious_manual_only | caps score at ≤ 2 | "Стратегия cautious_manual_only" |

Score ≥ 5 → `high` | Score ≥ 3 → `medium` | Score < 3 → `low`

---

## 7. Before / After on representative cases

| Case | Commercial strategy (before) | Residential strategy | Audience type | Confidence | OpSuitability |
|---|---|---|---|---|---|
| **Strong noisy urban** (score 72, friction 58 elevated, nightlife+roads) | `short_term` | `hybrid` | `mixed_use_adjacent` | high | semi_auto |
| **Quiet premium** (score 65, friction 12 low, hospital nearby) | `hybrid` | `selective_premium_short_term` | `premium_comfort` | high | full_auto |
| **Transport-heavy** (score 62, friction 38 moderate, transport-led) | `hybrid` | `hybrid` | `mixed_use_adjacent` | high | semi_auto |
| **Tourist-heavy, weak for living** (score 60, friction 35, fallback=true) | `hybrid` | `hybrid` | `standard_residential` | **low** | **manual** |
| **Medium residential urban** (score 63, friction 28 moderate) | `hybrid` | `hybrid` | `mixed_use_adjacent` | medium | semi_auto |
| **Weak suburb** (score 42, friction 15 low, fallback=true) | `mid_term` | `mid_term` | `standard_residential` | **low** | **manual** |
| **Medical-adjacent** (score 65, friction 22 low, hospital anchor) | `hybrid` | `selective_premium_short_term` | `premium_comfort` | high | full_auto |

### Key improvements

1. **Strong noisy urban**: prevented from auto-routing to `short_term` — now `hybrid` because elevated friction blocks the optimistic path. No more inflated recommendations for noisy central locations.

2. **Quiet premium / medical-adjacent**: jumped from generic `hybrid` → `selective_premium_short_term` + `premium_comfort` + `full_auto`. The biggest quality jump of this pass.

3. **Tourist-heavy fallback**: confidence dropped to `low`, operationalSuitability to `manual` — operator now knows the residential picture is unreliable, not just "hybrid with tourist flow".

4. **Weak suburb**: similarly surfaced as low-confidence + manual rather than silently returning `mid_term` without any reliability signal.

### Potential regressions

None found on commercial path — `buildAnalysis` return shape is strictly additive (`residentialAnalysis` is an optional new field). Existing consumers reading `locationScore.recommended_strategy` still get the unchanged commercial strategy.

The one non-obvious tension: a very strong urban location (score ≥ 80, elevated friction) stays `hybrid` in residential strategy even though commercial says `short_term`. This is intentional — commercial strategy is demand-optimistic, residential is livability-aware.

---

## 8. How close this brings residential branch to strong V1

### As demo
**~68% of a strong V1.**  
Four new output fields with real logic. Strategy is now friction-aware. Premium comfort is non-trivial. Confidence surfaces data gaps. What's missing: no phase-2 residential-specific magnets (green zones, schools, pharmacies), no long-term rental scoring, no price/income model adjusted for residential ADR.

### As standalone product
**~55% of a strong V1.**  
Needs a residential-specific report builder (currently only commercial `LocationCommercialReport` and generic `LocationStandaloneReport` exist). The output layer is there but no standalone report format wraps it yet.

### As core engine
**~72% of a strong V1.**  
The four-block layer is solid. Gaps: (a) no residential-specific magnet weighting (schools, parks, pharmacies don't yet appear as magnets); (b) income model still commercial ADR; (c) no long-stay vs short-stay demand split.

---

## 9. What remains for pass 2

Priority order:
1. Residential standalone report builder (wraps `ResidentialAnalysisOutput` + existing analysis into a residential-flavored report)
2. Residential-specific magnet categories (park/green, pharmacy, school, grocery cluster)
3. ADR + income model calibrated for residential STR (not commercial proxy)
4. Long-stay audience type (relocation, digital nomad) as a 4th `ResidentialAudienceType`
5. Price sensitivity modifier based on `premium_comfort` signals
