# Residential Strategy Fit — V1 Tuning Plan

_Date: 2026-04-19_

---

## Current state

`recommendStrategy()` at `location-score.ts:42–46`:

```typescript
function recommendStrategy(b: { demand_score: number; seasonality_score: number }): RecommendedStrategy {
  if (b.demand_score > 75 && b.seasonality_score > 65) return 'short_term';
  if (b.demand_score > 55) return 'hybrid';
  return 'mid_term';
}
```

**Problem:** Strategy is derived from demand + seasonality only. Missing:
- Environment friction integration
- Audience stability consideration
- Competitive density
- Operational risk from location type

---

## Target strategy set (V1)

| Strategy | Meaning | Current coverage |
|---|---|---|
| `short_term` | Посуточная — high demand, stable audience, manageable environment | Partial (demand + seasonality only) |
| `hybrid` | Посуточно + среднесрок — mixed demand/environment signals | Partial |
| `mid_term` | Среднесрочная — lower demand or audience prefers stability | Partial |
| `selective_premium_short_term` | Short-term only with premium positioning — quiet, high-quality, low competition | MISSING |
| `cautious_manual_only` | Any strategy requires manual approach — hostile environment or very weak demand | MISSING |

---

## Rule logic redesign

### Step 1: Gather inputs

```
demand_score           (from location-score breakdown)
seasonality_score      (footTraffic.stability01 × 100)
supply_score           (competitor pressure, inverted)
audienceFit type       (business_corporate | transient_transport | leisure_tourist | premium_comfort | medical_related)
environmentFriction    (neighborhoodEnvironment.environmentalFrictionScore)
concernLevel           (low | moderate | elevated | high)
```

### Step 2: Disqualification checks (run first)

```
if (demand_score < 30 AND environmentFriction > 55):
  → cautious_manual_only
  reason: "Слабый спрос и высокая нагрузка среды — стратегия требует ручного управления"

if (environmentFriction > 70 AND concern = 'high'):
  → cautious_manual_only
  reason: "Высокая нагрузка среды несовместима с автоматическим STR-сценарием"
```

### Step 3: Premium short-term check

```
if (
  environmentFriction < 22     AND
  supply_score >= 65            AND
  demand_score >= 55            AND
  audienceFit in [premium_comfort, business_corporate]
):
  → selective_premium_short_term
  reason: "Тихая качественная среда с деловым или comfort-потоком — позиционирование премиум посуточно"
```

### Step 4: Standard short-term check

```
if (
  demand_score > 72             AND
  seasonality_score > 62        AND
  environmentFriction < 55      AND
  audienceFit in [business_corporate, transient_transport, leisure_tourist]
):
  → short_term
```

### Step 5: Hybrid check

```
if (
  demand_score > 50             AND
  environmentFriction < 65
):
  → hybrid
```

### Step 6: Mid-term fallback

```
if (demand_score <= 50 OR environmentFriction >= 65):
  → mid_term
```

---

## Environment integration rules

| environmentFrictionScore | Concern level | Strategy impact |
|---|---|---|
| 0–22 | low | No restriction. Premium path eligible. |
| 23–44 | moderate | No restriction. Mention in explanation but don't block. |
| 45–64 | elevated | Block `selective_premium_short_term`. Add friction note to explanation. |
| 65+ | high | Block `short_term` unless demand_score > 80. Prefer `hybrid` or `mid_term`. Force `cautious_manual_only` above 70. |

---

## Audience-strategy affinity matrix

| Audience type | Best fit strategy | Notes |
|---|---|---|
| `business_corporate` | `short_term` or `selective_premium_short_term` | Corporate demand is weekday-stable — ideal for STR |
| `transient_transport` | `short_term` or `hybrid` | High turnover, shorter stays — STR fits; environment often challenging |
| `leisure_tourist` | `short_term` or `hybrid` | Seasonal peaks; needs seasonality_score > 55 to justify full STR |
| `premium_comfort` | `selective_premium_short_term` only | Low-volume, high-value; requires quiet environment |
| `medical_related` | `hybrid` or `mid_term` | Medical-adjacent stays often 3–14 days; mid-term or hybrid better than nightly STR |

---

## Validation cases

These cases should return specific strategies after implementation:

| Location type | Expected strategy | Current engine output | Problem |
|---|---|---|---|
| Office cluster 400 m, metro 600 m, friction 18 | `selective_premium_short_term` | `short_term` (correct demand but no premium path) | No premium path exists |
| Airport 1.8 km, railway station 300 m, friction 52 | `short_term` | `short_term` (OK) | Friction not checked |
| Hospital 600 m only, friction 35, demand 58 | `hybrid` or `mid_term` | `hybrid` (roughly OK) | No medical audience integration |
| Quiet residential, no magnets, friction 10, demand 28 | `cautious_manual_only` | `mid_term` | No disqualification path |
| Nightclub zone, friction 68, demand 72 | `cautious_manual_only` | `short_term` (wrong) | Environment not checked |
| Tourist anchor 500 m, friction 30, demand 62 | `short_term` or `hybrid` | `hybrid` (OK-ish) | Seasonality not tourism-aware |

---

## What NOT to do

- Do not build `cautious_manual_only` as a fallback that triggers too easily (demand < 40 alone is not enough — environment must confirm)
- Do not block `short_term` purely from elevated concern level — many excellent STR locations are in elevated-friction urban cores (demand justifies it)
- Do not derive strategy solely from `location_score` — a score of 68 in a nightclub zone and a score of 68 in a quiet residential area deserve different strategies
- Do not promote `selective_premium_short_term` when supply_score < 55 — premium positioning requires room to price up without being undercut

---

## Implementation actions

1. Add `selective_premium_short_term` and `cautious_manual_only` to `RecommendedStrategy` type in `types.ts`
2. Create `buildResidentialStrategyFit(analysis: LocationAnalysis): ResidentialStrategyFit` in a new `residential-strategy.ts`
3. `ResidentialStrategyFit` should include: `strategy`, `strategyLabelRu`, `environmentNote`, `audienceNote`, `confidence`
4. Keep existing `recommendStrategy()` unchanged (commercial output) — residential strategy is a separate output field
5. Wire `buildResidentialStrategyFit` into `buildResidentialCoreOutput`
