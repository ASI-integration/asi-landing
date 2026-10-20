# AGENTS.md

Task instructions override this file when they are more specific.

## Agent OS
- Start with [CURRENT_RELEASE](docs/agent-os/CURRENT_RELEASE.md) and [WORKFLOW](docs/agent-os/WORKFLOW.md).
- Product invariants: [PRODUCT_CONTRACT](docs/agent-os/PRODUCT_CONTRACT.md).
- Autonomy and owner approval rules: [AUTONOMY_POLICY](docs/agent-os/AUTONOMY_POLICY.md).
- Completion and blocker contracts: [DEFINITION_OF_DONE](docs/agent-os/DEFINITION_OF_DONE.md) and [BLOCKERS](docs/agent-os/BLOCKERS.md).
- Project Skills: `.agents/skills/asi-task-execution`, `asi-staging-acceptance`, `asi-production-rollout`, `asi-website-editor`.
- These documents supplement this file; the testing budget, protected areas, and deploy rules below remain authoritative.

## Testing Budget
- Do NOT run broad test suites by default.
- Do NOT run `npm test`.
- Do NOT run `test:location-golden` unless explicitly requested or changing scoring, SSOT, `LocationDecision`, or public score contracts.
- Default checks: `npm.cmd run typecheck`, ESLint on touched files only, and focused tests only: max 1-2 files or about 30 tests.
- If broader tests seem necessary, explain why and wait for approval.

## Protected Areas
- Location scoring, SSOT, `LocationDecision`, and `LocationPublicSummary` are sensitive.
- Do not change scoring unless the task explicitly asks.
- H3 diagnostics must not affect `finalScore` unless the task explicitly says "soft evidence gate" or "scoring integration".
- Do not expose raw diagnostics in public RU UI.

## Deploy And Git
- Keep `main` clean.
- Do not include `tmp/`.
- Do not include unrelated package changes.
- Commit only task-relevant files.
- Report final git status.

## Language And Style
- User-facing RU copy must be simple, clear Russian.
- Avoid technical words like "якорь", "kernel", "trace", and "permalink" in public UI.
- Internal docs may use technical terms.

## Active release compass (mandatory for new PRs)
- Current milestone source: `docs/agent-os/releases/strigunov4-demo.json`.
- Before beginning any task, run `node scripts/agent-os/check-demo-release.mjs` and select its first unaccepted stage.
- New PRs must declare `Release-Stage` and `Release-Mode`. The required `validate` job checks actual paths against that stage.
- Do not create side tasks, unrelated features or new diagnostics without a stage criterion. After two consecutive diagnostic PRs for one stage, request a bounded decision instead of starting a third.
- Moving a milestone to ACCEPTED requires real run-bound evidence and separate owner authorization; tests/CI/PRs are not physical acceptance.
- An owner approval comment for scope change does not grant merge, protected dispatch, SSH, production, SQL or server mutation.

## Current Priorities
- RU market first.
- OTA reduction and property automation are core positioning.
- Location module is MVP-stable; avoid unnecessary refactors.
- Next location work must be incremental: diagnostics -> soft gates -> paid report visuals.


## Out Of Scope
- Do not use, inspect, configure, or mention Vexp. It is not part of this project.

- Do not use, inspect, configure, deploy to, or mention Vercel. Production deploy is VPS/Timeweb only.
