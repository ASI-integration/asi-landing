---
name: asi-staging-acceptance
description: Prepare and run isolated ASI staging deployment and acceptance with exact SHA, database identity, safety flags, deterministic fixtures, cleanup, and rollback evidence. Use only for staging verification after local checks pass; never use production credentials, real outbound messages, payments, or production targets.
---

# ASI staging acceptance

Prepare staging verification from contract fixtures only. This skill never applies migrations, never SSHs, never mutates remote staging, and never touches production.

## Allowed actions

- Validate isolated staging fixture artifacts against Agent OS schemas.
- Prove staging identity claims from non-secret identifiers (project ref shape, path, port).
- Emit machine-readable preflight/result JSON with `noExternalActions=true`.
- Run local fixture-based forward checks only.

## Forbidden actions

- SSH, deploy, rollback, or schema smoke against a live staging host.
- Apply or push database migrations.
- Use production credentials, payments, real messages, or secret values.
- Proceed when isolation, fixture ownership, cleanup, or identity cannot be proven.
- Treat typed confirmation as owner approval.

## Workflow

1. Read `AGENTS.md`, `docs/agent-os/AUTONOMY_POLICY.md`, `OWNER_GATE.md`, `BLOCKERS.md`, and [references/staging-contract.md](references/staging-contract.md).
2. Confirm AO-002/AO-005/AO-008 temporary rules still apply: stop on unproven identity/isolation.
3. Load a fixture from [references/acceptance-fixtures.md](references/acceptance-fixtures.md) or an equivalent isolated fixture JSON.
4. Run `scripts/staging-preflight.mjs --fixture <path> --identity <path>` from the repository root.
5. Stop immediately on identity mismatch, missing safety flags, or non-isolated fixtures.
6. If preflight status is `READY`, build the local result with `scripts/staging-result.mjs --fixture <path> --preflight <path>`.
7. Return the JSON result; do not execute remote acceptance.

## Mandatory stop conditions

- Project ref, app path, or port does not match the staging contract.
- Fixture is not isolated, lacks ownership namespace, or omits zero-residue cleanup.
- Any safety flag allows external actions, production credentials, payments, or real messages.
- Requested action would mutate staging data or dispatch a staging workflow.

## Resources

- `scripts/staging-preflight.mjs` — local, network-free staging preflight.
- `scripts/staging-result.mjs` — local acceptance result with cleanup evidence.
- `references/staging-contract.md` — fixed staging targets and invariants.
- `references/acceptance-fixtures.md` — fixture ownership and cleanup rules.
