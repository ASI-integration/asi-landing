# Durable synthetic Phase2 boundary

Baseline PR458 /79a6192d53831ff3fe1119683871daa204cde87b. This implementation remains synthetic and cannot authorize installation, approval, issuance, guest messaging or production. The technical IPC daemon is unchanged. No real owner issuer is available.

## Trust and interfaces

`Boundary` is a separate library boundary, not a production authority daemon. Provisioning pins the public key bytes and SHA256, issuer, key ID, host and technical archive digest. The signing private key is absent. Only Ed25519 canonical signed snapshots with scopeASI_DURABLE_SYNTHETIC_V1,liveAuthority=false and actionobserve_synthetic are accepted. Unknown key rotations are rejected; rotation under the same pinned key requires increasing epoch. Real key enrollment/transition is unavailable.

`publish(raw,signature)` is a local controller operation: verifies signature, exact schema/pins, clock, lifetime, UID/GID, sorted bounded revocation list, monotonic epoch and same-epoch non-equivocation. It stores signed bytes with the durable replay state under one lock. No IPC caller supplies the current epoch or revoked status to consumption. Revocations accumulate; no tombstones are pruned.

`attest()` is an auditable READ-ONLY diagnostic of validated current policy digest/epoch/expiry/counts. It writes nothing and is NOT a signed owner attestation. Missing, corrupt, expired or unresolved state raisesHOLD. No key, receipt or private contents are returned.

`consume(accepted_unix_socket,receipt_bytes,signature)` extracts realSO_PEERCRED from the socket. A signed receipt binds issuer/key, host/archive, exact epoch+policy digest, clientUID and primaryGID, action, issued/expiry, monotonically next sequence and unique nonce. Lifetime is at most60seconds and cannot exceed policy expiry. All success replies still haveauthorized/canInstall/canApprove/canSend/canIssueReceipt=false andPhase2BLOCK. No commands or external effects are executed. Fault hooks are local test hooks, never request fields.

## Durability and concurrency

Explicit initialization requires an empty private directory and enabledsynthetic mode. Missing operational state is never recreated. Private files, symlink-free paths, ownership, exact modes, hardlinks, bounded reads, trusted ancestry, immutable lock inode and directory identity are checked. One nonblocking flock serializes policy publication, consumption and diagnostic reads. BUSY means retry, not permission.

State contains the signed policy envelope, highest epoch, cumulative revocations, hash-chained nonce/sequence journal and last committed wall time. A separate state digest checkpoint detects selective state rollback/corruption. Before any recorded synthetic observation, a durable pending marker isfsynced; state and checkpoint replace atomically and each directory update isfsynced; pending clears last. Any interrupted transaction before clearing remainsHOLD, with no automated repair. Crash after clear/before acknowledgement leaves a consumed nonce; retry is denied. Publication and consumption linearize under the same lock; a completed revocation publication precedes and blocks later consumption.

Clock regression below last committed wall timeHOLDs. Read-only diagnostics and failed requests do not advance this high-water mark. Consequently rollback to a time above the last mutation can revive an expired snapshot; general rollback-resistant time is NOT proved. An independent trusted clock is a prerequisite for any future live authority. Whole-store+clock rollback by the state owner/root is NOT detectable without an independent monotonic checkpoint. Restoring the complete snapshot could restore consumed nonce state; this is precisely why live authorization remains disabled. Filesystem fsync tests prove application ordering on ephemeralLinux, not physical power-loss durability.

The local controller owns state; separate-process UID isolation of the signer is demonstrated only with root-owned synthetic key fixtures in ephemeralCI. The library is not represented as a fully deployed independently administered authority service. Real production IPC integration, externally protected checkpoint/issuer enrollment, signer custody and physical host acceptance remain open.

## Tests and release

Focused suite covers policy/receipt signatures and binding, epochs/equivocation, expiry, replay/restart, persisted revocation, corruption/missing files, permissions/links, lock replacement, concurrency/rotation and four actualSIGKILL transaction positions. A second hosted-only harness uses existingrunner/nobody identities, actual accepted sockets, and proves the root-owned synthetic key is unreadable to both. No accounts/services/packages are installed. Existing43 IPC/protected preparation tests remain regression gates.

The technical archive includesdurable_policy.py but remains non-installing and non-authorizing. Exact final commit, run IDs, counts, archiveSHA256 and owner host runbook are recorded outside the archive after CI to avoid self-referential digest pins. No genuine owner policy or signature is produced by this sprint.
