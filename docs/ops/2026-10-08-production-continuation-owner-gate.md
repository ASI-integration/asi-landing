# ASI production continuation — owner-gated runbook

Production deploys are **not read-only**: the workflow rewrites `production.env`, enables Telegram guest outbound and may reset communication stop flags.

## Safe unattended use

Use `node scripts/production-continuation-runner.mjs --task telegram-text --status` for read-only status. For monitoring use `--watch-main` without `--allow-production`. If production differs from `main`, the runner reports `awaiting_exact_production_approval` without dispatching a deploy or sending guest messages.

## One-SHA manual authorization

Only an owner consciously running the command with **all** of the following authorizes a production action:

- `--allow-production`
- `--approved-sha=<exact reviewed 40-character main SHA>`
- `--confirm-live-guest-messaging=ENABLE_LIVE_GUEST_MESSAGING`

The SHA must match the current target. An existing approval cannot silently carry forward if `main` changes. The separate GitHub **Production** environment gate remains manual: the runner **never** approves the environment on behalf of the owner. Production text acceptance remains protected by the same exact-SHA gate.

Do not enable these flags in an unattended hourly/nightly schedule. Preserve rollback/health/version verification and require review of scope before real guest interactions. This patch only modifies the continuation runner; it does not deploy to production.

## Separate blocker

The ten-minute Booking Ops scheduled run is currently `waiting` for a GitHub Production environment review. It is **not** autonomously sending messages. Do not bypass the gate; a separately reviewed runtime/credential solution is needed for true unattended operation.
