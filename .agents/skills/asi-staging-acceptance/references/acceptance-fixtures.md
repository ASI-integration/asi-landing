# Acceptance fixtures

Every staging acceptance run requires an isolated fixture conforming to `asi.agent-os.staging-fixture.v1`.

Required properties:

- `fixtureId` starts with `asi-fixture-`
- `environment` is exactly `staging`
- `isolated` is `true`
- `ownership.namespace` starts with `asi_fixture_`
- `cleanup.required` and `cleanup.verifyZeroResidue` are `true`
- `safety.noExternalActions=true`
- `safety.productionCredentials=false`
- `safety.payments=false`
- `safety.realMessages=false`

Safe baseline fixture:

- `docs/agent-os/fixtures/isolated-staging-fixture.json`

Cleanup rule:

- Delete only records carrying the exact fixture namespace.
- Report residue count; non-zero residue fails the Skill.
- Never cleanup production or unnamed data.
