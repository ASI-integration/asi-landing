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
4. Exact SHA is still **the current `main` HEAD** at both build and production-deploy stages.
5. Production GitHub Environment `production` allows release and standard VPS secrets (`VPS_HOST`, `VPS_SSH_KEY`, optional `VPS_PORT`) are configured.
6. Existing `/var/www/asi/shared/.env.production.local` exists and contains nonempty `SESSION_SECRET`, `ASI_DEVELOPMENT_OWNER_EMAILS` and `GITHUB_TOKEN`. Validate presence only; never print or copy secret values.
7. `asi-landing.service` is active before starting. No concurrent production deployment.

## Explicit release action

GitHub → Actions → **Deploy Owner Engine Progress (no messaging changes)** → Run workflow, selecting **main**.

Inputs:
- `confirm_owner_ui_deploy = DEPLOY_OWNER_UI_ONLY`
- `sha = <exact current main 40-character SHA>`

This is manual-only and shares the existing `deploy-main` concurrency group. It builds exactly that SHA, runs lint/typecheck, three focused dashboard tests, Next.js build, a disposable artifact smoke, and then uses the existing atomic production deploy script.

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
