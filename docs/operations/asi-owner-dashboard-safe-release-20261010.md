# ASI owner engine roadmap — no-messaging production release

## Target
Only `asi-global.ru` / production Next.js site. This is NOT a separate Discord/Telegram change, Guest Autopilot, or a new runtime.

- Owner-only page: `/dashboard/engine-progress`
- Owner-only status API: `GET /api/dashboard/engine-progress`
- Feature PR: #431 on `feature/owner-engine-progress-20261010`
- Existing Dispatcher PR: #165 (unmodified)
- Release workflow: `.github/workflows/deploy-owner-engine-progress.yml`

## Non-negotiable preconditions

1. Source review and focused owner-route access tests pass (anonymous 401, nonowner 403).
2. Green complete PR Validation for exact PR head; no unresolved review blockers.
3. Merge approved PR into `main` through normal permission controls; note exact resulting full SHA.
4. Workflow source is pinned to current main; the separately approved dashboard-only candidate SHA must match release/owner-progress-live-baseline-20261010 at both stages. The candidate delta is checked against actual production, not all pending main changes.
5. Production GitHub Environment `production` allows release and standard VPS secrets (`VPS_HOST`, `VPS_SSH_KEY`, optional `VPS_PORT`) are configured.
6. Existing `/var/www/asi/shared/.env.production.local` exists and contains nonempty `SESSION_SECRET`, `ASI_DEVELOPMENT_OWNER_EMAILS` and `GITHUB_TOKEN`. Validate presence only; never print or copy secret values.
7. `asi-landing.service` is active before starting. No concurrent production deployment.

## Explicit release action

GitHub → Actions → **Deploy Owner Engine Progress (no messaging changes)** → Run workflow, selecting **main**.

Inputs:
- `confirm_owner_ui_deploy = DEPLOY_OWNER_UI_ONLY`
- `sha = <exact approved dashboard-only candidate 40-character SHA>`

This is manual-only and shares the existing `deploy-main` concurrency group. It validates current main and the release branch separately, rejects any non-allowlisted production delta, and builds only the candidate SHA. It runs lint/typecheck, the selected dashboard tests, Next.js build and a disposable artifact smoke before the protected deployment job.

### Scope of production side effects

**Expected:** New Next.js release under `/var/www/asi/releases/<sha>`, atomic current symlink, `asi-landing.service` restart and app health/version validation. Existing canonical script may prune old release directories as part of its standard cleanup. A brief site interruption during service restart is possible.

**Not authorized / not performed by new workflow:** Telegram Bot API, set/delete webhook, enabling/disabling communication kill switches, changing Telegram env values, DB changes, agent provider activation, payment calls, scheduler modification, worker installation.

`owner-progress-preserve.env` is a comment-only overlay: existing server env keys are retained by the existing deploy script. Owner access / GITHUB_TOKEN must have been configured on the server beforehand; this workflow does not create, rotate or reveal secrets.

## Stop conditions and post-action checks

The workflow stops if main SHA drifts, owner confirmation is incorrect, owner/security env names are missing, service isn't active, source build/CI fails, or artifact/health checks fail.

After atomic deploy, it requires public `/api/version` to match exact SHA and anonymous GET of the new owner API to be **401** (fail-closed). The owner must also log in and confirm the sidebar item and dashboard data. Existing `/dashboard/control-center` and client functions should remain normal.

If the new version is unhealthy, the canonical deploy script attempts rollback to the previously active release and previous environment file. An authenticated UI session smoke and real-time GitHub token scope acceptance remain required; public 401 alone cannot prove owner-visible data.

## Status

This document + workflow are a scoped proposal in PR #431. They do not mean that a production deployment has occurred. Preserve Draft until reviewed. The merge and the manual production workflow are separate red-authorized operations; a green CI cannot itself grant release permission.

## 2026-10-11 diagnostic and provenance follow-up (not deployed)

The read-only preflight now streams scripts/owner-dashboard-preflight.sh from the workflow checkout. It retains the eight original predicates, prints only PASS/FAIL labels, and stops on the first failure. No env values or permissions are changed. Missing remote labels plus SSH exit failure means transport/access diagnosis is still required, not that any env key is known missing. A failed preflight must never be bypassed or blindly rerun.

Offline checks: node --test --test-concurrency=1 scripts/owner-dashboard-preflight.test.mjs scripts/owner-dashboard-source.test.mjs. Shell tests substitute inert functions for every host probe; source tests inject synthetic GitHub/mission-control/auth dependencies, never use live credentials, and render the actual React view. Node 20+ and the existing TypeScript/React dev dependencies are required.

The diagnostic helper and its tests are workflow-control changes, not additions to the approved production payload allow-list. Do not add them to a release candidate or relax owner-engine-release-scope.mjs to get a green scope check. Promote only independently approved owner-UI changes onto an exact production-baseline candidate through the normal release process.

Only Dispatcher CI is polled automatically (15-second client interval and server cache; up to three sequential eight-second GitHub requests). Concurrent requests share one in-flight read per process; failures also cache for 15 seconds. This is bounded per-process polling, not a distributed rate limiter or push event feed. GitHub token actual permissions must be independently verified; the source uses fixed repository GET endpoints and never sends it to the browser.

Other milestone statuses are now unknown/NOT_RUN, not hardcoded completed claims. Project cards disclose unconnected feeds. Source event time is the GitHub run updated_at; poll time is separate. A failed browser refresh clears obsolete PASS data. Roadmap definitions remain a versioned manual plan. The mission-control file store is supplementary activity, not milestone completion authority.

Next bounded integration: reviewed server-side adapters for exact task/result IDs, source timestamps and evidence links for each project, using the existing mission-control seam. Do not auto-advance a milestone from a generic activity done flag. This follow-up does not implement or authorize that integration.

Production acceptance still requires exact live SHA, authenticated owner render, anonymous 401/nonowner 403, and verified fresh source data under a newly applicable protected production approval. No local offline result substitutes for those checks.
