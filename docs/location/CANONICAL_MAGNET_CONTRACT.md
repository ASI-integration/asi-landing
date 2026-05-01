# Canonical magnet contract (single executable source of truth)

## Purpose
This repository must have **one executable source of truth** for residential location magnets.  
Any code that influences scoring, explanations, or UI magnet display must **consume canonical output** and must not promote magnets by raw name/category shortcuts.

## Single source of truth
### Canonical JSON → Generated Runtime Registry
- **Human-editable canon (ONLY editable source of truth)**: `src/lib/location/canonical/magnet-canon.json`
  - Defines canonical magnet types, labels, aliases, raw category mapping, eligibility, caps, and anti-signals.
- **Generated runtime registry (DO NOT EDIT)**: `src/lib/location/canonical/generated-magnet-registry.ts`
  - Auto-generated from the JSON canon.
  - Exposes runtime exports used by the app/tests (registry + helper getters).
- **Stable public facade (import from here)**: `src/lib/location/canonical/magnet-registry.ts`
  - Re-exports the generated runtime registry and classifier.
  - Exists to keep import paths stable while canon evolves.

The mandatory classifier remains: `classifyCanonicalMagnet({ magnet })` (exported via the facade).

Everything else is either:
- **raw mapping** (OSM/Overpass → raw POI fields), or
- **consumer logic** that formats/aggregates canonical outputs.

## Mandatory pipeline (enforced)
**raw POI**
→ **canonical magnet registry** (`classifyCanonicalMagnet`)
→ **taxonomy classification** (registry-backed adapter: `signals/location-signal-taxonomy.ts`)
→ **anchor strength + tier caps** (from canonical output)
→ **distance band** (from canonical output)
→ **audience eligibility** (from canonical output)
→ **score contribution / caps** (consumer uses canonical caps)
→ **explanation generator** (uses canonical labels/reasons)
→ **UI display** (renders canonical public labels, never raw assumptions)

## Allowed vs forbidden rule ownership
### Allowed to define rules
Only `src/lib/location/canonical/magnet-canon.json` may define magnet truth:
- canonical magnet family/type
- aliasing / raw category hints
- anti-signals / downgrades (e.g. corporate museums)
- audience eligibility (business/tourist/family/medical/student/industrialWorker/corporate)
- anchor strength (tier1/tier2/weak/noise/negative)
- residential tier caps
- public labels (RU/EN) and claim strength
- must-surface radii (where applicable)

### Allowed to consume canonical outputs
These files **must not invent magnet truth** and may only consume canonical outputs:
- `src/lib/location/audience-scoring.ts`
- `src/lib/location/explanation.ts`
- `src/lib/location/residential-prime-magnets.ts`
- `src/lib/location/rules/residential-location-rules.ts`
- UI: `src/components/location/*`
- tests under `src/lib/location/**`

### Forbidden
The following are forbidden outside the canonical registry:
- Any rule like **“museum/theater/tourist attraction = Tier‑1”** based on raw name/category/regex
- Any rule like **“factory/industrial = business anchor”** without canonical classification
- Any direct mapping from raw Overpass/OSM category to public label (UI copy must come from canonical labels)

Concrete examples of forbidden patterns:
- `if (name.match(/музей|театр/)) tier = 1`
- `if (categoryId === 'attraction') tier = 1`
- `if (subType === 'industrial') primaryAudience = BUSINESS`

## Non-negotiable invariants
- **Museums, theaters, and generic tourist attractions must not automatically become Tier‑1 residential anchors** by raw name/category alone.
- **Weak local amenities** must never appear as prime residential magnets.
- **Business/corporate scoring** must be driven by canonical audience eligibility, not ad-hoc category matching.

## How to add a new magnet type safely
1. Add a new entry to `src/lib/location/canonical/magnet-canon.json`.
2. Define (in JSON):
   - aliases/raw-category ids/subtypes (if any)
- audiences (business/tourist/family/medical/student/industrialWorker/corporate)
   - tier caps and default strength
   - public labels and anti-signals
3. Run `npm run generate:magnet-registry` to regenerate runtime code.
4. Add matrix expectations in:
   - `src/lib/location/__tests__/canonical-magnet-matrix.test.ts`
5. If any consumer logic needs changes, update it to read canonical output (not raw category).

## How tests prevent bypasses
- **Architecture test**: `src/lib/location/__tests__/canonical-magnet-architecture.test.ts`
  - Fails if raw regex/category promotions reappear in scoring/explanation/rules/UI.
- **Matrix test**: `src/lib/location/__tests__/canonical-magnet-matrix.test.ts`
  - Ensures required magnet families exist and key invariants hold (e.g. museums/theaters not Tier‑1).

