# Result contract

Return a machine-readable result, followed by a concise human summary.

## `review` mode

- `mode: "review"`, `market`, `route`;
- `findings[]` — each with route/surface, observed visitor problem, why it is confusing, source path, proposed editorial intent, factual grounding, and risk classification;
- `editPlan[]` — proposed edits with source path and editorial intent, without a dictated replacement sentence;
- `applyAllowed: false`.

## `apply` mode

All of the `review` fields, plus:

- `branch`, full commit SHA, and draft PR URL once published;
- exact changed files;
- each check (`site-audit`, focused tests, ESLint, typecheck, `git diff --check`) as `PASS`, `FAIL`, or a justified `SKIP`/`BLOCKED`; the `site-audit` check must record which target it ran against (`branch-local` or `production-reference`) — only a `branch-local` run counts as post-edit verification, a `production-reference` run never does, and if no `branch-local` run was possible the check is `SKIP`/`BLOCKED`, not `PASS`;
- explicit `merged: false` and `deployed: false` booleans;
- blockers, and exactly one next owner decision, or `null` when none is required.

Never report success when the deterministic site auditor or a required check failed, when public copy was changed outside a matching approved `approved_ux_or_public_copy_change` gate, or when a `production-reference` site-audit run is presented as if it were `branch-local` post-edit verification.
