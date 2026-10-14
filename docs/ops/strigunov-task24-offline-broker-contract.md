# Task24 — Offline custodian protocol preview (no Hetzner login)

**Status: CODE-ONLY SOURCE CANDIDATE.** No real cloud custodian, durable ledger, receipt issuer, operator session, or live guest send exists.

## User decision and baseline
The owner cannot currently log in to Hetzner, explicitly postpones access restoration, project creation and all billed provisioning. Continue development using only source/test/PR tooling. Do not ask for login, tokens, passwords, Tailscale changes or API access during Task24.

Protected main baseline: `9bc8175aa772e92366c7a2363e26900a042fc3ce` (Task21). Separate pending PRs [Task22 #440](https://github.com/ASI-integration/asi-landing/pull/440) and [Task23 #441](https://github.com/ASI-integration/asi-landing/pull/441) remain unmerged. Task24 uses a **new independent branch from protected main**: it does not copy pending PR files, change existing worktrees or rename branches.

## What Task24 actually implements
`scripts/acceptance/strigunov-task24-offline-broker.mjs` is a **pure offline protocol simulator** (no imports or I/O). It is not a hosted broker, and its ledger is deliberately not an authoritative persistence system.

- Strict synthetic request envelope with fixed, versioned keys: source SHA, 64-digit manifest digest, run ID, sequence, unique request ID, exact command, clock window and observation classification.
- Fixed read-oriented command vocabulary: inspect-owned-host → verify-immutable-release → read-technical-phase1 → verify-operator-revocation → readonly-reconcile → stop-owned-lab.
- Ordered transitions, one sequence at a time; reject duplicate IDs, gaps, stale/foreign run, manifest mismatch, unsafe commands, malformed JSON, extra keys and exceeded TTL. There is no arbitrary SQL, shell, file path, callback or credentials.
- If an outcome is `COMMIT_UNCERTAIN` or `DENIED`, the preview becomes `HOLD`. Later read-only reconcile / simulated cleanup cannot silently release HOLD, and repeated writes or automatic retry remain forbidden.
- JSON-serialized preview checkpoint inspection/reload is **not durable replay protection**. An untrusted caller can roll back or forge that JSON. A real custodian needs an *independently owned, atomic, fsync-proven persistent consumed-ID/sequence ledger* across crash/restart and concurrent sessions. Do not use this source module in a production decision path.
- All outputs `authorized=false`, `canIssueReceipt=false`, `canInstall=false`, `canSend=false`, `canAccessProduction=false`. `PREVIEW_ADVANCED` and `SHAPE_ONLY` mean only source validation, not a completed host operation.
- `docs/ops/strigunov-task24-cloud-handoff.json` is a deliberately **non-executable** deployment-planning manifest; project/server IDs are null, existing production and live guest access remain false.

## Tests and CI
`scripts/__tests__/strigunov-task24-offline-broker.test.mjs` covers fixed ordering, invalid requests, replay and gaps, TTL, restart/caller checkpoint rollback, unknown COMMIT lock, read-only HOLD handling, transport/operation scope and no I/O, with one focused test file. `.github/workflows/strigunov-task24-offline-broker.yml` runs only on PR changes to this package with read-only token, isolated hosted runner, no cloud/secret/network/SQL/production steps. Existing repository `validate` and PostgreSQL checks still run through normal required PR CI.

## Deployment preflight — future, not executed
After the owner can log into Hetzner again, independently verify:
1. Isolated empty owner-controlled project, owner-confirmed billing and cloud scopes. Do not reuse production project/server.
2. New separately approved disposable server with no agent-held provider keys, SSH root, cloud console or owner-level control. Restrict ingress and egress; owner separately verifies Tailscale ACLs. Connection is **not** authorization.
3. Pinned reviewed non-root executable and config, protected secret state, authenticated narrow IPC and owner-only replay ledger with tested crash/restart recovery and unauthorized-principal denial.
4. Verify no production routes, credentials, databases, real messages, external provider sends or billing changes are connected to the synthetic lab.
5. Separately review exact cloud/host ID, service PID/UID, source hash, fresh window, PostgreSQL cluster identity, retired bootstrap privileges and actual native Phase2 revocation/consent barriers **before** any real custodian-generated one-use receipt.
6. Any uncertain COMMIT or unresolved ledger state stays HOLD; independent read-only authoritative reconciliation is required.

Historical technical evidence: [Task19 native Phase1](https://github.com/ASI-integration/asi-landing/actions/runs/38573727019) PASS and [Task21 actual wire fault](https://github.com/ASI-integration/asi-landing/actions/runs/38582427316) PASS, **not** real operator proof or live guest approval.

## Explicit authorization gates
- **No main merge** of this PR without exact owner approval per `docs/agent-os/AUTONOMY_POLICY.md`.
- No account, cloud project, server, billed resource, firewall/Tailscale, runtime process, vault, RLS role, real data, secrets or guest sends in Task24.
- Only after independently verified owner-custodied live host and operator provenance can a **separate** native Phase2 acceptance be designed. Never treat source-only tests, GitHub CI, a signed-looking JSON or this document as authority.
- Task24 can close as `SOURCE_TEST_PASS` while `CLOUD_HOST_NOT_INSTALLED`, `REAL_AUTHORITY_BLOCK`, `PHASE2_NOT_RUN`, `GUEST_SEND_BLOCK` and `PILOT_NOT_LIVE` stay true.
