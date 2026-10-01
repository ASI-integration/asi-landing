# Wave 1 — canonical location validation
Baseline: 3a5ac390c2dc04ebf82815b813238044ec80515f. Local branch: astra/wave1-commercial-location-20261001.

## Architecture discovered before changes
- Public coordinate preview: api/location-demo-analyze -> fetchOsmData -> buildAnalysis -> integrity gate -> residential/commercial projections.
- Paid pipeline: location-report-engine -> address providers / coordinate cache -> Overpass -> standalone residential/commercial reports.
- Existing spatial-foundation.ts already supplies commercial stub barrier/corridor heuristics; no new graph or scoring engine is needed.
- OSMElement, MagnetItem, CompetitorItem and classifyElement already define map facts/categories. Reuse them.
- gravity-scoring exports the existing metre Haversine utility; other modules duplicate it.
- Provider interfaces expose elements and failure/reduced-query flags, but no canonical object/evidence validation result.
- Public coord cache stores map analyses, not account-owned objects. Never put tenant identity or tenant/manual evidence in it.
- Existing report/account access remains separate from public map queries. A public coordinate query cannot prove property ownership.
- Paid geocoding can substitute a city centre; this is display fallback, never authoritative object evidence.
- Market competitor scraping has explicit live/partial/fallback provenance and approximate ADR; not valid spatial evidence or measured commercial demand.
- Address normalization and city sanity, report scope, public scoring and golden corrections remain existing contracts.

## Implementation plan
1. Small canonical identity/evidence/result types; named lat/lon and radiusMeters.
2. One pure validator and dependency-injected account-scoped runner; fail closed before provider on wrong identity.
3. OSM adapter with source IDs, timestamps, partial/unavailable states, category/radius aggregation and explicit commercial coverage.
4. Integrate shared validation in residential/commercial report/preview paths without changing valid residential score weights.
5. Test negative tenancy, provenance, stale/synthetic/failure, radius and both modes; rerun the frozen first-pilot gate.
No schema migration, live data mutation, new package or automatic messaging change.

## Implemented contract
- `spatial-validation-types.ts`: discriminated public/account identity; residential/commercial mode; address/geography; named coordinates; provider/time/reference/origin/delivery provenance; scoped evidence batches; nearby entity kinds.
- `validateSpatialEvidence(request, location, batches, now)` is the single deterministic rule set. `validateLocation(request, dependencies, now)` resolves server-owned identity before loading evidence and re-resolves it after the await.
- Results contain `ok, automated, requiresOperatorReview, scope, location, checks, evidence, nearby, counts, blockers, warnings, manualControls, provenance`. An `ok` manual result is NOT automated approval.
- All distances use the existing Haversine formula extracted unchanged to `geometry.ts`. The legacy export remains compatible. Requested radii are explicitly 1,000–5,000 metres inclusive; aggregation recomputes distance and excludes out-of-radius entities.
- Raw evidence batches retain survey context; only `nearby` and `counts` are the requested-radius aggregation.
- Source age is bounded to 24 hours; missing, future, synthetic or unavailable provenance blocks. Partial coverage requires manual review and cannot prove zero competitors.
- A site assessment requires city/country. An independent address point is compared within 250 m when supplied; otherwise map/address confirmation remains manual.
- Commercial site assessment additionally requires a complete competitor survey and a demand/transit/attraction entity. Physical barriers and actual footfall remain manual. Residential has no competitor-survey requirement.
- This service is not an authentication boundary: accountId must come from server auth, and the injected resolver must verify canonical account/object ownership. No new account-facing HTTP endpoint or database store was introduced.
- Foreign object/evidence is redacted. Dependency failures and ownership changes return no evidence. Account/manual evidence must never enter the existing public coordinate cache.

## Existing consumers and fail-closed changes
- Public `/api/location-demo-analyze` attaches the same validation to both residential and commercial analyses. Standalone v1/v2 reports preserve it.
- Paid report creation uses the validator before persistence; provider failure, absent local evidence or invalid coordinates cannot persist/link a newly successful report.
- Geocode failure no longer substitutes Moscow or a city centre for the requested property. A missing map SDK still does not prevent reading an already calculated report.
- Free reports also carry validation. Legacy cached reports without raw evidence remain explicitly unverified; existing preview scores are not certification and were not retuned.
- The Overpass adapter reuses OSM elements/classification and retains individual OSM references. Existing heterogeneous query radii are conservatively partial, not an exhaustive commercial survey.
- Existing commercial barrier/corridor heuristics remain a stub. No graph, measured footfall, new provider, investment decision or revenue forecast is claimed.
- No migration or dependency installation was needed. Existing report authorization and residential pilot runtime were not changed.

## Remaining boundaries
- Before a private Commercial workflow is activated, wire its canonical database resolver and authenticated entrypoint to this runner; this is not an implemented private CRUD feature.
- Safe manual boundary: verify address point, incomplete coverage, complete category-specific competitor survey and physical access/footfall. OSM-only commercial previews cannot satisfy strict site assessment.
- Future enhancement: provider-specific exhaustive category surveys, graph accessibility and measured footfall. They must retain provenance and declare coverage rather than changing the residential minimum.
- Live provider availability and real database behavior were not tested; all new evidence/side-effect tests use local fixtures and mocks.

## Local verification (2026-10-01)
- Shared validation: 23/23; both-mode report integration: 7/7; paid report fail-closed/map independence: 10/10; existing commercial spatial stub: 6/6.
- Existing RU geocode/city sanity: 26/26; residential golden matrix: 16/16.
- Frozen first-pilot gate: 11 files, 124/124 (owner routes/roles, activation, bootstrap tenancy, core workspace, channel import, commercial pilot route/lifecycle, pre-check-in, access and closeout).
- Total final focused evidence: 17 files, 212 tests passed. This is not full-repository or live-provider acceptance.
- Typecheck, changed-file ESLint and git diff --check passed. No code diff in first-pilot services.
- Owner authorization artifact validates against the repository's exact scope/identity contract. Preflight classifies protected Location work; explicit task authorization permits only this local work and requested test gate.
- No push, merge, deployment, live database/provider calls, messages, payments, secrets access or production/staging changes.
- Scope verdict: COMPLETE for this v1 foundation; not a claim of an automated Commercial decision product. Strict commercial validation still refuses incomplete OSM-only evidence.
