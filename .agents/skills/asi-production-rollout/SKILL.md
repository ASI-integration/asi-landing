---
name: asi-production-rollout
description: Prepare owner-gated ASI production rollout, migration, reconciliation, rollback, or verification runbooks with exact target and SHA evidence. Use for production operations only after explicit Nikolay approval; default to preflight and stop before every deploy, DDL, data mutation, secret, DNS, payment, or real-message action.
---

# ASI production rollout

Default to read-only production preflight. This skill never dispatches workflows, never mutates production, and never reads secret values.

## Allowed actions

- Build and validate `asi.agent-os.production-preflight.v1` artifacts.
- Compare requested vs source SHA locally via git.
- Validate owner-gate completeness without secret values.
- Emit `AWAITING_OWNER` or `BLOCKED` stop results.

## Forbidden actions

- Workflow dispatch, deploy, rollback, migration apply, or data mutation.
- Reading or printing secret values.
- DNS, payment, or real-message actions.
- Reusing one approval for a different red action.
- Treating typed confirmation as owner approval.

## Workflow

1. Read `AGENTS.md`, `docs/agent-os/OWNER_GATE.md`, `AUTONOMY_POLICY.md`, `BLOCKERS.md`, and [references/production-preflight.md](references/production-preflight.md).
2. Collect requested action, target, and exact SHA into a preflight input JSON.
3. Run `scripts/verify-release-identity.mjs --requested <sha> --source <ref>` from the repository root.
4. If an owner-gate artifact exists, run `scripts/red-approval-check.mjs --gate <path> --expected <path>`.
5. Without a valid approved gate matching the exact action/target/identity, return `AWAITING_OWNER` and stop.
6. Never implement or trigger a write path from this Skill in Agent OS v0.

## Mandatory stop conditions

- Any requested production write/dispatch lacks an approved owner gate for that exact action.
- Requested SHA and source SHA mismatch.
- Gate action does not equal the requested action (deploy approval never authorizes migration).
- Secret values appear in the gate or preflight inputs.
- Target is ambiguous or not exactly `production`.

## Resources

- `scripts/verify-release-identity.mjs` — local SHA identity comparison.
- `scripts/red-approval-check.mjs` — owner-gate completeness check without secret values.
- `references/production-preflight.md` — required evidence and stop rules.
- `references/rollout-report.md` — result shape for preflight-only runs.
