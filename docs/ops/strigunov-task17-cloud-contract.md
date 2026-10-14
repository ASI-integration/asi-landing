# Task17 synthetic PostgreSQL17 acceptance

Task17 owner consent covers normal reviewed PR publication with required validate CI, protected merge without bypass, and ONE manual synthetic acceptance dispatch. It does not authorize production, real data, guests, Phase2, or local PostgreSQL.

## Synthetic-only approval model
Public repository ASI-integration/asi-landing has one collaborator, owner ASI-integration (GitHub actor ID207600140). A second-reviewer environment with prevent_self_review cannot operate here.
For synthetic phase1 only, Task17 replaces that proposed Task16 control with GitHub-authenticated owner workflow_dispatch, exact main/workflow/checkout commit SHA, fixed confirmation, owner login + numeric actor ID + triggering actor, attempt1 only. No environment, admin API, PAT, application secrets, or deployment credentials. This change requires explicit independent source/security signoff before staging/commit. It never relaxes protected host/operator provenance, real consent/send, Phase2 or production gates.
The trusted inline guard runs before checkout; pinned checkout uses github.sha with credentials persistence disabled. Source preflight compares every required file against the approved commit and immutable legacy pins; untracked/missing/modified inputs fail. Package pins use current main Git blob bytes, not Windows CRLF.
The workflow is strictly manual, ubuntu-24.04 GitHub-hosted, contents:read, timeout15min, concurrency1 (no cancellation of another run). No automatic native run on PR/push.
Only reviewed official Docker Library postgres:17 image digest sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3 is accepted. Retrieved from Docker Hub library/postgres tags/17 on2026-10-14, last_updated2026-10-07; linux/amd64 manifest sha256:3cec7eb015ba8adb28139fa5c83b8489cdf0e666e53dfdf20f598ae0cc8739e3. Independent reviewer checks metadata before approval. Runtime verifies major17 and system identifier.

## Native execution
The dependency graph contains seven byte-identical legacy SQL/modules from Tasks08/11/12/13, copied from the unchanged original worktree. Task17 modules and two test files adapt the old unpublished candidate; no old worktree edits.
Install order is Task12 canonical fixture → Task08 request DRAFT → Task11 fences DRAFT → Task13 phase1 bootstrap. Task12 overlay and phase2 excluded.
Fresh job-owned Docker container uses tmpfs data, loopback55442, generated 256-bit ephemeral passwords, SCRAM host authentication. Setup superuser only creates roles/database and verifies metadata. Provisioner SET ROLE owner installs schema and executes privileged fault injection; A/B are independent restricted LOGINs with separate PID/session/current identity. Wrong-password SQLSTATE28P01 and FORCE RLS are required.
Six domains booking/physical/cleaning/policy/legal/checkout × commit/rollback/race =18 physical assertions at slots14–31; 12 technical phase1 scenarios use original slots1–13 excluding stale_actor.
Race barriers use server pg_blocking_pids, not sleeps. Readiness polls TCP only; per-statement/client/lock/job deadlines bound work.
Success requires30 proofs, closed authority (no sessions/requests and NULL native marker), no connection faults, and exact container ID/name/label/image cleanup. Otherwise HOLD/exit1; unknown COMMIT never retries.
No SQL runs on the laptop. Native results are unknown until the approved Actions run finishes. Sanitized artifact includes failed stage and error code, never raw SQL/error text, credentials, environment or Docker logs. Finally closes clients and cleans the exact owned container; always cleanup handles cancellation where GitHub permits it. Hard host termination does not prove cleanup PASS. No automatic rerun.
Phase2, real operator provenance, actual guest consent/send and P13 transparent lost-COMMIT wire remain BLOCK. Windows custody NOT_INSTALLED. Pilot NOT_LIVE even if all technical checks pass.

## Publication and existing CI
A separate Task17 branch/worktree is based on main f42cd99f57bafa681def155a676619a1d80504fe. No existing branch is renamed or checked out.
Required validate runs through the normal PR, with no branch-protection bypass. Existing PR Validation performs its own tests/build/ephemeral integration; this is authorized required CI, not the requested native PG17 workflow. Existing Strigunov Event Handoff may update tracking issue416 on relevant CI completion/merge; it does not deploy or run guest actions. Production deploy workflows are manual. Main trigger inventory must be rechecked before merge.
Only explicit manifest paths are staged; no reports, secrets, unrelated API/UX or migrations. Native dispatch occurs only after protected publication and exact merge SHA verification.
