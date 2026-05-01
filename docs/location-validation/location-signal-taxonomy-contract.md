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

## Domain anchor validity

Raw POI category is **never enough** to drive a strong public claim. Every domain
has a weak/minor vs credible split, and strong claims (≥70 score, "Сильная …"
verdicts, "основной драйвер" wording, audience switch) require **credible**
anchors. Minor POIs may add context but cannot drive the verdict alone.

| Domain | Credible (tier1 / tier2) | Weak (`weak_local_signal`) |
|---|---|---|
| business | named БЦ / business center, office complex, "Москва‑Сити", технопарк, штаб‑квартира, factory / industrial zone | bank, insurance, generic "офис", person‑name office, нотариус / адвокат / юрист, travel agency |
| tourist | major attraction, known landmark, central historic / leisure cluster, hotel cluster (≥2), TRC / "Мега" / молл | corporate / industrial / factory / enterprise museum, "Музей истории завода", local mini‑attraction |
| medical | многопрофильная больница, госпиталь, медицинский центр, перинатальный / онкологический / кардиологический центр, НИИ | стоматология, клиника красоты, косметолог, аптека, лаборатория, медицинский кабинет |
| education | университет, институт, академия, кампус | детский сад, школа, курсы, тренинг, репетитор |
| transport | airport, railway station, metro in CBD context ("Москва‑Сити", "Деловой центр") | bus / tram stop, non‑CBD metro |
| hospitality | hotel cluster (≥2 credible), resort / leisure district | single small hotel / mid_hotel, hostel, гостевой дом |
| civic | (no single‑POI credible primary — only ≥2‑anchor government / event clusters) | ЗАГС, администрация, МФЦ, муниципальное учреждение, почта, архив |
| retail | TRC / "Мега" / молл / "торгово‑развлекательный центр" / галерея | "магазин у дома", минимаркет, павильон, ларёк, "продукты" |

### Single‑weak‑POI invariant

A single magnet classified as `weak_local_signal` must never produce:

- score band ≥70 with "Сильная …" verdict
- `primaryDriverLabel` containing "основной драйвер" / "стабильный поток" / "сильная … локация"
- `primaryAudience = 'BUSINESS'` (business gating)
- audience-level cluster flag (`businessClusterDetected`, hospitality cluster)
- "медицинский кластер" / "студенческий поток" wording in the conclusion

Weak‑only contexts emit the moderate fallback line:

> "Есть отдельные сигналы спроса рядом, но крупный якорь не подтверждён."

For corporate / industrial / factory / enterprise museums specifically:

> "Есть отдельный культурный объект рядом, но сильный туристический поток не подтверждён."

## Target audience eligibility contract

Signal **domain** is not the same as **target audience**. The system selects a
target audience only after checking credible anchor combinations. The current
type‑level union (`TargetAudience = 'BUSINESS' | 'TOURIST' | 'FAMILY'`) stays
narrow; the new audiences listed below are enforced at the credibility / gating
layer (helpers in `signals/location-signal-taxonomy.ts`) rather than as union
members.

Allowed unlocks:

- **CORPORATE / B2B** — CBD / business district, named business center / office
  complex, corporate campus / industrial business cluster, expo / convention /
  event business anchor, multiple credible business anchors. Single office,
  bank, insurance, or local admin office never qualifies.
- **BUSINESS_TRAVELERS / командированные** — railway station / airport /
  intercity transport, business center / industrial employment cluster, major
  hospital or university only when it produces visitor / stay demand,
  logistics / production hub with realistic short‑stay demand. Random office /
  person‑name office / single clinic never qualifies.
- **TOURISTS** — major attraction, known landmark, historic center, resort /
  beach / leisure zone, hotel + attraction cluster, multiple independent
  tourist anchors. A single corporate museum, small local attraction, or
  factory museum never qualifies.
- **FAMILIES** — safe residential environment, parks / waterfront / family
  leisure, apartment‑friendly area, low environment burden, family attractions
  or resort context. School / kindergarten alone never qualifies; "residential
  district" alone is not strong family demand.
- **RESIDENTIAL / local‑stay** — normal residential fabric, moderate transport,
  local services, weak or unclear external demand. Should produce a
  cautious / moderate verdict, never strong.
- **MIXED** — several moderate signals, no single credible primary audience
  dominates, business / tourist / family signals present but not strong enough
  alone.
- **WEAK** — no credible demand anchors, only weak local POIs, bad
  transport / environment / competition profile.

Forbidden audience escalations (enforced by the taxonomy + scoring contract):

- single office → BUSINESS / CORPORATE
- single bank / insurance → BUSINESS
- corporate museum → TOURISTS
- small clinic / dentistry → MEDICAL / BUSINESS_TRAVELERS
- school / kindergarten → FAMILIES / EDUCATION
- single small hotel / hostel → TOURISTS
- ZAGS / local civic office → BUSINESS / TOURISTS
- one weak POI of any type → score 90–100

### Helpers

Single‑POI predicates exposed by
`src/lib/location/signals/location-signal-taxonomy.ts`:

- `isCredibleBusinessAnchor`, `isCredibleTouristAnchor`,
  `isCredibleMedicalAnchor`, `isCredibleEducationAnchor`,
  `isCredibleTransportAnchor`, `isCredibleHospitalityAnchor`,
  `isCredibleRetailAnchor`, `isCredibleCivicAnchor` *(always false at
  single‑POI level)*

Array‑level audience eligibility gates:

- `hasCredibleBusinessAnchors`, `hasCredibleTouristAnchors`,
  `hasCredibleMedicalAnchors`, `hasCredibleEducationAnchors`,
  `hasCredibleHospitalityCluster` *(≥ 2 credible hospitality anchors)*

## Test expectations (contract coverage)

Tests validating the contract live in:

- `src/lib/location/signals/__tests__/location-signal-taxonomy.test.ts`
- `src/lib/location/__tests__/location-taxonomy-integration.test.ts`

Required invariants covered:

- person-name office at ~130 m → `weak_local_signal`, **no BUSINESS**, no forbidden wording
- weak office cluster → no forbidden “кластер деловых объектов”
- bank/insurance alone → cannot produce BUSINESS

