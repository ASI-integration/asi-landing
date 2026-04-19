# Residential Confidence Layer — V1

_Date: 2026-04-19_

---

## Problem

The current engine outputs scores with the same confident tone regardless of data quality. A location with 3 OSM elements and one office magnet gets the same format as a dense urban core with 80+ elements and a verified business cluster. The audience and strategy inferences are unreliable in sparse conditions but they are not flagged.

---

## Confidence tiers

| Tier | Label (RU) | Meaning |
|---|---|---|
| `high` | Высокая уверенность | Multiple strong signals, good OSM coverage, audience clearly identified, environment well-modeled |
| `medium` | Средняя уверенность | Core signals present but some areas rely on proxy inference; results are usable but should be validated |
| `low` | Низкая уверенность | Sparse OSM data, audience type inferred from weak or single signal, environment model unreliable |
| `proxy_only` | Только прокси — нужна ручная проверка | Engine is producing output from very thin signals; result is directional only, not decision-grade |

---

## Confidence rules

### Input signals for confidence computation

```
osmElementCount             (total OSM elements in the fetch window)
magnetCount                 (number of magnets found, across all categories)
neighborhoodConfidence      (from NeighborhoodEnvironmentLayer: 'high'|'medium'|'low')
businessClusterDetected     (boolean)
audienceFallbackMode        (boolean — TOURIST because no BUSINESS found, not because tourist is strong)
primaryAudienceType         (string)
lockedMode                  (boolean — audienceSharePct hard-locked)
demandType                  ('tourism-led'|'business-led'|'transport-led'|'mixed')
environmentFrictionScore    (0–100)
```

### High confidence — all must be true
```
osmElementCount >= 35
magnetCount >= 5
neighborhoodConfidence = 'high'
NOT audienceFallbackMode
lockedMode = true (audience share clearly dominant)
```

### Low confidence — any one triggers low
```
osmElementCount < 12
magnetCount <= 1
neighborhoodConfidence = 'low'
audienceFallbackMode = true AND demandType = 'mixed'
```

### proxy_only — any one triggers proxy_only
```
osmElementCount < 6
magnetCount = 0
The only magnet found is bank or shopping_local (weight ≤ 1.2)
```

### Medium confidence — everything else

---

## Signal-level confidence breakdown

Each component of the residential output should have its own confidence:

```typescript
interface ResidentialConfidence {
  overall: 'high' | 'medium' | 'low' | 'proxy_only';
  audienceFitConfidence: 'high' | 'medium' | 'low';
  environmentConfidence: 'high' | 'medium' | 'low';
  strategyConfidence: 'high' | 'medium' | 'low';
  operationalConfidence: 'high' | 'medium' | 'low';
  explanationNote: string;  // short Russian note for UI
}
```

### AudienceFit confidence rules

| Condition | audienceFitConfidence |
|---|---|
| `businessClusterDetected = true` AND `lockedMode = true` | high |
| `lockedMode = true` but no cluster | medium |
| `fallbackMode = true` (tourist by absence, not strength) | low |
| Single magnet only | low |
| `audienceSharePct` between 40–60, no lock | medium |

### Environment confidence rules

These map directly from `NeighborhoodEnvironmentLayer.confidence`:
- `'high'` OSM coverage → high environment confidence
- `'medium'` → medium
- `'low'` → low (regardless of friction score value)

Additional downgrade: if `environmentalFrictionScore` is "low" but `osmElementCount < 15`, downgrade to medium — sparse data may miss industrial or road elements.

### Strategy confidence rules

| Condition | strategyConfidence |
|---|---|
| strategy derived from `high` audienceFit + `high` environment confidence | high |
| one of the two inputs is medium | medium |
| `cautious_manual_only` forced by high friction | medium (the decision is correct but location data is mixed) |
| Both audienceFit and environment are low confidence | low |
| `proxy_only` overall → strategy is indicative only | low |

---

## UI / output rules

When confidence is `low` or `proxy_only`:
- Do not display income estimates as reliable — show range, not point estimate
- Do not recommend strategy with the same weight as a `high` confidence result
- Add a warning note: "Данные по локации разрежены — результат ориентировочный"
- Do not show `operationalSuitability` as a firm recommendation — show as "предварительно"

When confidence is `medium`:
- Income estimates are displayed with ±20% caveat
- Strategy is shown but labeled "рекомендательно"
- All factors are shown but with a note about data coverage

When confidence is `high`:
- Standard output, no caveats required beyond standard explanations

---

## Common patterns where confidence is overestimated (current state)

1. **Suburban address with 1 named office (office_anon)**: gets `BUSINESS` audience, `short_term` strategy, no warning. In reality confidence should be `proxy_only` — single anonymous office is not a demand driver.

2. **Tourist fallback mode**: location has no business magnets, no tourist attractions, gets `TOURIST` audience via fallback. Confidence should be `low` — no genuine audience signal.

3. **Low OSM coverage in provincial city**: `NeighborhoodEnvironmentLayer.confidence = 'low'` but strategy and income estimates still appear confident. Should propagate to overall.

4. **Medical-related inference from single polyclinic**: hospital weight 7 at 800 m → high attraction score → `BUSINESS` mode. Confidence should be `medium` at best since single small medical facility.

---

## Integration with output

`confidence` must be computed AFTER all sub-outputs and used to:
1. Select explanation note tone (firm vs cautious)
2. Decide whether to show income ranges or suppress them
3. Annotate strategy with confidence label
4. Determine whether to show `operationalSuitability` as firm or preliminary

Do NOT use confidence as a score modifier — it does not change the underlying score, only the output framing.

---

## Pass-3 implementation (2026-04-19) — `buildResidentialAnalysis`

The V1 table above remains the *product* intent; the shipped residential layer uses a **compact three-tier** model (`high` | `medium` | `low`) with the following **extra semantics** wired in `computeResidentialConfidence`:

| Axis | Role |
|------|------|
| Signal clarity | Magnets, audience fit, evergreen index, stability (bonus/penalty for volatile flow under STR) |
| Cross-consistency | Penalty when location / demand / seasonality diverge strongly while the trio sits in a middling band |
| Burden stacking | Count of material axes (industrial, nightlife, major roads, aviation, harsh urban stack); 2 axes → −1 tier step; 3+ → −2 |
| Environment + demand | Elevated/high friction with weak demand → heavy penalty; moderate elevated friction → −1 |
| Data quality | `NeighborhoodEnvironmentLayer.confidence === 'low'` → −1 |
| Cautious strategy | Score capped before mapping (still maps to `low` — “automation confidence”, not “unknown location”) |
| **Hybrid + elevated cap** | If strategy is `hybrid` and concern is elevated/high, **`high` is forbidden** unless `hybridElevatedPrimeCoreException` (strong center: location ≥ 78, demand ≥ 80, magnets ≥ 10, clean industrial/nightlife/stack/roads profile) |
| **Industrial / harsh-stack ceiling** | For non-cautious strategies, `industrial01 ≥ 0.52` or combined harsh stack + industrial proxy → **`high` forbidden** (unless prime-core exception) |

`confidenceReasons` lists the **dominant downgrades** (Russian) so operators can audit why the tier moved.

**Rationale (`strategyRationaleRu`)** is generated in the same pass: audience label, concrete score bits, optional “what blocked a more aggressive strategy” (`describeAggressiveBlockerRu`), and a **confidence-aligned closing sentence** (high / medium / low wording).
