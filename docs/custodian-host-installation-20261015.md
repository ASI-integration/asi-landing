# asi-pilot-lab-01: gated technical installation and rollback

Target:ASI-Lab / asi-pilot-lab-01 /65.21.249.108. Authenticated SSH is UNAVAILABLE. Nothing in this sprint installs on that host. Do not retry alternate identities, replace keys, disable host verification, or use a console workaround to evade this gate.

Artifact:asi-custodian-technical-v0.tar
SHA256:0e9c10a9f529f9b95fae2795194485d7564569a745e9833f5a377ea2520b9941
This is a technical archive, not owner approval or a live-authority installer. Obtain only from the exact reviewed GitHub CI artifact; reject any digest mismatch. Linux CI must confirm this digest before use.

1. STOP until owner identifies this exact host, confirms nonproduction scope, supplies approved administrative access and host-bound approval of the artifact digest. Record independent owner/service/client identities and UID/GID separation. No synthetic CI signature substitutes for this approval.
2. Authorized administrator verifies archiveSHA256 with `sha256sum asi-custodian-technical-v0.tar`, inspects the allowlisted members and stages read-only code in a new versioned release directory. Use the reviewed build_release validator from the exact PR revision; never execute downloaded unverified code asroot. Do not overwrite a running release.
3. Provision dedicated nonroot service/client identities only under separate host approval. Private state must be service-owned0700, files0600; separateIPC must be service-owned2710 with the approved client primaryGID and socket0660. Do not broaden private-state permissions. Owner private key remains independently controlled and absent from this host.
4. Start only the technical recorder as the nonroot service with explicit state and IPC paths; append remainsOFF. The new durable-policy library is not wired to a production authority endpoint. Do not initialize it with CI keys on the real host or enablePhase2. All authorization/send/install/approve flags must remainfalse.
5. Run host-local synthetic acceptance only after scope approval: correct/wrong kernel UID/GID, private-vault denial, default-off append, graceful restart/replay, configchangeHOLD and stale-socket refusal. Record host identity, source/archive hashes, actual credentials and logs. Do not translate hosted CI success into physical host acceptance. Keep real keys, policies and guest data out of test output.
6. Rollback:stop the newly introduced technical process, preserve private journal/pending/checkpoint state and logs, and select the previously approved release if any. Do not erase replay state, lower epochs, clear pending markers or restore an older complete authority store. If no previous approved installation exists, leave service stopped. Archive rollback never authorizes policy rollback.

Remaining gates after technical installation:independent owner issuer enrollment, authenticated policy administration/IPC integration, trusted time, external monotonic checkpoint, full-store rollback resistance and physical durability acceptance. Until these are established, realPhase2 remainsBLOCK.
