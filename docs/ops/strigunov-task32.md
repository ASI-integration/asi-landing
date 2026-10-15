# Task32 acceptance boundary

Baseline PR453: 5fa6aa30f81f8eeecfd13cba14a56ed2da11efa4. Custodian source imported byte-for-byte from PR448: 313d00dc92014fb10866cca3c8e7fec0c2269598. Both remain unmerged. Existing branches/worktrees are preserved.

## Host gate

asi-agent-runner is visible in Tailscale but remains unapproved. Known-host strict SSH using the existing default admin identity returned publickey denial. No alternative identities or credentials were tried. Workload, tenancy, backup, exposure, capacity and no-cost VM feasibility remain UNKNOWN. Existing production landing/runtime is excluded. No physical installation is allowed by this task.

A realistic next option is owner-provided read-only access to an explicitly approved isolated host, or an existing disposable nonproduction VM with documented CPU/memory/disk quotas and backup ownership. GitHub-hosted CI provides temporary verification, not a persistent pilot host or independent owner attestation.

## Custodian provenance and offline preparation

The historical archive SHA256 d5054d8848dd7fd6c1cc0a9eb9b2e958be0677b80f5eaa5edc2335f94fff9a61 is preserved. Independent review found its service source lacks the journal capacity guard present in PR448. It must NOT be installed as the current source release.

Run build_release.py twice from the reviewed source, compare archive bytes and SHA256, then use --verify. No third-party Python dependencies. Python/OpenSSL runtime versions are runner dependencies, not claimed reproducibly pinned binaries. The archive contains the technical daemon and README, not owner authority.

protected_prepare.py verifies exact allowlisted archive bytes, a canonical Ed25519-signed manifest, source/digest/host binding, expiration and three distinct positive UID identities. It stages files ONLY with --synthetic-sandbox under a private owned directory as nonroot. It refuses existing targets, symlink ancestors and broad permissions. Files are 0400; this is accidental-mutation resistance, NOT immutable against their owning UID. It never creates accounts, systemd units, network rules or live credentials. There is deliberately no live install command.

Approval manifest fields: scope ASI_STRIGUNOV_SYNTHETIC_ONLY_V1, source pinned PR448 SHA, archiveSha256, host, serviceUid, clientUid, ownerUid, expires (within one hour), liveAuthority false. CI uses a temporary test issuer key, never a real owner receipt. Private keys must not enter release artifacts.

## Protected physical release plan — BLOCKED

The owner must first identify an isolated host, approve its precise identity and digest, and establish independent key custody. Proposed layout: owner/root-controlled read-only program/config/public key and approval; dedicated nonroot ASI-Strig-Custodian service; separate mutable private journal; independently owned monotonic checkpoint; separate IPC directory allowing only an approved distinct client identity. A narrow group socket requires explicit review and exact SO_PEERCRED enforcement. Existing technical daemon socket0600/state0700 cannot support a distinct-UID client and is NOT presented as this protected installation.

Before enabling service: verify owner signature, UID separation, ancestor permissions, resource quotas, backup restoration, default-off policy, bounded operations and audit retention. Review lifetime process locking and descriptor-relative journal operations; current daemon does not satisfy all physical gates.

Rollback: stop only the explicitly approved service under a separate owner authorization; preserve journal, pending intent and independent checkpoint; verify hashes before restoring a prior program; never rewind spent receipt state or silently delete a stale socket/pending intent. Unknown outcome stays HOLD until owner investigation. Sandbox cleanup deletes only the test-owned temporary directory; physical rollback is not executed by CI.

## Phase2 synthetic design tests

SyntheticGate accepts only signed observe_synthetic receipts bound to host/archive/clientUID/nonce/expiry/revocation epoch. Default-off, positive distinct client UID, serialized flock, durable intent before observation, fsync/hash journal, replay denial and restart HOLD are tested. It executes no commands and returns authorized:false and canSend:false even on success.

Peer UID is an injected design-test input, NOT kernel-verified IPC identity. Revocation state is supplied by the synthetic caller, not an independent live authority store. Same-owner valid journal rollback/rewrite is not detectable without an independent checkpoint. No protected live issuer, cross-UID physical IPC or owner-controlled native Phase2 is established by these tests.

## Booking acceptance

New task32 harness reuses the reviewed INTERNAL Docker network / exact-source / GitHub-hosted gates. Fresh ephemeral PostgreSQL17, PostgREST, real production Next application, real session decoding and account membership checks. Reservation creation uses the actual authenticated intake API; account/property/user setup remains explicit SQL fixtures. Twenty lifecycle variants extend the prior service scenarios with native intake. Legal, cleaning, inspection and provider signals remain synthetic. No outbound channel is reachable.

Evidence layers remain separate: API intake/operator/auth/persistence; service event processing and closeout; synthetic custody design; browser NOT_RUN; provider NOT_RUN; physical cleaning NOT_RUN. Sealed test cookies do not prove login issuance. Membership revocation tests database authorization, not cookie revocation.

Known remaining limits to assess: public intake consent contract absent; spoofable forwarded-IP quota and process-local retention; multi-write intake concurrency/recovery; optional schema dependencies. Do not count baseline Task29 checks again or convert these limits into PASS.

## Publication

Draft PR only, no merge/deploy. Retain RED logs and CI receipts. Exact SHAs and runtime counts belong in the final external Task32 result/matrix, with source pins for independently reviewed publication.

Custodian fault tests inject exceptions at durable boundaries; they do not SIGKILL a daemon. The technical archive excludes protected_prepare.py; the preparer and tests are versioned source companions.
