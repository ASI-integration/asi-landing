# Change-to-test selection

Canonical map: `docs/agent-os/change-to-test-map.json`.

Apply every matching rule to every changed path. Deduplicate checks; do not replace a more specific check with the default set. Treat `protected=true` as a review/stop hint, not automatic permission. A `redActions` entry overrides a lower Issue classification and classifies the task as red, while execution still requires `docs/agent-os/OWNER_GATE.md`. Every path under `src/lib/location/` is fail-closed to `location_scoring_or_public_contract_change` so scoring, SSOT and public contracts cannot inherit a green/yellow Issue classification.

If no rule matches, use the default checks and select at most two focused test files or about 30 tests. Do not run `npm test` or `test:location-golden` unless root `AGENTS.md` explicitly permits the run.
