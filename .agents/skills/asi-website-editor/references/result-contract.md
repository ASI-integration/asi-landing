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
- each check (`site-audit`, focused tests, ESLint, typecheck, `git diff --check`) as `PASS`, `FAIL`, or a justified `SKIP`;
- explicit `merged: false` and `deployed: false` booleans;
- blockers, and exactly one next owner decision, or `null` when none is required.

Never report success when the deterministic site auditor or a required check failed, or when public copy was changed outside a matching approved `approved_ux_or_public_copy_change` gate.
