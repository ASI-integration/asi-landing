# Booking Ops dedicated scheduler — staged enablement

## Separate service permissions

The 10-minute Booking Ops job no longer requests the protected GitHub `Production` environment used for application deployments. It uses a separate `booking-ops-scheduler` environment and the **existing repository-level** `BOOKING_OPS_AUTO_SEND_RUNNER_SECRET` (verified present 2026-10-08). It never uses SSH, Supabase service-role, deployment, or generic `CRON_SECRET` credentials. The protected `Production` deployment environment and its required manual reviews remain unchanged.

**Before enabling:** check GitHub Actions environments and verify `booking-ops-scheduler` is not set to inherit any deployment secrets or privileges; do not copy secrets from Production. The service uses a repository-level dedicated secret only. On the server, both protected Booking Ops endpoints must match that secret; the new code explicitly rejects generic `CRON_SECRET`. This server-side change is not live until a separately authorized production deployment.

## Owner-controlled switches (repository Actions variables)

The three variables were ABSENT on 2026-10-08; the default action is to skip scheduling without API requests.

1. `BOOKING_OPS_SCHEDULER_ENABLED=true` — enables cron execution, but **dry-run only** by default. Dry-run may persist run/audit records; it makes no provider send calls.
2. `BOOKING_OPS_SCHEDULER_LIVE_ENABLED=true` — allows live mode **only with** a valid per-account allowlist. Neither missing nor fuzzy values (e.g. `True`, `1`, `all`) activate it.
3. `BOOKING_OPS_SCHEDULER_ACCOUNT_IDS=<comma-separated canonical account UUIDs>` — explicit limited set for live operation. Invalid/wildcard/duplicate/oversized lists fail closed. Accounts not in the allowlist remain dry-run.

All live sends also require server-side owner-enabled scope, account/property/booking isolation, configured channel readiness, operator review gates, the global emergency stop being clear, and idempotency checks. The scheduler cannot enable any of these persisted permissions itself.

## Manual workflow_dispatch

Required canonical `account_id`; `dry_run=true` by default. Setting `dry_run=false` is *not enough*: the owner must enter `SEND_FOR_THIS_ACCOUNT` in `confirm_live_send` for that single account and run. Missing or malformed acknowledgement fails the workflow before the API call. Max batch size 1–20.

## Safe rollout checklist

- Merge only with green CI and policy tests. Do not merge/unfreeze old pending Production environment approvals.
- Verify the deployed server has the dedicated runner secret; do not disclose its value. If missing, requests fail 401/abort — never fall back to a generic cron secret.
- First enable **only** `BOOKING_OPS_SCHEDULER_ENABLED=true` with live switch absent, and verify one dry-run + account scope logs. Do not infer delivery from a workflow's green status.
- Only after per-account canary, explicit owner approval and rollback plan should the live switch and allowlist be configured. The owner can immediately stop new runs by setting `BOOKING_OPS_SCHEDULER_ENABLED=false`; for active runs use the server/global communication emergency stop.
- Do not approve stale waiting job 37722639085 as a substitute for this migration. Cancel it separately after confirming there is no active execution, if appropriate.
- Production deployment of code remains separately gated and can reset live Telegram flags. The scheduler change does **not** authorize a deployment, live guest messaging, or database migration.

## Monitoring

Use `node scripts/booking-ops-scheduler-diagnostic.mjs` from PR #414 to distinguish waiting, skipped, cancelled and completed jobs. A green workflow is **not** proof of a provider message; inspect `sent/dryRun/blocked/failed` counters and the persisted audit trail.
