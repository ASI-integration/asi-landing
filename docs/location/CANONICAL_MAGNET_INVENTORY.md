# Canonical magnet inventory (runtime + docs + tests)
**Workspace:** `C:\ASI\asi-landing`  
**Goal:** identify every current “source of truth” that defines or influences residential location magnets, scoring, explanation, UI display, and tests — and record conflicts / bypasses.

## Scope and definitions
- **Magnet truth**: anything that can change *what a POI is considered* (type), *how strong it is* (tier/anchor strength), *who it is eligible for* (audiences), *how far it reaches* (distance bands / radii), *how it contributes to score*, or *how it is explained/shown*.
- **Runtime-executed** means imported by the app/api code paths or tests and used in analysis/report generation.
- **Documentation-only** means human docs that are not imported/executed.

## Canonical docs sources (documentation-only)
### `docs/residential-prime-magnets-policy.md`
- **Role**: canonical written policy for residential “prime magnets” (closed allowlist + distance + persistence + market overrides).
- **Runtime-executed**: no.
- **Currently source of truth**: yes, indirectly — it is referenced by the runtime implementation in `src/lib/location/residential-prime-magnets.ts`.
- **Conflicts / duplication**:
  - The canonical doc describes far more magnet families than the current runtime engine can represent (e.g., ports, beaches, parks, resorts, hotel clusters, etc.).
  - Doc taxonomy uses canonical categories (e.g. `metro_hub`, `industrial_zone`) that do not map 1:1 to current runtime `categoryId`s.
- **Recommended future role**: remain the *human contract*; the executable registry must be the normative source, and this doc must reference registry keys and invariants (not define new ones).

### `docs/location-validation/location-signal-taxonomy-contract.md`
- **Role**: written contract for RU public-copy safety; defines signal taxonomy levels/domains and forbidden wording invariants.
- **Runtime-executed**: no.
- **Currently source of truth**: yes, indirectly — the runtime taxonomy implementation in `src/lib/location/signals/location-signal-taxonomy.ts` follows it, and tests enforce it.
- **Conflicts / duplication**:
  - Defines “credible anchor” semantics that overlap with other rule layers (audience scoring, explanation, residential demo rules).
  - The contract is richer than current runtime magnet families and should ultimately reference canonical registry outputs (not re-encode category logic).
- **Recommended future role**: remain the *public-copy safety contract*; enforcement should move to canonical registry outputs + architecture tests.

### Other related docs (documentation-only)
- `docs/residential-regression-gates.md`
  - **Role**: regression gate contract for `buildResidentialAnalysis` (strategy/confidence/ops suitability), not magnet classification itself.
  - **Runtime-executed**: no.
  - **Recommended future role**: unchanged; may reference canonical magnet outputs where relevant.

### Backend canon (not accessible from this workspace)
- **Expected paths** (per task statement): `C:\ASI\backend\docs\canon\...`, `C:\ASI\backend\docs\...`
- **Observed**: not present / not accessible from current workspace scan.
- **Impact**: this inventory is limited to `asi-landing` sources of truth. If backend canon exists elsewhere, it must be reconciled into the single executable registry added in this repo.

## Runtime-executed sources of truth (code)

## Canonical JSON → Generated Runtime Registry (current contract)
- **Source of truth (human-editable)**: `src/lib/location/canonical/magnet-canon.json`
- **Generated runtime code (do not edit)**: `src/lib/location/canonical/generated-magnet-registry.ts`
- **Facade (deprecated handwritten registry; stable import path)**: `src/lib/location/canonical/magnet-registry.ts`
  - Must remain a thin re-export layer; no manual magnet definitions are allowed here.

### Classification: raw OSM/Overpass → internal category/subType
#### `src/lib/location/overpass-classify.ts`
- **Role**: compatibility bridge that attaches canonical mapping results and maps to legacy gravity categories.
- **Runtime-executed**: yes (via `gravity-scoring.ts` → `buildAnalysis`).
- **Currently source of truth**: **no** — raw interpretation must live in the canonical mapping layer.
- **Conflicts / duplicated logic**: should not contain tier/prime/scoring decisions.
- **Recommended role**: keep minimal bridging only; do not inspect raw tags for semantics beyond handing them to the mapping layer.

