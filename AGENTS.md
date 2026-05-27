# AGENTS.md

Task instructions override this file when they are more specific.

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

## Current Priorities
- RU market first.
- OTA reduction and property automation are core positioning.
- Location module is MVP-stable; avoid unnecessary refactors.
- Next location work must be incremental: diagnostics -> soft gates -> paid report visuals.


## Out Of Scope
- Do not use, inspect, configure, or mention Vexp. It is not part of this project.
