# Owner engine milestones dashboard v1 (RU)

**Route:** `/dashboard/engine-progress` on the RU ASI owner cabinet. Appears in the existing owner-only sidebar as **Вехи движка**. The UI and `GET /api/dashboard/engine-progress` reuse existing `DevelopmentOwnerGuard` and `requireDevelopmentOwnerSession` (deny by default when `ASI_DEVELOPMENT_OWNER_EMAILS` is missing).

## Purpose
Bring the owner's 2026-10-10 Excel roadmap into the ASI cabinet: **19 milestones, 63 stable step IDs**, simple collapsible cards, filters, next unfinished milestone, and numeric step counts.

## Live data vs snapshot — important
- **Live now:** latest Draft PR #165 head SHA and required three GitHub CI jobs on that **same SHA**, obtained through **server-only GitHub API**; automatic browser refresh every 15 seconds while page visible, plus manual refresh. One code path maps the CI evidence strictly to steps **2.1, 2.2, 2.3, 2.4**.
- **Live when available:** existing ASI Mission Control project snapshot; stale events are marked explicitly.
- **NOT live yet:** other 59 steps. These remain the dated 2026-10-10 planning snapshot and are labeled `Снимок`. They do not change merely because CI passes. Do not call their progress a percent of engineering completion.
- **Not included:** owner step editing/persistence, GitHub push webhook, Codex/Astra agent event ingestion, WebSocket/SSE, auto-merge, deployment, provider activation.

## GitHub connectivity
Server env **`GITHUB_TOKEN`** must have read-only access to the ASI Runtime repository's Pull Requests, Actions runs and jobs. Never expose the token to browser; no `NEXT_PUBLIC_*` secret. If missing, unauthorized, rate-limited, network-down, nonmatching PR repo or no CI run for the current SHA, show **Нет данных**, never reuse an old PASS.

Three required jobs:
1. `Runtime security and staging bridge (ubuntu-latest)`
2. `Runtime security and staging bridge (windows-latest)`
3. `Windows artifact and mock-control acceptance`

`2.4` is PASS only when all three jobs have successfully completed on exactly the current PR head. Error, skipped, absent and running jobs cannot set PASS. API always returns no-store and requires a server-side owner session. One bounded 8-second timeout per outbound request; 15-second in-process result cache.

## Verification before deployment
1. Review exact changed source/owner guard, independent owner-only API and no secrets in browser.
2. `npm run typecheck`, `npx vitest run src/lib/engine-progress/__tests__/roadmap.test.ts`, lint, and relevant site CI.
3. With owner login, check `/dashboard/engine-progress` has 19 milestones / 63 steps. Open and close cards, switch filters, refresh.
4. Verify unauthenticated API returns **401** and authenticated nonowner returns **403**. Owner with missing token sees **Нет данных**, not a previous PASS.
5. In a controlled test, confirm old SHA, missing job, failed job, canceled job, and pending CI never turn 2.4 green.
6. Deploy only after the standard ASI owner release gates. PR remains Draft until verified; no live execution authority is granted by this dashboard.

## Future milestones
- Durable event store for all 63 step IDs with evidence URLs, audit trail and server-enforced owner proof for manual completions.
- Signed GitHub webhook / provider event ingest (idempotent) rather than periodic remote polling.
- Show Codex/Astra task IDs, hard blockers, dependency graph, budgets/throughput from the existing runtime Bridge; never create a second task queue.
- Integrate Booking Ops / KIM / ORIS events through explicit source bindings, without mixing project authorization.

No production changes are made by this PR alone.