#### `src/lib/location/canonical/overpass-to-canonical.ts`
- **Role**: **the single sanctioned mapping layer** from raw Overpass/OSM POI tags/name/category hints into canonical magnet candidates.
- **Runtime-executed**: yes (via `overpass-classify.ts` → `gravity-scoring.ts`).
- **Source of truth**: yes, for raw input interpretation and strict unknown handling.

### Category weights / strength classes / radii / caps
#### `src/lib/location/config.ts`
- **Role**: defines `MAGNET_CATEGORIES` including weight, permanence, scopeLevel, strengthClass; and `CATEGORY_RADIUS`, `CATEGORY_MAX_SHOW`.
- **Runtime-executed**: yes (used by `gravity-scoring.ts`).
- **Currently source of truth**: **yes** for:
  - scoring weights by category
  - how many items per category are included in scoring
  - fetch radius per category
  - “strengthClass” defaults per category
- **Conflicts / duplicated logic**:
  - “Strength class” is used as a proxy for “destination magnet” (`gravity-scoring.ts`) but it is not canonical taxonomy.
  - Category list is small vs the required magnet families list in the task; also mixes business factories with office districts under one `business` category.
- **Recommended future role**: low-level scoring configuration *consuming canonical registry outputs* (or moved into registry where it is truly magnet truth).

### Safe data-driven tuning (new scaffold)
#### `src/lib/location/canonical/magnet-tuning.ts`
- **Role**: safe tuning layer that can only adjust bounded numeric multipliers for score contribution.
- **Runtime-executed**: yes (importable), but must not bypass canonical identity/tier caps/eligibility/anti-signals.

### Gravity scoring and magnet selection
#### `src/lib/location/gravity-scoring.ts`
- **Role**: computes magnet attraction scores, evergreen index, cluster bonuses; builds `LocationAnalysis`; calls audience analysis + conclusion generator; selects “main magnets”.
- **Runtime-executed**: yes.
- **Currently source of truth**: **partially** for:
  - “destination magnet” definition (currently: `strengthClass === 'strong'|'medium'`)
  - special-case business weight adjustments (`effectiveBusinessWeight`)
  - “main magnets” selection logic and demand-type inference
- **Conflicts / duplicated logic**:
  - Hardcodes domain mixes and inference (transport/business/tourism shares) by raw `categoryId`.
  - Provides selection heuristics that can function as bypasses if they treat `attraction` as inherently “strong”.
- **Recommended future role**: should consume canonical magnet classification (type/strength/audience eligibility) instead of making domain decisions from `categoryId` directly.

### Taxonomy / credibility / must-surface contract
#### `src/lib/location/signals/location-signal-taxonomy.ts`
- **Role**: strict taxonomy for magnets: credibility levels, domains, public-claim strength, must-surface radii, and weak/local downgrades.
- **Runtime-executed**: yes (used by `audience-scoring.ts`, `explanation.ts`, and `rules/residential-location-rules.ts`).
- **Currently source of truth**: **yes** — it decides:
  - whether a POI is a credible domain anchor
  - whether it can unlock BUSINESS audience framing
  - which anchors must be surfaced in public copy
  - weak/local downgrades (corporate museums, weak offices, mini-markets)
- **Conflicts / duplicated logic**:
  - Contains name/subType regex logic that overlaps with other layers (e.g. `residential-location-rules.ts` has its own attraction regexes and business name regex).
  - Encodes must-surface radii separate from `CATEGORY_RADIUS` in `config.ts`.
- **Recommended future role**: remains a consumer/adapter over canonical outputs. Magnet truth is now defined in `magnet-canon.json` and emitted into `generated-magnet-registry.ts`.

