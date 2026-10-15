# Task33: IPC integration, synthetic only

Baseline PR459 `06fd22107f88328c1e5c3c19a0b90c688dbfd024`. No physical installation or owner authority.

`asi_custodian.py serve --enable-synthetic-policy-consult` opts into a distinct consultation operation on the existing accepted Unix connection. Without this flag it is disabled; normal status remains technical readback and every authorization flag remains false, Phase2 BLOCK. Technical append has its separate existing opt-in. Neither operation enables the other.

The service reads private canonical `policy-consult.json` from its technical state directory. Exact keys: schema=1, policyRoot (absolute separate private directory), publicKey (public Ed25519 PEM only), issuer, keyId, keySha256, host, archiveSha256. Provisioning is local, separately controlled, never an IPC request. Every consultation rechecks permissions, link count and exact config bytes. Config changes require explicit restart. The underlying boundary checks root identity, private files, checkpoint, signed policy, time, monotonic epoch, revocations and nonce history under its lock. Policy rotation remains local controller publication. No client publication/initialization operation exists.

Wire protocol: one canonical ASCII JSON object plus LF, at most8192 bytes; keys exactly `kind`, `op`, `runId`, `receipt`, `signature`. kind=`ASI_CUSTODIAN_POLICY_CONSULT_V1`, op=`consult`. receipt is a string containing the exact signed canonical bytes (maximum4096), signature is128 lowercase hex characters. Socket EOF terminates the request; existing bounded read deadline applies. Duplicate keys, noncanonical encoding, extra keys/frames, unsigned authority fields and invalid signatures fail closed. Legacy requests retain2048-byte cap.

Both the recorder configuration and signed policy must match the actual SO_PEERCRED UID and primary GID of the accepted connection. The policy journal is committed before `SYNTHETIC_OBSERVED` is returned. Lost acknowledgement never licenses retry execution: the nonce is consumed or the state is HOLD. No action executes. Legacy recorder journal and policy ledger are separate, not a distributed transaction. Stale sockets after crash require manual review; no automatic deletion is introduced.

## Capabilities matrix

| Component | Implemented technical capability | Authority / missing gate |
|---|---|---|
| Technical recorder | Private fsync journal, Unix kernel peer checks, status | No grants, no sends; append default-off |
| Durable policy boundary + IPC | Pinned Ed25519 snapshots, epochs, persistent revocations/nonces, synthetic consultation | Default-off, no live authorization; rollback/time NOT_ACCEPTED |
| Owner issuer | Public-key pin and signed envelope verification contract | Genuine independent issuer/key custody/enrollment unavailable; CI signer synthetic |
| Dispatcher | No Task33 modification or connection | No receipt issuance or dispatch permission from synthetic outcome |
| Native server | Service source, digest release, install/systemd/rollback recipe | asi-pilot-lab-01 not installed/accepted; SSH and exact approval unresolved |
| Production provider | No connection or credentials | Disabled; no real guest messages or external actions |

## Independent witness and trusted time: proposed interface, NOT implemented trust

Real authority must remain BLOCK even if an offline mock returns success. Current `rollbackProtection` and `trustedTime` always report NOT_ACCEPTED. No configuration switch can override them.

Future independently administered witness interface:

- `read_checkpoint(binding, challenge)` returns signed {binding, host, archiveSha256, epoch, policyDigest, sequence, ledgerHead, stateDigest, witnessRevision, previousWitnessHash, challenge, observedAt, validUntil, witnessKeyId}. The verifier pins a separately enrolled witness key and identity, validates exact signed bytes, challenge and bounded freshness with an independent clock.
- `compare_and_append(expectedRevision, previousWitnessHash, newCheckpoint, operationId)` is atomic and append-only; rejects rollback, equivocation, gaps and reused operationId with different payload. Exact same operation retry returns the same signed result. The witness must retain history outside the service/root administrator's control.
- `trusted_time(challenge)` returns an independently signed bounded time interval, challenge and monotonic issuer sequence. Failure, stale response, rollback, unknown key, wide uncertainty or disagreement with witness freshness yields HOLD. Local wall clock is never its substitute.

Proposed commit ordering: durable local pending intent -> witness compare-and-append -> store signed witness response + local checkpoint with fsync -> clear pending -> acknowledge. A crash/partition at any point requires readback matching the exact pending operation; disagreement or inability to prove append state is HOLD, never automatic replay. Policy publication and receipt consumption share this ordering and witness sequence. Restoring the complete local store must conflict with the newer independent witness; deleting local state must not bootstrap against a nonempty witness. Witness key rotation needs independent owner approval and old/new chain validation; rollback does not lower epochs or erase nonce history.

These are design requirements, not implemented network clients or accepted remote evidence. Current local checkpoint detects selective corruption; same-owner/root full-store+clock rollback remains outside acceptance. Local clock rollback above the last durable mutation can revive expiry. Hosted SIGKILL/fsync tests do not prove physical power-loss durability.
