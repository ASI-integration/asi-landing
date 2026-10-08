# Booking Ops scheduled runner: read-only diagnostics

## Purpose

Distinguish a protected GitHub Actions approval queue from a running scheduler, a cancelled run, and a successful workflow whose actual guest-delivery outcome is **not verified**. This supports Issue #413 and status monitoring in Mission Control without weakening any owner authorization.

## Run

From the ASI repository:

```powershell
node scripts/booking-ops-scheduler-diagnostic.mjs
```

The command prints machine-readable JSON containing `state`, recent scheduled-run counters, latest run URL and SHA, Production approval evidence, and the public health/version comparison. The script only calls read-only GitHub queries and public `/api/health` and `/api/version`; it cannot dispatch, cancel, approve, deploy, send guest messages, access database credentials, or change environment settings. Failed API reads produce `diagnostic_unavailable` or an explicitly unknown field, not an optimistic success.

## Interpret results

- `awaiting_environment_approval`: GitHub reports a waiting scheduled run and a protected environment approval; this is **not** an autonomous scheduled execution.
- `waiting_unverified`: the run is waiting, but approval metadata could not be verified; investigate without guessing.
- `cancelled`: the newest scheduled run did not finish; older green runs do not override this state.
- `workflow_success_delivery_unverified`: GitHub completed the workflow successfully; it is **not proof** of a Telegram message, and the runner's safe sent/blocked counters must be checked independently.
- `versionMismatch=true`: GitHub `main` and the actual production application report different versions. It is not permission to deploy.
- `productionHealthy=null`: public health could not be verified, not evidence of an outage or success.

## Remaining action gate

The current workflow still targets protected `Production`, which requires review for each scheduled job. Making it truly unattended needs a separately reviewed least-privilege service identity/environment configuration, owner approval and a canary. Do **not** auto-approve the protected environment, move secrets, activate live sends, or remove production checks as part of this diagnostic.
