# Production preflight

Agent OS v0 production Skill mode is always `read-only-preflight`.

Required evidence before any owner decision:

- repository `ASI-integration/asi-landing`
- exact requested SHA (40 hex)
- source branch/ref SHA from local git
- requested red action (`production_deploy`, `production_rollback`, `production_migration`, or other owner-gate red action)
- target exactly `production`
- `dispatchAllowed=false`, `mutationAllowed=false`, `secretValuesAllowed=false`

Stop conditions:

- missing or mismatched SHA
- missing owner gate
- typed confirmation without explicit owner authorization
- approval action/target/identity mismatch
- any attempt to enable dispatch or mutation

Machine schema:

- `docs/agent-os/schemas/production-preflight.schema.json`
- `docs/agent-os/schemas/owner-gate.schema.json`

AO-003 production mutation workflows must call
`.github/workflows/production-owner-gate.yml` with an approved
`asi.agent-os.owner-gate.v1` artifact. Inventory and coverage:
`docs/agent-os/production-workflow-inventory.json` and
`scripts/agent-os/check-production-owner-gate-coverage.mjs`.
GitHub Environment reviewers are complementary only.
