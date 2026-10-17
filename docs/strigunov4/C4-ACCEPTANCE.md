# C4 — staging G0 physical acceptance, safe first gate

**Status: SOURCE-ONLY, C4 FULL PHYSICAL E2E NOT RUN.** This PR does not mutate staging, deploy the app or authorize production. Do not label a passing read-only probe as `READY FOR SUPERVISED STRIGUNOV DEMO`.

## Fixed source and physical environment

- G0 has already been activated on `asi-landing-staging` (systemd, localhost:3001): source `d912aec6663de90e5ca4293cc5a69e2e0ed9ff94`; protected GitHub activation run [39036303529](https://github.com/ASI-integration/asi-landing/actions/runs/39036303529) printed `STAGING_G0_ACTIVATION_PASS`.
- Protected nine-SQL staging apply [39031172658](https://github.com/ASI-integration/asi-landing/actions/runs/39031172658) returned `STAGING_NINE_SQL_APPLIED`. Read-only history expected `postgres|17|99|7|9`.
- GitHub `staging` environment is restricted to `main` with owner reviewer and stage-only secrets. No direct laptop staging DB writes, no bypass or permissive fallback.
- Seven effective process no-send settings, not just values in a text env file, must be rechecked.
- Existing public Vercel site and Production/Sentinel are separate. The stage-only source paths are covered by the reviewed ignore-build rule; that is not authorization to deploy.

## Protected workflow

`.github/workflows/strigunov4-c4-e2e-acceptance.yml` has three distinct jobs:

1. `offline_source_tests`: source-only adversarial context and receipt cases, no secrets. Runs on PR.
2. `isolated_full_e2e`: **only** on owner-initiated `workflow_dispatch` from reviewed `main` with SHA-bound confirmation. Builds a real Next.js application, then runs the existing `strigunov-g0-lab.mjs` on disposable, internally networked PostgreSQL17/PostgREST and synthetic actors A/B. The G0 worker covers intake -> booking, duplicate/atomic availability, CRM/operator, stale ACK/takeover, crash/restart, identity isolation, provider-send/payment canary, cleanup. The runner must show no residual rows and zero external connections. This suite never connects to staging Supabase or live providers. Report results as **isolated** evidence, not physical staging evidence.
3. `protected_c4_readonly`: runs only when the isolated suite and security unit tests pass, and only after a separate protected `staging` environment owner approval. Reuses the already-reviewed PostgreSQL17 TLS `verify-full` read-only query, fingerprint-pinned SSH to the staging host and checks actual G0 process PID, unit digest, release symlink, health/version JSON, 7 effective no-send flags, and unauthorized route denial. Sends only uncredentialed HTTP requests; never attempts an authorized booking or data cleanup. Success prints `C4_READONLY_PREFLIGHT_PASS` with `fullE2E=NOT_RUN`.

All remotely supplied strings and errors must stay out of public logs. The remote probe must never print environment contents, response bodies, database records or secrets.

## FULL physical C4 remains separately gated

The final **staging** HTTP/DB journey is not executed by this workflow. A separate independently-reviewed exact-ID fixture runner is still required; do not reuse older scripts that delete by loose prefix or touch shared user/accounts. No stage writes until all conditions hold:

- Named single-use synthetic account/property/user/booking identities, no real guest contacts, no real OTA inventory and zero shared-tenant mutations.
- Pinned stage database project, full required SQL history, verified G0 build and effective no-send. Test effects must be denied at the real provider boundaries, plus independently checked for actual outbound traffic; a flag alone is insufficient proof of zero sends.
- Exact-ID insertion, structured event receipts, and exact-ID cleanup with pre/post row and sequence reconciliation; no `DELETE ... LIKE prefix`, global truncate, migration or schema alterations.
- Real request chain: synthetic intake, CRM operator assignment, availability conflict/atomic slot, booking record, queue, operator ACK/takeover, audit, duplication/retry, two independent connections, process crash/recovery. No payment, OTA sync or guest message.
- Reconciliation on unknown COMMIT/connection loss: read-only check first; no blind replay. If side effects or cleanup cannot be proven, **BLOCK** and preserve restricted evidence.

**Do not merge this source-only PR before independent code review and Linux CI.** After merge, the owner must separately start the protected workflow and approve the `staging` environment. Even successful results prove isolated E2E + read-only stage gates, not full physical C4, until the exact-ID staging runner has been separately accepted.
