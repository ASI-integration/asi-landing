# Wave 5 — RU residential location runtime

Branch: `sol/wave5-residential-location-runtime-20261003`
Starting HEAD: `520eb93731e294162882f3f4439d54bcae892965`
Scope: canonical property-bound residential location evidence and advisory PlatformDecision reads.

## Implemented

- Added a dedicated server-owned `residential_property_spatial_snapshots` contract keyed by canonical `account_id + property_id`.
- Public address caches and location-report snapshots are not reused as canonical property truth.
- Added a pure read seam for persisted property SpatialValidation snapshots.
- Spatial snapshot freshness uses Wave 1's 24-hour evidence window rather than the generic 60-second operational window.
- Added authenticated Booking Ops location GET:
  - resolves booking account/property ownership before the read;
  - reads only the persisted property snapshot;
  - rechecks booking identity after the read;
  - returns an advisory residential `location` PlatformDecision.
- Added ops-admin-only location refresh:
  - reads the canonical property address from `properties`;
  - geocodes through the existing RU address pipeline;
  - fetches existing OSM spatial evidence;
  - validates through the existing Wave 1 spatial validator;
  - rereads canonical property location after provider awaits;
  - refuses to persist if ownership/address state changed;
  - persists only account/property-scoped SpatialValidation.
- Provider refresh forces `bypassMemoryCache: true`; process-local OSM cache entries without original observation timestamps cannot be relabeled as fresh evidence.
- Existing public/demo location routes were not modified into property-scoped truth sources.
- Existing PlatformDecision execution semantics remain advisory-only:
  `automaticActionAllowed=false`, `executionAuthority=domain_revalidation_required`.
- Hardened a legacy migration-order test so it no longer assumes a September migration must remain the newest migration forever.

## Files

- `supabase/migrations/20261003093000_residential_property_spatial_snapshots_v1.sql`
- `src/lib/location/residential-property-spatial-runtime.ts`
- `src/app/api/dashboard/booking-ops/[id]/location/route.ts`
- `src/lib/location/overpass.ts`
- `src/lib/platform/snapshot.ts`
- `src/lib/platform/location-decision.ts`
- `src/lib/location/__tests__/residential-property-spatial-runtime.test.ts`
- `src/lib/location/__tests__/residential-property-spatial-migration.test.ts`
- `src/app/api/dashboard/booking-ops/__tests__/location-platform-route.test.ts`
- `src/lib/platform/__tests__/adapters.test.ts`
- `src/lib/communication/__tests__/guest-long-term-memory-v1.test.ts`

## Verification

- Wave 5 focused contour: **168/168 PASS**.
- TypeScript typecheck: **PASS**.
- Changed-file ESLint: **PASS**.
- `git diff --check`: **PASS**.
- Frozen regression contours:
  - focused: **165/165 PASS**
  - pilot: **137/137 PASS**
  - location: **110/110 PASS**
  - Wave 2: **220/220 PASS**
  - safety: **87/87 PASS**
  - additional: **12/12 PASS**

## Operational boundary

The migration file is prepared and contract-tested but was **not applied to any live/local database** in this pass. No push, merge, deploy, live database mutation, DNS, secret, or package-install action was performed.
