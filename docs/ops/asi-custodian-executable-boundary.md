# ASI executable technical custodian v0 — source and deployment boundary

**Task29A (engineering integration, not physical Gate29).** This is a **real executable Linux process**, packaged in a deterministic `.tar` archive and launched as a separate OS process in disposable GitHub-hosted CI. It is **not** a fully authorized custodian with independently controlled owner keys, signed release, production integration or guest-send capability.

## What really runs

`scripts/custodian/asi_custodian.py` is Python 3.11+ and has `init`, `serve` and `client` commands. The process:
- Refuses root and non-Linux execution; creates one new private (0700) state directory with a fixed safe configuration, two private (0600) files, and file+directory `fsync` at initialization.
- Binds a local Unix socket, mode 0600. Each client is checked using the real Linux kernel `SO_PEERCRED` PID, UID and GID against *expected* peer UID/GID from the private config. Claims inside client JSON cannot choose these values.
- Handles one connection at a time, has a finite frame bound and wall-clock read deadline, accepts exactly one newline-terminated JSON envelope, and exposes only `status` and `append` (synthetic technical observation).
- Validates and reloads an append-only SHA256-linked journal before each request. Every accepted append is physically `fsync`ed **before** acknowledging it. A process restart preserves the accepted sequence, and the same request ID/sequence is refused on retry.
- Records a synthetic `UNKNOWN` outcome and enters persistent `HOLD` on subsequent writes; there is no automatic retry, authority grant, real operator receipt, SQL or guest message action.
- Returns `authorized=false`, `canInstall=false`, `canIssueReceipt=false`, `canApprove=false`, `canSend=false`, `phase2=BLOCK` on **every** API result.

`scripts/custodian/build_release.py` builds a **real source-executable** `asi-custodian-technical-v0.tar`. It includes the actual Python service file (mode 0755), documentation, and a reviewed-manifest placeholder with deterministic member SHA256s, rejects a second build overwriting an existing file, and validates exact archive bytes before CI publishes it for download. The archive is **unsigned and not an installer**. Identical reproducible bytes are not a cryptographic signature from the owner.

## CI evidence required

`.github/workflows/asi-custodian-executable.yml` is PR-only, with `contents:read`, unprivileged GitHub-hosted Ubuntu, no secrets, no cloud access, no `sudo`, no deployment. It must:
1. Run Python syntax checks and physically create/start/stop a separate Linux service process, test socket permissions, independent client process, strict frames, duplicates, incorrect expected kernel UID, client CLI and journal readback after restart.
2. Demonstrate that a synthetic uncertain transaction remains `HOLD` after restart and that malformed/tampered journal/config prevents startup.
3. Generate the deterministic executable-source tar, verify its SHA256 and negative tamper cases, then upload it as an **artifact** to GitHub Actions (14-day retention).
4. Pass existing GitHub `validate` and PostgreSQL integration checks and independent CodeRabbit review. No main merge without separately authorized exact PR/head.

## Important unimplemented trust boundary

A Linux server running and responding is **not** yet an owner-controlled, protected custodian. The expected UID is still specified by the initiating agent/test account. The same UID or root can rewrite source/config and journal, and hash chaining cannot prevent a capable actor from replacing all records. The service has no real restricted operator key, immutable owner-signed release, durable owner-only external idempotency anchor, per-tenant authorization, authentic consent, one-use Phase2 PostgreSQL receipt, native revocation or production send integration. Do not reinterpret `TECHNICAL_RECORDED` as permission.

Real deployment requires an independent owner-controlled *isolated nonproduction host*, separate protected service identity/keys, verified release signature, immutable executable/state, actual unauthorized **distinct UID** tests, durable fsync owner-ledger across crashes, revocation and Phase2 acceptance, separately authorized by the owner. A real guest consent and production send path is **not** part of this task.

**No use of existing Hetzner `asi-runtime-hetzner` or `asi-landing-hetzner` production servers.** No new paid VM, cloud project, secrets, Tailscale/firewall or live guest message in Task29A.

## Prior work

Tasks 22–27 PR #440–445 are all individually reviewed and unmerged; Task28 [PR #447](https://github.com/ASI-integration/asi-landing/pull/447) established that their **149/149 composite Linux source tests** pass but there was no executable integrated service. This new source work independently implements a single executable technical service using the same checked principles, with no import of unmerged source or branch rename. It **does not** imply permission to merge those PRs or production deployment.

Exit state can be `EXECUTABLE_TECHNICAL_SERVICE_PASS` once real Linux CI and archive upload PASS. `REAL_OWNER_CUSTODIAN=BLOCK`, `PHASE2_NATIVE=NOT_RUN`, `REAL_GUEST_SEND=false`, `PILOT=NOT_LIVE`.
