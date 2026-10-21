# ASI Custodian — executable technical service v0

This archive contains a **real runnable Python 3.11+ Linux process**, not a placeholder. It is a **NO-AUTHORITY technical core**: there is **no operator issuer, real consent, production database, guest sending, cloud registration or secret vault** in this release. The manifest is deliberately **unsigned**.

## Running on a separately approved isolated Linux test host

Use a dedicated **non-root** OS user, a private state path owned by that user, and a matching unprivileged client UID/GID. Do not run against existing ASI production hosts. No `sudo` or cloud API key is required for the technical test.

After extracting the archive safely (using your own trusted extraction procedure and reviewing the manifest), commands are:

```bash
python3 asi_custodian.py init --state-dir /path/to/private-new-state --run-id strig-cust-123456789abc --peer-uid 1001 --peer-gid 1001
python3 asi_custodian.py serve --state-dir /path/to/private-new-state
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
