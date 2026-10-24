---
name: asi-task-execution
description: Execute agent-ready tasks in ASI-integration/asi-landing from intake through focused validation, exact-path commit, push, and draft PR. Use for repository code, test, documentation, template, or workflow changes that must follow ASI Agent OS autonomy, testing-budget, protected-area, owner-gate, and blocker rules.
---

# ASI task execution

Execute one task to a verifiable result while preserving product contracts and stopping before red actions.

## Allowed actions

- Read Agent OS contracts and translate an Issue into a task preflight.
- Create a task branch, implement the minimal in-scope patch, and run focused checks.
- Commit exact paths, push the task branch, and open a draft PR for green/yellow work.
- Return a machine-readable result bundle.

## Forbidden actions

- Merge, production write/dispatch, secret-value access, DNS, payments, or real external messages.
- Broad test suites without an explicit red gate.
- Capturing unrelated dirty-tree files or writing under `tmp/`.
- Treating typed confirmation as owner approval.

## Non-terminal blockers and automatic resumption (mandatory)
- The task ends with the **requested verified artifact or milestone**, not a successful preflight or a readiness-only report. Keep one stable task ID, original goal, stage and checkpoint through ordinary failures.
- For every obstacle: (1) classify technical vs authorization vs uncertain side effect, (2) independently verify the root cause, (3) attempt the smallest authorized fix and focused regression, (4) resume the **same** task without asking again. Use existing tools and paths; never introduce dummy work, a duplicate PR or an uncontrolled retry.
- Reuse an existing matching owner grant only if its action, target, SHA, window and unused status are independently verified. Required red actions with no qualifying grant remain stopped. Prepare one exact owner-gate request with all other authorized preparatory steps completed; **continue from the checkpoint once the owner provides it**, without a new intake or duplicate confirmation.
- At a pause report exactly: BLOCKER_CODE, evidence, why unresolvable within admitted scope, work completed, checkpoint, one required owner action (or external dependency), and the next executable step. BLOCKED, AWAITING_OWNER, PARTIAL are **not** product completion.
- Before selecting the next product task, check whether it is genuinely unfinished in the canonical release; prefer the least complex useful in-scope work. Never substitute fixture tests for real acceptance or create extra diagnostics solely to satisfy an E2E badge.
- If an approved operation temporarily weakens a tool setting, preserve prior values, restore and read back after success or failure. Do not bypass platform, owner, signed-claim, incident or tool security boundaries.
- Apply **least friction to legitimate owners/customers, evidence-based strictness to suspicious operations**. Reduce repeated credential entry and false blocks without weakening the underlying security guarantees. Do not infer fraud from unsupported characteristics.

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
