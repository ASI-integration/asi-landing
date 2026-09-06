# ASI automated task pipeline

Operator overview of the verified flow from signed package intake through Cursor execution and structural verification. This document describes staging automation only. It does not authorize merge, production deploy, migrations, or other red actions.

## Flow

1. A signed task package lands in the Bridge incoming queue (`manifest.json` + `runtime-envelope.json`, with `signingKeyId`, payload hashes, machine and environment bindings, and expiry).
2. Bridge verifies the package, writes an ingest receipt (`ACCEPTED` or `REJECTED`), and on accept hands a durable runtime envelope to Runtime.
3. Runtime validates Agent OS intake, creates a disposable worktree at the declared baseline SHA, prepares dependencies, and launches the selected implementer (Cursor).
4. Cursor executes exactly one task inside that worktree, limited to `task.inScope` paths and Agent OS autonomy rules.
5. An independent structural verifier inspects the resulting diff and acceptance criteria. Implementer self-reports are not trusted evidence.
6. Runtime records a terminal confirmation status for the operator.

## Responsibilities

| Role | Responsibility |
| --- | --- |
| **Bridge** | Discover signed packages; check identity, environment, signature/fingerprint, hashes, and expiry; reject invalid packages with a reason code; accept valid ones idempotently and submit them to Runtime. |
| **Runtime** | Own workspace lifecycle, baseline binding, preflight, provider launch, audit events, and final confirmation. Enforce network/side-effect policy for the attempt. Hand off verification to an independent verifier after implementation. |
| **Cursor** | Implement the smallest in-scope change that meets acceptance criteria. Follow `AGENTS.md` and the repository `asi-task-execution` Skill. Stop on red actions, blockers, ambiguity, failed required checks, or kill requests. |
| **Verifier** (`runtime-structural-verifier`) | Read-only structural check of changed files against acceptance criteria and scope. Compare baseline vs head, produce a verdict and findings, and ignore untrusted implementer narrative. |

## Outcomes

### Successful

- Bridge ingest status `ACCEPTED`.
- Cursor completes within scope without an open blocker.
- Verifier verdict `VERIFIED` or `VERIFIED_WITH_WARNINGS` (warnings still require operator review when noted).
- Runtime confirmation such as `COMPLETED_AND_VERIFIED` / `COMPLETED_AND_VERIFIED_WITH_WARNINGS`.

### Action required

Operator or owner action is required when any of the following occur:

- Bridge `REJECTED` (invalid envelope, binding mismatch, expired package, or similar reason code).
- Cursor stops with a blocker, red gate, or `AWAITING_OWNER` / owner-decision request.
- Verifier fails acceptance or scope checks, or returns findings that need remediation.
- Runtime marks the attempt failed (for example execution failure) without a verified completion.

Do not treat a typed confirmation or implementer summary as owner approval.

## Safety boundaries

The automated flow must stay inside these limits unless a separate explicit owner gate says otherwise:

- Work only in the disposable Runtime worktree and only on `task.inScope` paths.
- Do not merge, push, create/merge PRs, deploy, run migrations, access databases, read secret values, send real messages, or call external product services.
- Intended network use is limited to the selected provider CLI connection.
- Do not modify package or lock files unless those paths are explicitly in scope.
- Do not run broad test suites; focused-test policy comes only from `agentOs.focusedTestMode` and Runtime baseline evidence.
- Verification is independent and read-only: it must not mutate the implementation workspace as trusted evidence of success.
- Red actions from Agent OS (`AUTONOMY_POLICY.md` / `OWNER_GATE.md`) always stop the agent until the owner grants an exact-target approval.

## Runtime rollout verification — 3 August 2026

Runtime SHA `615001a78a646d0ed02cecb90fd194e07facd43d` was installed. Services worker, dashboard, and bridge runner were restarted successfully. Terminal-state reconciliation was verified.
