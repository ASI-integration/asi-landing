---
name: asi-task-execution
description: Execute agent-ready tasks in ASI-integration/asi-landing from intake through focused validation, exact-path commit, push, and draft PR. Use for repository code, test, documentation, template, or workflow changes that must follow ASI Agent OS autonomy, testing-budget, protected-area, owner-gate, and blocker rules.
---

# ASI task execution

Execute one task to a verifiable result while preserving product contracts and stopping before red actions.

## Workflow

1. Read root `AGENTS.md`, `docs/agent-os/CURRENT_RELEASE.md`, `WORKFLOW.md`, `PRODUCT_CONTRACT.md`, `AUTONOMY_POLICY.md`, `DEFINITION_OF_DONE.md`, and `BLOCKERS.md`.
2. Translate the Issue into `task`, scope, acceptance criteria, classification, red actions, and explicit side-effect boundaries.
3. Read [references/change-to-test-map.md](references/change-to-test-map.md), then prepare a task input JSON and run `scripts/preflight.mjs --task <path> --base <ref>` from the repository root.
4. Stop with `AWAITING_OWNER` when classification is red or target/identity/scope cannot be proven. A typed confirmation is never owner approval.
5. Create a task branch from the recorded baseline. Preserve unrelated tracked and untracked files.
6. Trace the existing seam, implement the smallest patch, and do not create a parallel flow.
7. Run only the checks selected by the change map within the `AGENTS.md` budget. Never run a broad suite without its red gate.
8. Review `git diff --check`, exact `origin/<base>...HEAD` scope, staged paths, and final status.
9. For green/yellow scope, commit exact paths, push the task branch, and create a draft PR. Never merge.
10. Return the fields in [references/result-contract.md](references/result-contract.md).

## Mandatory stop conditions

- Any requested merge, production write/dispatch, secret-value access, DNS, payment, real external message/provider call, approved UX/public-copy change, protected location contract change, repository/environment setting change, or broad test suite lacks a matching explicit owner artifact.
- Staging identity, isolation, fixture ownership, external-action disablement, or cleanup cannot be proven.
- Diff contains `tmp/`, unrelated package changes, unrelated user files, or paths outside the accepted scope.
- Product contracts conflict or exact record/task identity is ambiguous.

## Resources

- `scripts/preflight.mjs` emits a machine-readable preflight without network or external side effects.
- `references/change-to-test-map.md` explains how to consume the canonical mapping.
- `references/result-contract.md` defines the final machine-readable bundle.