### Audience scoring / audience eligibility
#### `src/lib/location/audience-scoring.ts`
- **Role**: selects primary audience (BUSINESS vs TOURIST fallback), computes audience fit score and driver label.
- **Runtime-executed**: yes.
- **Currently source of truth**: **partially** — it contains:
  - explicit tourist category set
  - business subType weighting (`factory/industrial/office/bank`)
  - selection and filtering logic that should be derived from canonical classification
- **Conflicts / duplicated logic**:
  - Re-encodes “what counts as business/tourist magnet” via category sets + taxonomy calls.
  - Includes business subtype multipliers that should live in canonical magnet registry scoring caps/weights.
- **Recommended future role**: consume canonical registry outputs (audience eligibility + strength + caps) and avoid raw `categoryId` logic.

### Residential prime magnets (UI surfacing allowlist)
#### `src/lib/location/residential-prime-magnets.ts`
- **Role**: executable implementation of the closed allowlist policy for residential prime magnets (distance + persistence + exclusions + RU/INTERNATIONAL mode).
- **Runtime-executed**: yes (used by standalone report and residential rules).
- **Currently source of truth**: **yes** for residential prime magnet surfacing (category allowlist and labels).
- **Conflicts / duplicated logic**:
  - Works on current simplified `categoryId`s (`attraction`, `business`, `shopping_major`…), not on richer canonical families requested (museum/theater/park/beach/etc.).
  - Has its own labels and anchor-type classification overlapping with the desired canonical registry.
- **Recommended future role**: become a **consumer** of canonical registry results; it should only implement ranking/surfacing rules, not define what a magnet *is*.

### Residential demo tiering / “Tier‑1” detection and caps
#### `src/lib/location/rules/residential-location-rules.ts`
- **Role**: RU residential demo presentation-only sanity rules: Tier‑1 detection, caps/floors, audience override.
- **Runtime-executed**: yes (used by residential demo path + tests).
- **Currently source of truth**: **yes**, and it currently contains a known bypass risk:
  - `MAJOR_TOURIST_ATTRACTION_NAME_RE` includes `музей|театр|...|major attraction` and can promote an `attraction` to Tier‑1 by name pattern.
  - `STRONG_BUSINESS_NAME_RE` includes `industrial|factory|завод` etc.
- **Conflicts / duplicated logic**:
  - Duplicates taxonomy logic already present in `signals/location-signal-taxonomy.ts`.
  - Introduces a raw-name promotion path (even if partially gated) instead of canonical registry gates.
- **Recommended future role**: should **only consume canonical classification output** (canonical magnet type + anchor strength + eligibility) and must not contain independent Tier‑1 promotions by regex.

### Explanation / wording / labels
#### `src/lib/location/explanation.ts`
- **Role**: generates conclusion text; contains per-category reason lines and driver-picking logic for public copy.
- **Runtime-executed**: yes.
- **Currently source of truth**: **yes** for:
  - user-facing explanation labels per category
  - reason strings for categories/subtypes
  - driver selection ordering
- **Conflicts / duplicated logic**:
  - Maintains its own category → explanation mapping (`MAGNET_REASON_RU/EN`), which will diverge from canonical registry unless unified.
  - Some text rules (e.g. industrial zone wording) are embedded here instead of a canonical registry-provided public label.
- **Recommended future role**: consume canonical registry public labels/reason templates; explanation should be formatting + composition only.

### Standalone report → UI fields
#### `src/lib/location/standalone-report.ts`
- **Role**: shapes `LocationStandaloneReport` sections used by UI; pulls in residential prime magnets; builds business-fit section.
- **Runtime-executed**: yes.
- **Currently source of truth**: **partially** — it chooses:
  - what is shown as “primary/secondary magnets” in the report via `filterResidentialPrimeMagnets`
  - which labels land in UI (`category_label_ru`, `anchor_label_ru`)
