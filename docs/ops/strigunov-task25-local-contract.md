# Task25 — Disposable fsync journal + local-only IPC test fixture

**Scope:** real ephemeral file I/O and Unix socket test on a GitHub-hosted CI runner. **Not** a cloud custodian, independent security principal, deployed service, or operator authority.

## Baseline and dependency truth

Protected main `9bc8175aa772e92366c7a2363e26900a042fc3ce`. Task22 [PR #440](https://github.com/ASI-integration/asi-landing/pull/440), Task23 [PR #441](https://github.com/ASI-integration/asi-landing/pull/441), and Task24 [PR #442](https://github.com/ASI-integration/asi-landing/pull/442) are separately open and unmerged. Task25 is a new isolated branch from main and **does not import or rename** these pending files.

Screenshots from 2026-10-14 show two green ASI production machines in Hetzner project `Default` (`asi-runtime-hetzner`, `asi-landing-hetzner`), while `ASI-Lab` is empty. We must not touch or test those live servers. The user does not need to log into Hetzner for this task. No API tokens, billing, cloud project, or VPS creation.

## Real physical fixture, with narrow claims

`scripts/acceptance/strigunov-task25-local-ledger.mjs` uses **an entirely fresh randomly named directory under the OS temporary directory**, validates the real path and rejects symbolic links/foreign paths. Creates exclusive `identity.json` and `events.ndjson` files; synchronizes their bytes and (on POSIX) the directory. Each accepted event is append-only and is `fsync`ed **before success is reported**. It is chained to the preceding SHA256 and includes one allowed sequential synthetic command and a unique hex request ID. The journal is read and validated afresh inside an atomic exclusive `writer.lock` directory before each event. A crash that leaves a writer lock blocks further writes until manual owner investigation; the fixture never auto-steals stale locks.

Accepted commands in order: inspect-owned-host, verify-immutable-release, read-technical-phase1, verify-operator-revocation, readonly-reconcile, stop-owned-lab. All are **fictional observations**, never an actual host/SQL/guest action. A simulated denied or unknown-COMMIT result is durably recorded as HOLD; no automatic retry, reconciliation release or permission grant is available.

`scripts/acceptance/strigunov-task25-local-ipc.mjs` offers an **unauthenticated test-only** Unix domain socket at a new fixture path with mode 0600, one size-limited JSON frame per connection, no network listener, no external endpoint, no secret, no SQL, and no operator-specific service. This file is evaluated physically on **Linux GitHub Actions** only. Mode 0600 **does not** prove host-independent identity, effective ACLs against all principals or resistance to a same-UID/root actor.

`scripts/__tests__/strigunov-task25-local-ledger.test.mjs` physically checks file reopening, crash after fsync before a reply, a race between two independent Node processes (exactly one wins), malformed/torn journal, mutated hash chain, stale writer lock, idempotency/replay denial, malformed envelope, and one Unix socket request+duplicate (Linux only). Every test owns and cleans its exact unique OS temporary directory. The source repository remains unchanged by test execution.

## Significant non-proofs and deployment prerequisites

- File hashes **detect accidental corruption**, not active replacement by an attacker able to edit both the journal and the metadata.
- The in-test mock actor supplies `OBSERVED`; no independently owned authority verifies those observations. A true custodian must separate host administrator and agent and prevent untrusted changes to the binary, ledger, keys and deployment manifest.
- The demo journal is not a multi-host durable database, and the Unix socket is not an authenticated production IPC. Same-UID/root compromise is outside this fixture. No real Phase2 native PostgreSQL role, session or receipt is created.
- A crash during an append may leave a partial line and must HOLD; recovery must not truncate history or silently release a stale writer lock. Crash after fsync but before client response is tested, but not independent end-to-end host durability under power loss.
- Windows file creation and fsync of files can be locally source-tested, but POSIX directory fsync and Unix socket proof must run on the Linux CI fixture; it is **not** installed on the user's Windows laptop or Hetzner.

## Host-controlled deployment gate (later only)

The owner must regain access to a **separately controlled** cloud environment and approve exact target ID, cost, physical service account, reviewed executable digest, non-agent-owned durable state, authenticated IPC and true unauthorized-principal denial. Only after independent physical attestation should we run a new fully synthetic Phase2 PostgreSQL acceptance with bootstrap grants retired and revocation tested. Real guest consent and send remain blocked. Do not reuse production hosts or expose SSH/API tokens to this source-test workflow.

## CI and merge policy

Dedicated PR-only GitHub Actions job has `contents: read`, GitHub-hosted Ubuntu, no secrets/environments/production, no hosted DB and an eight-minute timeout. Existing PR Validation remains required. Any merge to protected `main` is a separate red action requiring explicit exact PR/head owner approval under `docs/agent-os/AUTONOMY_POLICY.md`. No auto-merge, live deployment or running service is part of Task25.

**Exit:** `LOCAL_SYNTHETIC_FS_TEST_PASS` possible with genuine Linux evidence; `CUSTODIAN_INSTALLED=NO`, `REAL_OWNER_AUTHORITY=BLOCK`, `PHASE2_NATIVE=NOT_RUN`, `canSend=false`, `PILOT=NOT_LIVE`.
