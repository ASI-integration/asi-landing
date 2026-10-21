# Task28 — Integrated source audit of Tasks 19–27 (no deployment)

**Status: AUDIT CANDIDATE.** This is a reproducible *source-only* integration check, not a deployed or connected custodian. No cloud, guest traffic, real user records, secrets or paid resources.

## Baseline and immutable scope

Protected `main` as checked 2026-10-14: `9bc8175aa772e92366c7a2363e26900a042fc3ce` (Task21 merged). Native evidence already independently confirmed:
- Task19 [PostgreSQL17 Phase1](https://github.com/ASI-integration/asi-landing/actions/runs/38573727019): 30/30 native synthetic cases and cleanup PASS.
- Task21 [lost-COMMIT wire injection](https://github.com/ASI-integration/asi-landing/actions/runs/38582427316): 3/3 native synthetic controls, persisted readback exactly one, no guest send, cleanup PASS.
- Task20 fail-closed Phase2 and P13 source gates merged in PR #438; it *does not* install real custodian authority.

Six follow-on PRs **remain OPEN and UNMERGED**. Each current head has PASS for its original required `validate`, partner PostgreSQL integration and its dedicated focused CI; review comments resolved. They all share the same protected `main` ancestor and add files without modifying existing product source.

| Task | PR | exact head | source files |
|---|---|---|---|
| 22 | [#440](https://github.com/ASI-integration/asi-landing/pull/440) | `6752def66167f7940b0746cfc08447e02955a33e` | 4 |
| 23 | [#441](https://github.com/ASI-integration/asi-landing/pull/441) | `0a8c5003bb687729ea7a93c8f15a92a8138bbc4b` | 4 |
| 24 | [#442](https://github.com/ASI-integration/asi-landing/pull/442) | `7b6282f3106a534afc536f266b488232ab687e30` | 5 |
| 25 | [#443](https://github.com/ASI-integration/asi-landing/pull/443) | `79fae4e4db8cd76bf0783bb33f6a579034d8a87d` | 6 |
| 26 | [#444](https://github.com/ASI-integration/asi-landing/pull/444) | `822faea19477801987695a5c47d99e666ac2886c` | 4 |
| 27 | [#445](https://github.com/ASI-integration/asi-landing/pull/445) | `2dbce088ad8f8298a5c349224e10b19741610a00` | 4 |

## Actual isolated compatibility result

A fresh isolated checkout `C:\Users\Admin\asi-task28-isolated-20261014` at exact protected main fetched all six GitHub branch heads, verified the six SHAs and common merge base, then ran one **local Git octopus merge with `--no-commit --no-ff`**. It succeeded with **0 conflicts** and exactly **27 new paths**. No remote or existing production branch was changed. The combined tree passed all four focused Node suites on Windows: **98 total, 92 PASS, six POSIX-only SKIP**; Task26 Python 23 total (three PASS / twenty Linux SKIP); Task27 Python 28 total (25 PASS / three POSIX SKIP). **120 actual PASS, 29 OS-specific SKIP, zero failures**. This Windows result does not substitute for Linux-native acceptance.

The new Task28 PR-only GitHub-hosted Ubuntu workflow repeats the exact six head pins and no-commit merge, checks exactly 27 changed paths, then runs all six source suites **on one combined ephemeral tree**: 98 Node + 23 Python + 28 Python = **149 focused tests**. The workflow must actually pass to claim `COMBINED_LINUX_TEST_PASS`; passing the old separate six workflows does not count. The script emits a sanitized SHA-and-scope-only artifact, no guest data or secrets.

## Significant audit findings

**P0 — no live owner-authority closure.** None of the six PRs implements or installs an *independently owner-controlled* service account/broker, protected executable, vault, agent-denied effective permissions, operator identity / consent, signed one-use Phase2 receipt or independently checked revocation. Task22 and Task23 accept untrusted plans only. Task24 is a pure in-memory simulator. Task25 offers an OS-temp journal/unauthenticated socket but is intentionally a test fixture, not protected or installed. Task26 uses actual `SO_PEERCRED` but checks a fixture-supplied expected UID/GID on the same unprivileged runner; an unauthorized client from a different OS UID was **not physically tested**. Task27 packages only non-executable stubs; a SHA provided by its creator is not owner authentication. **Phase2 remains BLOCK and live guest messaging remains forbidden.**

**P1 — the packages have no application-level integration.** All 27 paths are only under `scripts/acceptance/`, `scripts/__tests__/`, `docs/ops/`, and `.github/workflows/`. No existing ASI runtime, Booking Ops, dispatcher, APIs, database migration or guest message route is changed; these prototypes are not wired together into a single service. Zero Git conflicts and 149 test passes imply **source compatibility**, not host-custodian or pilot readiness.

**P1 — important design seams remain unresolved:** Task24 (JavaScript offline broker), Task25 (JavaScript disposable disk/IPC), Task26 (Python kernel observer) and Task27 (Python deterministic non-executable bundle) currently have no stable versioned cross-language IPC contract, owner-approved executable payload, persistent signed manifest, unified consumed-ID and revocation store, crash-safe operational installation or matching native Phase2 SQL acceptance. Choosing a final protected process topology and genuine release contents is a separate implementation step.

**P1 — cloud target and authorization remain absent.** The user screenshots showed the existing ASI production machines `asi-runtime-hetzner` and `asi-landing-hetzner` in Hetzner project `Default`; these must **not** be used for lab tests. `ASI-Lab` is empty, no owner-controlled custodian server exists, and billing/access/security gates for a new host are unverified. User login access later became available, but that is not project creation, approval to spend, or trusted host attestation. No job in Task28 should contact Hetzner or Tailscale.

**P2 — audit must not mass-merge six independent PRs without review of their changed assumptions.** All six existing heads currently derive from the same old main. Merging just one changes main; rerun required CI against the *new* main for each subsequent PR, check GitHub protection/code-review status and abort on drift. Do not batch or auto-merge. Existing `docs/agent-os/AUTONOMY_POLICY.md` states **main merge is RED**, requiring an explicit owner approval that identifies exact PR/head/target and expected side effects.

## Exact next decision gates (not secretly executed)

1. **Gate 28A — integrated Linux code acceptance:** verify real Task28 workflow 149/149 on exact pinned six-head source and CodeRabbit on Task28 itself. Produce one evidence summary and dependency map.
2. **Gate 28B — controlled consolidation:** after a separately scoped owner grant, merge selected reviewed PRs one by one through normal GitHub protection and rerun CI/CodeRabbit against current main. Do not treat any prior isolated PR test as the new combined production build. If branches drift, recalculate and request fresh approval.
3. **Gate 29A — secure host:** separate new owner-controlled, approved/cost-bounded disposable project/host; independent owner custodian user, restricted IPC, protected persistent journal/vault, verifiable effective UID/GID denials, pinned executable and boot identity. The agent must not receive owner-level cloud credentials, root or secrets.
4. **Gate 29B — physical synthetic Phase2:** on independently protected host prove role retirement, real independent issuer, scoped one-use receipt consumption, revocation after crash/restart, idempotency/RLS and PostgreSQL synthetic cleanup, under a separate owner gate. Only then begin to discuss a separately approved live pilot; actual guest consent and message sending require further explicit authorization.

**Stop conditions:** fail on main/head drift, non-exact files, workflow secrets/cloud steps, merge conflicts, incomplete Linux suite, reopened CodeRabbit findings, unexplained active writer/issuer, privileged host proof missing, or any real guest/production side effect.

Task28 can legitimately finish as `INTEGRATED_SOURCE_AUDIT_PASS` while `ACTUAL_CUSTODIAN=NOT_INSTALLED`, `PHASE2_NATIVE=NOT_RUN`, `canSend=false`, `PILOT=NOT_LIVE`. The number of tasks after 29 is **not predictable** until physical acceptance and remediation are done.
