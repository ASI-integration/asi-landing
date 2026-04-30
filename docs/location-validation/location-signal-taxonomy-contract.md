# Location signal taxonomy contract (RU public copy safety)

## Goal

Guarantee that **weak/local POIs can never become strong public demand drivers** (especially for BUSINESS / “командированные”) even if they are close or numerous.

This contract is enforced by the taxonomy layer in:

- `src/lib/location/signals/location-signal-taxonomy.ts`
- integrated into audience selection + RU copy paths via:
  - `src/lib/location/audience-scoring.ts`
  - `src/lib/location/explanation.ts`

## Taxonomy schema

### Signal levels

- `tier1_anchor`: strong anchor (can justify primary audience + strong claims)
- `tier2_anchor`: secondary anchor (can contribute; may justify moderate claims)
- `weak_local_signal`: local/weak signal (context only; never a strong driver)
- `noise`: not meaningful for demand claims
- `negative_environment_signal`: negative environment signal (never a positive driver)

### Domains

- `business`
- `tourist`
- `medical`
- `education`
- `transport`
- `civic`
- `hospitality`
- `residential_support`
- `environment_negative`

### Public claim strength

- `strong_driver_allowed`
- `moderate_driver_allowed`
- `weak_context_only`
- `hidden_from_public_copy`

## Hard rules (must-hold invariants)

### 1) Weak/local POIs must never unlock BUSINESS

**BUSINESS audience and “командированные” framing is allowed only with credible anchors**, e.g.:

- named business center / office complex / `БЦ` / “бизнес‑центр”
- explicit CBD context (e.g. “Москва‑Сити” / “Деловой центр”) via transit anchors
- railway station / airport
- major hospital
- multiple independent credible business anchors

**It is NOT allowed** to infer BUSINESS from any of the following alone:

- person‑name offices like “Фамилия И.О.”
- generic “офис”
- bank branches
- insurance offices
- small service/admin offices
- local businesses without known scale

### 2) Forbidden wording contract (RU)

If BUSINESS is not unlocked by credible anchors, public copy MUST NOT contain:

- “основной драйвер”
- “стабильный поток командированных”
- “кластер деловых объектов”
- “сильный коммерческий профиль”

### 3) Weak/local POIs are never “strong drivers”

Weak/local business-like POIs are classified as:

- `level = weak_local_signal`
- `publicClaimStrength = hidden_from_public_copy`
- `allowsBusinessAudience = false`

They may appear only as **weak context** (or be omitted entirely) and must not:

- become `primaryAudience = BUSINESS`
- create `businessClusterDetected`
- introduce strong-driver copy

## Implementation notes

### Key classifiers (RU)

- **Person-name office** (example): “Иванов И.И.” → `weak_local_signal`
- **Weak business names/subtypes**: `bank`, `insurance`, `office_anon`, generic “офис”, bank/insurance keywords → `weak_local_signal`
- **Strong business anchors**: “бизнес‑центр”, `БЦ`, “office complex”, “Москва‑Сити”, “технопарк” → `tier1_anchor`, unlocks BUSINESS
- **Transport anchors**:
  - airport / railway station: `tier1_anchor`, unlocks BUSINESS
  - metro: unlocks BUSINESS only for explicit CBD context (“Москва‑Сити”, “Деловой центр”)

## Test expectations (contract coverage)

Tests validating the contract live in:

- `src/lib/location/signals/__tests__/location-signal-taxonomy.test.ts`
- `src/lib/location/__tests__/location-taxonomy-integration.test.ts`

Required invariants covered:

- person-name office at ~130 m → `weak_local_signal`, **no BUSINESS**, no forbidden wording
- weak office cluster → no forbidden “кластер деловых объектов”
- bank/insurance alone → cannot produce BUSINESS