- **Conflicts / duplicated logic**:
  - Uses `residential-prime-magnets.ts` labels which are currently not backed by a single canonical registry.
- **Recommended future role**: remain a report shaper, but must only expose canonical public labels from registry outputs.

### UI magnet display
#### `src/components/location/LocationStandaloneFullReport.tsx`
- **Role**: renders the report sections, including magnet rows and “anchor type badges”.
- **Runtime-executed**: yes (client component).
- **Currently source of truth**: **no** for magnet truth, but it *implicitly* assumes the report provides:
  - `category_label_ru` and `anchor_type` in a stable schema.
- **Conflicts / duplicated logic**:
  - None substantial; currently it displays labels it receives.
- **Recommended future role**: UI should remain a pure consumer of canonical public labels (no inference from raw OSM categories).

### Other (related but not magnet truth)
- `src/lib/location/location-score.ts`: constructs composite `location_score` and factor text; currently includes some business driver phrasing that should come from canonical classification (avoid ad-hoc regexes like `BANK_INSURANCE_NAME_RE`).
- `src/lib/location/scoring.ts`: deterministic demo scoring from address hash (separate from the real location engine). Not a magnet source of truth.
- `src/lib/location/residential-analysis.ts`: residential strategy/confidence/ops suitability. Uses environment + score breakdown, not magnet classification.

## Tests and fixtures (runtime-executed)
### Taxonomy contract tests
- `src/lib/location/signals/__tests__/location-signal-taxonomy.test.ts`
  - **Role**: unit tests for taxonomy rules (weak/credible classifiers, forbidden wording).
  - **Currently source of truth**: enforces taxonomy behavior and must remain aligned with canonical registry.

### Integration tests: taxonomy → audience + explanation
- `src/lib/location/__tests__/location-taxonomy-integration.test.ts`
  - **Role**: asserts weak/local POIs cannot become strong drivers; must-surface anchors appear in copy.
  - **Recommended future role**: updated to ensure copy uses canonical registry outputs end-to-end.

### Residential demo matrices (golden + calibration)
- `src/lib/location/__tests__/ru-residential-golden-matrix.test.ts`
- `src/lib/location/tests/ru-residential-calibration-matrix.test.ts`
  - **Role**: baseline matrices for RU residential “demo sanity” rules.
  - **Source of truth**: defines expected behavior and regression constraints.
  - **Recommended future role**: extend to cover canonical magnet families once registry exists.

### Mapping tests
- `src/lib/location/__tests__/transport-anchor-mapping.test.ts`
  - **Role**: tests OSM tag mapping for transport anchors.
  - **Recommended future role**: should validate raw mapping stays raw, and canonical classification decides final canonical magnet type.

## Current conflicts / bypasses (summary)
1. **Raw-name Tier‑1 promotion risk**: `rules/residential-location-rules.ts` contains `MAJOR_TOURIST_ATTRACTION_NAME_RE` (`музей|театр|...`) that can promote an attraction to Tier‑1 by name pattern. This is explicitly forbidden by the task; museums/theaters must not become Tier‑1 residential anchors by name/category alone.
2. **Parallel label truth**: explanation labels live in `explanation.ts`, residential prime magnet labels live in `residential-prime-magnets.ts`, and taxonomy carries its own “public claim strength” semantics.
3. **Distance/radius duplication**: `config.ts` radii and `signals/location-signal-taxonomy.ts` must-surface radii are separate.
4. **Category set limitations**: current runtime `categoryId` set is too coarse for the required magnet families (museum vs theater vs park vs beach vs port, etc.), enabling future shortcuts.

## Recommended future architecture (high level)
- Introduce **one executable canonical magnet registry** inside `asi-landing` that owns:
  - canonical magnet type and families
  - aliases/raw-category hints and allowed taxonomy mappings
  - audience eligibility, strength, distance bands, score caps
  - public labels + explanation labels
  - downgrade / anti-signal rules
- All other files may **consume** canonical classification outputs, but must not define promotions or labels by raw regex/category directly.

