# Residential Core Engine — Implementation Audit

_Date: 2026-04-19 | Scope: src/lib/location/_

---

## 1. Mapping: desired fields vs current implementation

| Desired field | Current implementation | Location in code | Gap / status |
|---|---|---|---|
| `commercialStrength` | `evergreenIndex` + `locationScore.location_score` | `gravity-scoring.ts`, `location-score.ts` | EXISTS — but calibrated for commercial demand magnets, not residential living/rental comfort mix |
| `environmentQuality` | `NeighborhoodEnvironmentLayer` (friction score 0–100, inverted quality) | `neighborhood-environment.ts` | EXISTS and well-implemented; best coverage of all residential fields |
| `audienceFit` | `AudienceAnalysis.audienceFitScore` + `primaryAudience: BUSINESS|TOURIST` | `audience-scoring.ts` | PARTIAL — covers only 2 audience archetypes; no premium_comfort, medical_related, transient_transport |
| `strategyFit` | `recommendStrategy()` → `'short_term' | 'hybrid' | 'mid_term'` | `location-score.ts:42–46` | PROXY — demand_score + seasonality_score only; no environment integration, no selective/cautious paths |
| `operationalSuitability` | NOT PRESENT | — | MISSING — manual/semi-auto/full-auto logic does not exist anywhere |
| `confidence` | Partial: `NeighborhoodEnvironmentLayer.confidence` (OSM coverage only) | `neighborhood-environment.ts:361–368` | MISSING as residential decision confidence; existing confidence is OSM-coverage-only |
| `warnings` | NOT PRESENT as a formal field | — | MISSING — no structured warnings array |
| `explanation layer` | `conclusion` string + `top_positive_factors[]` + `top_negative_factors[]` | `explanation.ts`, `location-score.ts:70–325` | PARTIAL — commercial-oriented copy, not residential framing |

---

## 2. Parts that exist and are in use

### 2.1 evergreenIndex (gravity engine)
- Full implementation in `gravity-scoring.ts`
- Attraction scoring: `weight × permanence × distance-decay`
- Cluster bonus, foot-traffic boost, competitor pressure
- Calibrated for commercial context; produces reasonable proxy for high-demand residential locations
- Soft cap above 80: prevents Times Square effect

### 2.2 locationScore / LocationScoreOutput
- Weighted formula: AudienceFit 40% | Demand 25% | Competition 20% | Accessibility 15%
- Output: `location_score`, `rating`, `breakdown`, `estimated_monthly_income`, `recommended_strategy`
- `estimated_monthly_income` uses a rough RUB proxy (base ADR × occupancy × 30d)
- Income model is Moscow-region-calibrated; does not distinguish city-tier or property size

### 2.3 AudienceAnalysis
- `primaryAudience: BUSINESS | TOURIST` (FAMILY exists in types but is never used)
- Mode lock at audienceSharePct >= 65 (BUSINESS) or <= 35 (TOURIST)
- `audienceFitScore`: exponential decay, cluster bonus, URBAN_BUSINESS amplifier
- `businessClusterDetected`: ≥2 non-bank business magnets within 1 km
- `demandFlowLabel`: "устойчивый поток" | "поток ограничен" | "туристический поток"
- **Gap**: No residential-specific audience types (premium_comfort, medical_related, transient_transport)

### 2.4 NeighborhoodEnvironmentLayer
- Best-implemented residential signal in the engine
- Sub-components: majorRoads01, industrial01, aviation01, nightlife01, transitCorridor01, harshUrbanStack01
- Concern levels: low | moderate | elevated | high
- OSM-coverage confidence: high | medium | low
- Soft commercial modifier: `NeighborhoodEnvironmentCommercialModifierSnapshot` (−0–9 pts to headline)
- **Strong**: directly relevant to residential suitability, actionable narrative

### 2.5 SpatialFoundationSnapshot
- Barrier/corridor stub (spatialTier: 'stub' only)
- Applies penalty multipliers when barriers (water/rail/major_road) separate property from magnets
- `enabled: false` by default in residential/demo flow

### 2.6 Foot-traffic layer
- FootTrafficSummary: modifierTier, boostPoints, movementDensity, transitVsTarget shares
- Used as seasonality proxy and flow-stability signal
- Reasonable for residential demand stability inference

---

## 3. Parts that are missing or incomplete

### 3.1 Unified residential output type
There is no `ResidentialCoreOutput` type or function. The closest is `LocationAnalysis` (internal engine output) which is commercial-first.

**What needs to be built:**
```typescript
interface ResidentialCoreOutput {
  commercialStrength: number;          // evergreenIndex proxy
  environmentQuality: number;          // 100 - environmentalFrictionScore
  audienceFit: ResidentialAudienceFit; // typed breakdown per audience type
  strategyFit: ResidentialStrategyFit; // environment-aware strategy
  operationalSuitability: 'manual' | 'semi_auto' | 'full_auto';
  confidence: ResidentialConfidenceLevel;
  warnings: string[];
  explanation: ResidentialExplanation;
}
```

### 3.2 Residential audience types
Current `TargetAudience` = `'BUSINESS' | 'TOURIST' | 'FAMILY'`.
FAMILY is declared but never computed. Five priority residential types are not modeled:
- `business_corporate` — partial proxy via BUSINESS mode
- `transient_transport` — partial proxy via `demandType === 'transport-led'`
- `leisure_tourist` — partial proxy via TOURIST mode
- `premium_comfort` — no OSM proxy exists
- `medical_related` — rough proxy via hospital magnet only

### 3.3 Strategy fit depth
`recommendStrategy()` at `location-score.ts:42–46` is 3 lines:
```typescript
if (b.demand_score > 75 && b.seasonality_score > 65) return 'short_term';
if (b.demand_score > 55) return 'hybrid';
return 'mid_term';
```
Missing: environment friction integration, selective/cautious path, audience stability factor.

### 3.4 Operational suitability
Not modeled anywhere. `manual | semi_auto | full_auto` logic is entirely absent.

### 3.5 Decision confidence layer
Only `NeighborhoodEnvironmentLayer.confidence` exists (OSM coverage proxy).
No overall residential-decision confidence score that aggregates:
- signal density
- audience certainty
- data coverage
- environment friction clarity

### 3.6 Warnings
No structured `warnings[]` field. Negative factors appear only in `top_negative_factors[]` (commercial copy).

---

## 4. Output separation

| Output tier | Current type | Status |
|---|---|---|
| Demo output | `LocationAnalysis` rendered in `LocationIntelligenceDemo.tsx` | EXISTS — commercial-first framing |
| Standalone sellable output | `LocationStandaloneReport` (v1) + `LocationCommercialReport` (v2-commercial) | EXISTS — commercial-oriented |
| Core engine output | `LocationAnalysis` (no residential variant) | PARTIAL — repurposed commercial output; residential sub-object missing |

The engine produces one unified `LocationAnalysis`. There is no residential branching at the engine level.
To produce a proper residential core output, a thin residential shim layer needs to be built on top of `LocationAnalysis`.

---

## 5. Summary: what to build

Priority order for residential completeness:

1. **`ResidentialAudienceType`** enum + audience signal definitions (5 types)
2. **`ResidentialStrategyFit`** function integrating environment friction + audience
3. **`ResidentialOperationalSuitability`** function (manual/semi-auto/full-auto rules)
4. **`ResidentialConfidenceLevel`** aggregator
5. **`buildResidentialCoreOutput(analysis: LocationAnalysis): ResidentialCoreOutput`** wrapper
6. Separate demo / standalone / core output clearly via this wrapper
