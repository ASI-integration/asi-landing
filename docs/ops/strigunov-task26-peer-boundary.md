# Task26 — disposable Linux SO_PEERCRED security boundary (source + CI only)

**Status:** independent *kernel-observation test* candidate; NOT an independently installed custodian, broker service, authorized operator, or guest-send permission.

## What has actually been prepared

`scripts/acceptance/strigunov-task26-peer-gate.py` uses Linux `AF_UNIX` socket and `SO_PEERCRED` to obtain the actual kernel-supplied peer PID, UID and GID. It compares these to explicitly supplied *fixture expectations*. Caller JSON cannot override peer credentials, select the expected UID or confer permission. The listener is disposable, created only in a fresh temporary directory with mode 0700 and a local socket with mode 0600, and has no public TCP, network API, cloud connection, SQL, key store, subprocess runner or guest messaging. It strictly accepts one completed, bounded read-only JSON frame at connection EOF, three fixed inspection operation names, a pinned reviewed baseline and manifest hash. It **always** returns `authorized=false`, `canIssueReceipt=false`, `canApprove=false`, `canSend=false`, `canInstall=false`; even an observed kernel UID/GID match is not real operator permission.

The focused standard-library Python tests check kernel matches from a second process, deliberately mismatched expected UID/GID, forged client identity and `ownerApproved`, out-of-scope commands, wrong pinned hashes, missing/extra fields, arrays instead of strings, message fragmentation, double frames, malformed UTF8, incomplete newline, size bounds, non-root fixture execution, ownership and Unix socket permissions.

The PR-only GitHub workflow uses hosted Ubuntu 24.04, unprivileged UID, `contents:read` GitHub token, no secrets, no `sudo`, no `setuid`, no cloud changes or dedicated server. Its actual test result validates a real kernel peer-credential observation **on the runner**, not a physical custodian identity.

## Important limits

- The runner's current non-root UID and GID are supplied as the expected identity for the *positive test*. A wrong expected UID/GID is explicitly denied. However, the tests **do not** create two separate OS principals and do not test unauthorized access by another OS UID. That needs an independently controlled, pre-provisioned host or a separately approved privileged disposable lab; PR tests may not elevate untrusted code.
- A matching `SO_PEERCRED` identity is a useful building block, but it does not establish independently owned software, persistent state, trusted executable bytes, a secure installation, owner-only manifest, real guest consent or actual operator authority. A same-UID process could access this test socket. Root or an owner-controlled superuser could replace the service.
- Task25 [PR #443](https://github.com/ASI-integration/asi-landing/pull/443) physically proved ephemeral `fsync` and a socket fixture. It is still unmerged. Task26 is **independent**, forked from protected main SHA `9bc8175aa772e92366c7a2363e26900a042fc3ce`; no import of unfinished Task22-25 files, no changed production paths or migrations.
- Hetzner `Default` contains the existing `asi-runtime-hetzner` and `asi-landing-hetzner` servers. Do not use them for this test. The `ASI-Lab` project was empty in the user-supplied screen. No new server, subscription, token, firewall, Tailscale change or payment has been authorized.

## Required external trust gate — NOT RUN

Only after explicit owner approval of a separate isolated target, exact reviewed binary+manifest SHA, charging cap and test credentials **outside the agent** can a real owner-controlled custodian be installed. A future live acceptance must independently validate a different non-agent host UID, peer credential enforcement, effective Unix socket/DACL permissions, non-agent-writable binary and secret store, atomic fsync-protected ledger, unauthorized-principal denial, simulated crash/restart reconciliation, bootstrap role retirement and a tightly scoped single-use Phase2 technical receipt. Do not infer those checks from this source-only package. Phase2, real operator provenance, guest sends and Strigunov live pilot remain BLOCK.

## Publication

Exact four new files only: `scripts/acceptance/strigunov-task26-peer-gate.py`, `scripts/__tests__/strigunov-task26-peer-gate.test.py`, `.github/workflows/strigunov-task26-peer-gate.yml`, `docs/ops/strigunov-task26-peer-boundary.md`. Require focused CI + existing GitHub PR `validate` and CodeRabbit independent review. Repo policy `docs/agent-os/AUTONOMY_POLICY.md` classifies merge to `main` as RED, requiring separately scoped owner permission; no automatic merge, deploy or live send.

Exit classification is `KERNEL_PEER_FIXTURE_PASS` only if the real runner passes; `OWNER_CUSTODIAN_INSTALLED=NO`, `DIFFERENT_UID_DENIAL=NOT_PROVEN`, `PHASE2_NATIVE=NOT_RUN`, `REAL_OPERATOR=BLOCK`, `CAN_SEND=false`, `PILOT=NOT_LIVE`.
