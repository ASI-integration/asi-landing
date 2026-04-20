# Residential Operational Suitability — V1

_Date: 2026-04-19_

---

## Overview

Operational suitability answers: **how much human oversight does running this property require?**

Three tiers: `full_auto | semi_auto | manual_only`

Currently this field does not exist anywhere in the engine.

---

## Definitions

### `full_auto`
Self-service or automated-management operations are viable without on-site intervention for routine processes.
- Guest check-in via smart lock
- Cleaning by scheduled service
- No noise/neighbor complaints expected
- Demand is stable, turnover manageable
- Rare edge cases, low friction

### `semi_auto`
Automation works for routine operations but requires periodic manual oversight.
- Some friction signals require attention (neighbor noise, transit-related late arrivals)
- Competition pressure requires active pricing
- Seasonal demand shifts need calendar management
- Occasional local complaints likely in high-density areas

### `manual_only`
Property requires active hands-on management. Automation is risky or insufficient.
- High environmental friction (noise, nightlife, industrial)
- Unstable or seasonal demand requires constant re-pricing
- High competitor pressure requires daily pricing adjustments
- Guest profile is low-predictability (transit/airport rush)
- Legal/regulatory risk in the area (high-density STR zones)

---

## Decision rules

### Input signals

```
environmentalFrictionScore     (0–100)
concernLevel                   (low | moderate | elevated | high)
supply_score                   (0–100, inverted competitor pressure)
demand_score                   (0–100)
audienceFit type               (business_corporate | transient_transport | leisure_tourist | premium_comfort | medical_related)
demandType                     (tourism-led | business-led | transport-led | mixed)
nightlife01                    (0–1 from neighborhood breakdown)
transitCorridor01              (0–1)
businessClusterDetected        (boolean)
```

### Rule evaluation (in order)

**1. Force `manual_only`:**
```
environmentalFrictionScore > 65           → manual_only (high environment management)
nightlife01 > 0.6                         → manual_only (noise complaints near certain)
concernLevel = 'high' AND demand_score < 60 → manual_only (stress + weak demand)
demandType = 'transport-led' AND environmentalFrictionScore > 50 → manual_only
  (transit hubs with high friction: 24h turnover + noise = not automatable)
```

**2. Allow `full_auto`:**
```
ALL of the following:
  environmentalFrictionScore < 28         (quiet environment)
  nightlife01 < 0.15                      (no nightlife pressure)
  supply_score >= 60                      (manageable competition)
  demand_score >= 55                      (stable enough demand)
  audienceFit in [business_corporate, premium_comfort]  (predictable guests)
  businessClusterDetected = true OR demandType = 'business-led'
→ full_auto
```

**3. Default `semi_auto`** (everything else).

---

## Audience-suitability affinity

| Audience type | Typical suitability | Reason |
|---|---|---|
| `business_corporate` | `full_auto` or `semi_auto` | Predictable guest profile, business hours, low noise sensitivity, stable demand cycle |
| `premium_comfort` | `full_auto` | High-value guest, high expectations, but quiet environment and predictable stays |
| `leisure_tourist` | `semi_auto` | Seasonal peaks, varied stay lengths, higher noise/party risk, needs calendar management |
| `medical_related` | `semi_auto` | Multi-night stays, often distressed family members — requires flexibility, not full auto |
| `transient_transport` | `semi_auto` or `manual_only` | 24h arrivals, high turnover, potentially noisy corridor → depends on environment |

---

## Environment-suitability matrix

| Environment friction | Concern level | Default suitability |
|---|---|---|
| 0–22 | low | `full_auto` eligible |
| 23–44 | moderate | `semi_auto` default |
| 45–64 | elevated | `semi_auto` with warning |
| 65–79 | high (partial) | `manual_only` |
| 80+ | high (severe) | `manual_only` + disrecommend STR |

---

## Edge cases and overrides

**Case: High friction but business cluster**
- `environmentalFrictionScore = 52`, `concernLevel = 'elevated'`
- `businessClusterDetected = true`, `audienceFit = business_corporate`
- `supply_score = 72`
- Result: `semi_auto` (business demand justifies, but elevated friction needs periodic oversight)
- Note: corporate travelers are less sensitive to noise than leisure guests

**Case: Quiet zone but weak demand**
- `environmentalFrictionScore = 15`, `demand_score = 32`
- `premium_comfort` audience, `supply_score = 80`
- Result: `semi_auto` — quiet environment is good but weak demand requires active channel management
- NOT `full_auto` because low demand = low booking volume = auto rules fail with sparse data

**Case: Transport hub, moderate friction**
- `demandType = 'transport-led'`, `environmentalFrictionScore = 48`
- `transitCorridor01 = 0.7`, `nightlife01 = 0.15`
- Result: `semi_auto` — late arrivals and high turnover need periodic checks, but environment is tolerable

**Case: Nightclub zone, moderate demand**
- `nightlife01 = 0.65`, `environmentalFrictionScore = 58`
- `demand_score = 68`
- Result: `manual_only` — nightlife01 > 0.6 forces manual regardless of demand

---

## Output structure

```typescript
interface ResidentialOperationalSuitability {
  tier: 'full_auto' | 'semi_auto' | 'manual_only';
  tierLabelRu: string;
  primaryReason: string;
  warningFlags: string[];
}
```

### Russian labels
- `full_auto`: "Автоматическое управление"
- `semi_auto`: "Смешанное управление (периодический контроль)"
- `manual_only`: "Ручное управление обязательно"

---

## What is still weak

1. No OSM signal for STR regulatory zones (ban zones, licensing requirements) — this would affect `manual_only` cases
2. `nightlife01` is based on nightclubs + bars within 300–350 m; some party-heavy areas are missed if venue tagging is incomplete in OSM
3. No model for neighbor-complaint risk (apartment density) — multi-floor residential buildings in dense cores have different management overhead than standalone houses
4. Seasonal demand shifts (summer tourist peaks) are not factored into suitability — `full_auto` in a tourist zone might work in winter but fail in July
