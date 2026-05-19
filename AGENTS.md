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


## vexp <!-- vexp v2.0.12 -->

**MANDATORY: use `run_pipeline` — do NOT grep or glob the codebase.**
vexp returns pre-indexed, graph-ranked context in a single call.

### Workflow
1. `run_pipeline` with your task description — ALWAYS FIRST (replaces all other tools)
2. Make targeted changes based on the context returned
3. `run_pipeline` again only if you need more context

### Available MCP tools
- `run_pipeline` — **PRIMARY TOOL**. Runs capsule + impact + memory in 1 call.
  Auto-detects intent. Includes file content. Example: `run_pipeline({ "task": "fix auth bug" })`
- `get_skeleton` — compact file structure
- `index_status` — indexing status
- `expand_vexp_ref` — expand V-REF placeholders in v2 output

### Agentic search
- Do NOT use built-in file search, grep, or codebase indexing — always call `run_pipeline` first
- If you spawn sub-agents or background tasks, pass them the context from `run_pipeline`
  rather than letting them search the codebase independently

### Smart Features
Intent auto-detection, hybrid ranking, session memory, auto-expanding budget.

### Multi-Repo
`run_pipeline` auto-queries all indexed repos. Use `repos: ["alias"]` to scope. Run `index_status` to see aliases.
<!-- /vexp -->
