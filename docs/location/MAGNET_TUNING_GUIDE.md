# Magnet tuning guide (safe scaffold)

This document describes how **magnet tuning** may be added later using real-world outcome data, without ever bypassing the canonical magnet contract.

## What real data can be used later

Examples of metrics that can inform tuning profiles (per market / season / format):

- booking conversion
- ADR (average daily rate)
- RevPAR
- occupancy
- lead quality
- cancellation rate
- guest segment mix (business vs tourist vs family)

## What tuning is allowed to change

Tuning is intentionally limited to **small bounded numeric multipliers** that adjust *how much* a magnet contributes, not *what it is*.

Allowed examples (see `src/lib/location/canonical/magnet-tuning.ts`):

- `distanceDecayMultiplier`
- `audienceFitMultiplier`
- `seasonalityMultiplier`
- `localDemandMultiplier`
- `confidencePenaltyMultiplier`

## What tuning is forbidden to change

Tuning must never:

- change `canonicalType` / magnet identity
- change `maxResidentialTier` / tier caps
- allow Tier‑1 credit if canon forbids it (e.g. museum/theater/generic attraction)
- make `weak_amenity` / `tertiary_local_amenity` prime-eligible
- override `audienceEligibility`
- override or remove `antiSignals`
- remove penalties for unknown/ambiguous mappings

Examples of **disallowed** knobs:

- `forceTier`
- `forcePrime`
- `overrideCanonicalType`
- `overrideAudienceEligibility`

## How to add a new tuning profile safely

1. Start from `defaultTuningProfile`.
2. Only set allowed multipliers.
3. Run validation (`validateTuningProfile`) to clamp values into safe bounds.
4. Add tests proving the profile:
   - cannot promote capped families to Tier‑1 credit
   - cannot make weak amenities prime
   - cannot change canonical identity or audience eligibility
   - cannot bypass anti-signals

## Why tuning must never bypass canon

Canonical rules exist to prevent dangerous failure modes:

- raw POI name/category quirks promoting weak/ambiguous objects into Tier‑1
- museums/theaters/generic attractions becoming “prime” without explicit context
- factories/plants accidentally becoming tourist/cultural or generic business anchors

Tuning is for **controlled calibration** only. Canon is the safety boundary.

