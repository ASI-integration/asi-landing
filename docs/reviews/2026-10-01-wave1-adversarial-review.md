# Wave 1 independent adversarial verification — WAVE 1 BLOCK
Reviewed HEAD: 40388aaa2fb48c4f2b124d53c221ca56e2614f0b
Range: 3a5ac390c2dc04ebf82815b813238044ec80515f..40388aaa2fb48c4f2b124d53c221ca56e2614f0b
Implementation: 24518c07ae6bfec3039d9b959a103bddca96478f
Branch: astra/wave1-commercial-location-20261001

## P1 — mutable identity bypasses the post-await ownership check
Source: src/lib/location/spatial-validation.ts:135-149.
The runner passes original mutable request/location objects to dependencies, and compares latest to the same original object only after the await. It captures no immutable initial scope/snapshot.
Repro: request.scope, resolved location.scope and evidence.scope share one object (also a pattern used by existing fixtures). During loadEvidence, the account of that canonical object changes A -> B in place. Final resolver returns the same cached object.
Actual: scope.accountId=B, ok=true, automated=true; the validation started for A.
A replacement-object ownership change is correctly rejected; this failure specifically requires shared mutable references. No remotely exploitable HTTP path is claimed.
Smallest repair: snapshot the requested identity before any dependency await and the initial resolved identity before evidence loading; pass isolated snapshots and compare final ownership against the original requested identity.

## P1 — malformed provider facts become valid evidence and paid report success
Sources: src/lib/location/spatial-validation-osm.ts:18-31; spatial-validation.ts:95-110; location-report-engine.ts:379-418.
Repro A: Overpass element has valid nearby coordinates and railway=subway_entrance, but no id. The adapter manufactures id=node/undefined and external/live reference https://www.openstreetmap.org/node/undefined.
Actual: validation.ok=true; both residential and commercial ensurePaidLocationReportForRequest resolve successfully, invoke createStandaloneReport once and linkLocationReportRequestReport once.
Production parsing at overpass.ts:496-503 uses a TypeScript cast, not runtime identity validation, so there is no earlier guard that makes this fixture unreachable.
Repro B: shared validator receives its only entity with kind=not-a-spatial-kind; actual ok=true, automated=true, counts include that invalid kind. Entity-kind membership is never checked.
Smallest repair: validate raw provider type/id and canonical entity enums/shape before constructing provenance or counting evidence; reject malformed required evidence before paid persistence. Preserve manual/partial coverage as explicit states.

## Reproduction and verification
New test: src/lib/location/__tests__/wave1-independent-adversarial.test.ts.
Command: node node_modules/vitest/vitest.mjs run src/lib/location/__tests__/wave1-independent-adversarial.test.ts
Result: 15 tests; 10 PASS / 5 FAIL. Failures: shared identity mutation, unknown kind, fabricated OSM id, paid residential persistence, paid commercial persistence.
Existing Wave 1 and RU location suites: 6 files / 88 PASS.
Frozen first-pilot regression: 11 files / 124 PASS.
Total executed: 227 tests; 222 PASS / 5 FAIL. Typecheck PASS; ESLint on new test PASS; baseline-to-HEAD diff-check PASS.

## Scope and remaining boundaries
No runtime code, scoring weights or first-pilot semantics changed. Added only local repro test and this review; no new commit. HEAD unchanged.
Manual address/point confirmation, incomplete competitor surveys and physical footfall verification remain acceptable manual boundaries; they are not findings here.
Accessibility graphs, measured pedestrian flow and richer commercial datasets remain future work.
Production/staging, live databases, external providers, messages, payments, secrets and DNS untouched. No push, merge or deploy. Test persistence is mocked; no real reports were written.

