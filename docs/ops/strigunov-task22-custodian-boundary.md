# Task 22 — real independent custodian boundary: source preparation

**Decision:** CODE-ONLY PREPARATION. The custodian is **NOT INSTALLED**. Phase2 native operator acceptance, actual owner consent, and real sends remain **BLOCKED**.

## Verified context
- Baseline protected main: `9bc8175aa772e92366c7a2363e26900a042fc3ce` (Task21 native wire-fault success).
- [Task19 real Phase1](https://github.com/ASI-integration/asi-landing/actions/runs/38573727019): 30/30 real PostgreSQL17 technical cases; **not** operator authorization.
- [Task21 real P13 wire](https://github.com/ASI-integration/asi-landing/actions/runs/38582427316): physical lost-COMMIT technical acceptance; **not** permission to send.
- Windows DESKTOP-I29K350 read-only observation 2026-10-14: local account `ASI-Strig-Custodian` **absent**, private `C:\ProgramData\ASI-Strigunov-Custodian` **absent**, lab listener 55442 **absent**. Existing Windows PostgreSQL service was not used or modified.
- Task13 unpublished Phase2 SQL expects `task13_custodian` independent LOGIN and explicitly retired setup/provisioner role and sessions. Existing phase2.sql has literal run ID `strigunov-task13-20261014-a1`, port 55442 and PostgreSQL version 170011; those frozen values must be reviewed against the *new* host before any installation. SQL is **unapplied**, not a verified live gate.
- Task15 protected-host contract `STRIGUNOV-CUSTODIAN-PREP-20261014/06-TASK15-PROTECTED-HOST-CONTRACT.md` remains DESIGN ONLY. Original unsafe `01-OWNER-SETUP.ps1` must **not** be executed.

## Prepared code and its limitations
`scripts/acceptance/strigunov-task22-custodian-review.mjs` and the focused tests allow a **read-only pre-installation contract review**. They check isolated target identity, three separate Windows SIDs, pinned executable/config/review hashes, short validity, exact eight permitted broker operations, previously observed native evidence, retired provisioner, consumed-run protection, and prevention of guest/production scopes. Revocation model checks increasing epoch, actor/account continuity and denied stale session/request.

Even a forged perfect-looking owner-issued JSON **never returns an authorization**, install permission, Phase2 PASS, credential, receipt, or guest-send permission. `CANDIDATE_SHAPE_ONLY` or `REVOCATION_OBSERVATION_ONLY` are *descriptive* source results; no program reading them can treat them as proof of protected IPC or host identity. `authorizePhase2()` always returns BLOCK. No production import uses the module.

## Concrete missing physical trust boundary
1. **Owner-controlled install and trust:** an independent service account and broker controlled through Windows SCM, held in non-agent-writable files, with owner-verified executable+config hashes and run identity. Ordinary agent/admin JSON cannot install it. A shared elevated Windows administrator can bypass a local custodian; if isolation from that administrator is required, use a separately owner-controlled disposable hosted Windows runner.
2. **Credential custody:** distinct OS service SID, protected DPAPI CurrentUser vault and private ACL; no credentials, DSN, private key, shell or arbitrary SQL exposed to the agent. Verify access denial with a real unrelated process SID. An in-process mocked broker is not independence.
3. **Attested IPC:** local SID-authenticated narrow IPC, authorization of each operation independent of the caller's username, review-pinned fixed statements and parameters, challenge binding to host, database system ID, role OIDs, start time and source image. No arbitrary callback, path, query or code evaluation.
4. **Durable one-use operation:** protected persistent monotonic sequence/idempotency ledger; replays across restart and concurrent requests must be denied. Unknown COMMIT stays HOLD; reconciling a transaction is read-only and never authorizes real sends.
5. **Privilege retirement and native checks:** eliminate bootstrap grant, all active privileged sessions and role inheritance before binding a single fresh one-use Phase2 acceptance receipt. Only the independent custodian, not an agent, may create it. Verify SQLSTATE, epochs, account/actor mismatch, revocation, stale consent, RLS and cleanup using a *new* isolated PostgreSQL instance. Future tests must never interpret `SYNTHETIC_NOT_REAL_CONSENT` as actual guest approval.
6. **Owner review:** before real service/account/vault creation, produce an exact immutable build SHA, target SID, rollback boundaries, preflight of ACL and paths and a separate explicit owner authorization for that physical red operation.

## Safety controls for Task22 source publication
- New branch and PR change only new acceptance-review module, one focused test, one PR-only read-only GitHub Action, and this document.
- GitHub `validate` and CodeRabbit review must pass normally. Existing Task17 and Task21 manual workflows, data, DB roles, UI, production and active worktrees remain unchanged.
- No local account creation, ExecutionPolicy bypass, new service, vault, issuer, actual phase2 SQL, production, guest sends, or new native PostgreSQL dispatch in Task22.
- The repository autonomy policy classifies merge-to-main as red; do not merge this new PR without a specific owner authorization naming PR/head SHA. Finishing code-only PR is not the same as finishing physical Task22.

## Exit states
`TASK22_SOURCE_CANDIDATE` may become PASS after targeted CI and independent review. `CUSTODIAN_INSTALLED`, `PROTECTED_IPC`, `PHASE2_NATIVE`, `REVOCATION_NATIVE`, `REAL_OPERATOR_AUTHORITY`, `GUEST_SEND`, and `PILOT_LIVE` remain NO/BLOCK/NOT_RUN until real independent evidence exists.
