# ASI Custodian — executable technical service v0

This archive contains a **real runnable Python 3.11+ Linux process**, not a placeholder. It is a **NO-AUTHORITY technical core**: there is **no operator issuer, real consent, production database, guest sending, cloud registration or secret vault** in this release. The manifest is deliberately **unsigned**.

## Running on a separately approved isolated Linux test host

Use a dedicated **non-root** OS user, a private state path owned by that user, and a matching unprivileged client UID/GID. Do not run against existing ASI production hosts. No `sudo` or cloud API key is required for the technical test.

After extracting the archive safely (using your own trusted extraction procedure and reviewing the manifest), commands are:

```bash
python3 asi_custodian.py init --state-dir /path/to/private-new-state --run-id strig-cust-123456789abc --peer-uid 1001 --peer-gid 1001
python3 asi_custodian.py serve --state-dir /path/to/private-new-state --enable-technical-append
# from a separate terminal under the approved test client user:
python3 asi_custodian.py client --state-dir /path/to/private-new-state --op status --seq 0 --id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --result NONE
python3 asi_custodian.py client --state-dir /path/to/private-new-state --op append --seq 1 --id bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --result OBSERVED
```

The example UID/GID and path must be replaced with **independently verified values** before any actual host deployment. Do not create accounts, grant root access or select a real host based on these examples. The `append` operation saves a **synthetic technical observation only**. Setting `result=UNKNOWN` permanently enters `HOLD`: no automatic release or replay.

## Actual guarantees implemented

- Local Unix domain socket only, mode 0600; process must be non-root Linux.
- Every request is checked against kernel `SO_PEERCRED` UID/GID, strict JSON keys, fixed status/append operations and a checked run ID.
- Sequential journal with unique request IDs, hash linkage, file `fsync` before technical success, duplicate denial, persisted HOLD on unknown outcome, readback after restart.
- One connection at a time, bounded frame read and wall-clock timeout, no arbitrary SQL, shell commands, network send or operator credential issuance.
- Private state directory and private files; no overwrite on initialization, no symlinked state, no automatic deletion of uncertain journal entries.

## Important limitations

This is **not an owner-installed protected custodian**. Caller-provided expected UID/GID and the source manifest are not independently attested. A process with the same OS UID, or root, can potentially edit the configuration and ledger; hash linking is not a cryptographic owner-signed log. Directory and socket access restrictions are not proof of actual separately owned service custody.

No real Phase2, revocation, restricted owner-issued receipt, separate-UID unauthorized-client physical acceptance, live guest consent or production readiness is claimed. The archive is a Python source executable, not a static native binary or an installer; its SHA256 only checks bytes and does not confer approval or trust.

**Do not install on `asi-runtime-hetzner` or `asi-landing-hetzner`.** Use a separately owner-approved isolated nonproduction host only after independent identity, price and deployment review.


## Finishline hardening (successor to PR448)

This source is a hardened successor, not byte-identical PR448. CI records its exact commit and newly rebuilt archive SHA256. The protected synthetic preparation manifest `source` now binds SHA256 of the daemon source bytes, not the historical PR448 commit; old manifests are rejected. The daemon defaults to status-only; synthetic journal appends require `serve --enable-technical-append`. This flag grants no owner authority. A lifetime exclusive lock prevents concurrent daemons; socket cleanup is restricted to the bound inode. SIGKILL retains a stale socket for manual review; never delete it automatically. The sourceBase config field is historical protocol compatibility, not the current release SHA.


# Synthetic cross-UID IPC candidate

This directory is an isolated review candidate. No existing worktree or host installation is changed. `asi_custodian.py` preserves default private same-UID operation and adds opt-in `serve --ipc-dir`.

The separate IPC directory must already be owned by the service UID, have the configured client primary GID and exact mode `2710`. Its setgid bit gives the socket that group; the socket is `0660`. Clients cannot replace entries because they have no directory write permission. State remains service-owned `0700`, files `0600`; neither state nor IPC directory may contain the other. Directory identity is rechecked per accepted request. Configuration changes cause live requests to HOLD; an explicit restart applies the changed peer configuration.

The existing CLI `client` remains a private-state same-UID diagnostic. Cross-UID callers use the bounded documented JSON wire protocol with an explicit synthetic run ID; the tests do not read service configuration as the client.

## Isolated GitHub-hosted Linux command

After source review, run from scripts/custodian on an explicitly approved disposable GitHub-hosted Linux runner with its existing nonroot runner account and existing `nobody` account:

```sh
sudo --preserve-env=CI,RUNNER_ENVIRONMENT,STRIGUNOV_SYNTHETIC_ONLY python3 cross_uid_acceptance.py
```

The job must set `CI=true`, `RUNNER_ENVIRONMENT=github-hosted`, and `STRIGUNOV_SYNTHETIC_ONLY=YES`. The test verifies these, requires `SUDO_UID`/`SUDO_GID`, and uses only existing identities. Root supervises bounded subprocess identity changes and a fresh temporary directory; the actual daemon and IPC clients run nonroot. No accounts, groups, packages, services, network interfaces or persistent host settings are created. Do not run on the physical owner host or production.

Seven tests cover a real distinct-UID positive read, default-off append, denied private-state reads, wrong primary GID despite supplementary socket-group membership, wrong UID, live configuration change HOLD and restart denial, persisted replay denial, stale socket refusal after SIGKILL, and unsafe writable IPC permissions. These are seven test methods with multiple assertions, not separate claimed test counts for every assertion.

Configuration-change tests prove local fail-closed configuration continuity, **not** signed issuer revocation, durable epoch enforcement or independent owner authority. Same-UID/root rollback, physical reboot/power-loss durability, host attestation and owner-key custody remain unproven. SyntheticGate is not integrated into this IPC service. All replies remain non-authorizing with Phase2 BLOCK.

Runtime results are recorded separately against the exact commit SHA; these instructions do not claim installation or authority.
