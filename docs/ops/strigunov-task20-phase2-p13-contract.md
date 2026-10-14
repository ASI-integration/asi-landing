# Task 20 — Phase2 protected authority and P13 lost-COMMIT boundary (SOURCE ONLY)

**Status:** source-only guard candidate. It does NOT install host custody, promote Task13 Phase2 SQL, connect to databases, verify real operator authority, authorize guests, or run the live pilot.

## Immutable starting evidence

Task19 genuine isolated PostgreSQL17 result: [GitHub Actions run 38573727019](https://github.com/ASI-integration/asi-landing/actions/runs/38573727019).
- Protected `main` at `02e81db54e69d87978872151c40af3b9ec17825c`
- `TECHNICAL_PHASE1_PASS`: 18/18 six-domain barriers and 12/12 scenarios, independent restricted LOGINs, FORCE RLS, closeout 0 sessions / 0 requests / 0 markers
- Source-focused tests 41/41, native cleanup PASS
- Artifact retained locally in `C:\Users\Admin\asi-strigunov-2x\task19-evidence-20261014\strigunov-task17-result.json`; artifact digest and exact-source SHA in Task19 report
- `phase2=BLOCK`, `p13Wire=BLOCK`, `realAuthority=BLOCK`, `canSend=false`

## Task20 implementation boundary

`scripts/acceptance/strigunov-task20-boundaries.mjs` is a **pure offline observer**, deliberately not an authorization or issuance API.
1. `inspectPhase1Evidence(report, reviewedSha)` checks the exact expected 30 named cases, zero residual authority, current inspected SHA, native execution, clean disposal, PostgreSQL 17, and independent restricted A/B identity. It returns `STRUCTURE_MATCH_ONLY` or `HOLD`, always `canApprove=false, canSend=false`. **This is not artifact authentication**: an attacker can forge JSON, so no caller report may become authority.
2. `assessPhase2Gate(report, sha, claimedReceipt)` is unconditionally `BLOCK` pending an independently owned host custodian, protected operator identity/provenance, revocation evidence, genuine scoped guest consent and a P13 wire test. Caller-supplied receipts/claims are ignored for authority.
3. `inspectCommitTrace(events)` classifies a *reported* single COMMIT attempt. A technically clean ACK is `TECHNICAL_ACK_ONLY`, not persistence readback. A submitted COMMIT followed by disconnect, timeout, ambiguous response, rollback reply, retry or any malformed/out-of-order event is `HOLD`, never silently replayed. This does NOT send SQL and is not a tested network fault injector.
4. No existing routes, migrations, SQL, runtime providers, guest channels, or original Task17 evidence are modified. No Task20 module is imported by production code or by the native workflow.

## Real Phase2 acceptance prerequisites (remain blocked)

A *new*, separate acceptance is necessary before Phase2:
- An **independent owner-controlled custodian** with verified OS/host identity, immutable reviewed source/image, protected secret custody/IPC, physical isolation against an agent or build job, and logged owner activation. A GitHub username, agent-authored JSON, or owner checkbox is not an independent issuer.
- The privileged bootstrap/provisioner sessions and grants must be retired and their absence independently proven. A/B restricted LOGINs and FORCE RLS continue.
- Custodian validates fresh real physical Phase1 evidence and retires any former receipt; it issues a tightly bounded, one-use Phase2 receipt bound to PostgreSQL system identifier, reviewed SHA, role identity/OIDs, fixed account/actor/booking, narrow time window, and monotonic epochs; SQL independently consumes it once.
- Prove revocation, actor mismatch, tenant separation, stale epochs, missing policy/consent, ABA paths and session/request invariants against an isolated **native** PostgreSQL instance. Never create a synthetic proof that pretends to be real consent. Restore/delete the job-owned database/container deterministically.
- Host and reviewer must agree on exact source and accepted failure modes before authorizing a separate synthetic Phase2 workflow. **No Phase2 dispatch is included in Task20.**

## P13 transparent lost-COMMIT test needed (remains blocked)

An *independently reviewed*, disposable PostgreSQL wire-fault lab must issue a single transaction, have the server commit, and drop the client's reply at a deterministic injection point. The client must enter `HOLD`, preserve the idempotency key and original attempt identity, issue no second COMMIT or business mutation, and require **read-only authoritative persisted-state reconciliation** before any resolution. Test positive, negative and ambiguous cases; connection drop before submit is a separate case. Merely throwing a JavaScript error or showing a fake trace is not a true wire test. Never produce/send guest notifications in this lab.

## Review and CI

- Proposed PR-only `.github/workflows/strigunov-task20-source.yml`, read-only token, hosted runner, no secrets, five-minute timeout, no external services and no PostgreSQL, runs the focused safety tests.
- Existing required PR `validate` remains mandatory and must pass normally; no protection bypass, force push or auto-merge.
- CodeRabbit can review the new PR, but `reviews.finishing_touches.autofix.enabled=false` remains in `main`.
- Future reviewer should explicitly distinguish CODE-PASS from external HOST/POSTGRES/P13-WIRE NOT_RUN.

## Completion criteria

Task20 source package can be declared **CODE-PASS** after tests, independent review and normal CI. It cannot be declared **PHASE2_NATIVE_PASS**, **P13_WIRE_PASS**, **REAL_OPERATOR_AUTHORITY**, **GUEST_SEND_READY**, or **PILOT_LIVE** without the separate physical prerequisites and actual evidence. No change of this document or its statuses can confer authority.
