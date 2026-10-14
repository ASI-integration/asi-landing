# Task 21 — real synthetic PostgreSQL 17 lost COMMIT reply

Status: unexecuted native acceptance candidate until normal protected PR, required CI, exact-source review and one separately owner-authorized manual `workflow_dispatch` complete.

## Purpose

Demonstrate a **real PostgreSQL wire-level reply loss after server COMMIT**, rather than simulating a JavaScript exception. Preserve no-retry policy and read-only independent reconciliation. All data and accounts in this lab are synthetic. No external ASI endpoints, live booking/guest data, production, payment or message sending.

## Exact scope

- Existing protected `main` baseline: `e9386afa48b4f45b8e7ea292b87f936568673d8f`; Task19 Phase1 [native PASS](https://github.com/ASI-integration/asi-landing/actions/runs/38573727019).
- Fresh GitHub-hosted Ubuntu 24.04 runner, one job-owned PostgreSQL17 Docker container (immutable official pinned digest), memory-backed storage, loopback 127.0.0.1:55443, ephemeral cryptographically random PostgreSQL SCRAM credentials.
- One temporary table with unique synthetic idempotency keys; restricted insert/read writer and separate read-only reader with FORCE RLS. Reader's denied INSERT must be physically verified (SQLSTATE42501).
- Bounded TCP byte-framed relay is the one permitted fault mechanism. Frontend protocol tracks **one** actual COMMIT, backend protocol parses physical PostgreSQL `CommandComplete: COMMIT` followed by idle `ReadyForQuery`. Both frames are suppressed before reaching the client, then the transport closes. The client must observe no successful COMMIT ACK.
- Independent read-only reader must observe exactly one committed synthetic row; no resubmission, no business mutation replay.
- Negative control: disconnect before COMMIT; uncommitted synthetic INSERT must roll back (readback=0).
- Positive control: COMMIT response delivered directly; readback=1.
- Every wire/fault path remains technical only: `phase2='BLOCK'`, `realAuthority='BLOCK'`, `canSend=false`. This lab does not issue any operator credential or consent receipt.

## Required approval and guards

Workflow `.github/workflows/strigunov-task21-pg-wire-manual.yml` is **workflow_dispatch only** on protected `main`. Trusted inline guard executes before checkout; requires owner login + numeric actor ID, triggering actor, attempt1, exact main/workflow/reviewed SHA, fixed purpose confirmation and pinned official PostgreSQL17 image digest. Read-only contents token; no secrets/environment/admin API. No PR/push/schedule/automatic native triggers, no self-hosted runner, no local PostgreSQL execution.
Source preflight hashes every reviewed source and package lock against the exact Git commit; source changes, missing or dirty inputs lead to HOLD before Docker or SQL. Cancellation fallback removes only the exact job-owned labelled container; unknown identity never allows prune. Credentials, SQL parameters, Docker inspect contents, DB logs and environment secrets must not appear in result artifacts.
A native PASS requires 3/3 technical controls, independent readback, no retry, exact container cleanup and sanitized evidence. A failure requires HOLD with stage/code and **no blind rerun**.

## Independence and limitations

The relay sees server `COMMIT` acknowledgement/ready-for-query but deliberately drops them before the client; this confirms a server-accepted COMMIT while the client sees transport failure. Independent read-only reconciliation confirms durable row visibility after failure. The experiment is limited to a disposable synthetic table, not production failure injection. This is **not** real operator permission, not Phase2 SQL, not real guest consent or native guest-send safety.
An independent code/security review, GitHub required `validate`, and exact-HASH merge into protected main precede any real native run. On success update this record and evidence with actual run ID and SHA; never fill in hypothetical PASS.

## Follow-on still blocked

Protected external Windows or independent hosted custodian / secret vault / operator provenance and revocation; one-use Phase2 receipts; actual guest consent; production readiness/pilot. Task21 technical evidence cannot open them.
