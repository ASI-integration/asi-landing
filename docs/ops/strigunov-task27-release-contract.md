# Task 27 — Owner review of deterministic release bytes (offline, synthetic)

**Verdict boundary:** code-only release integrity proof, **not** independent owner approval or a deployable custodian. No Hetzner account, API keys, service changes, billing, actual installer, privileged identity, consent or guest sends.

## Why this milestone exists

Tasks 19 and 21 proved actual synthetic PostgreSQL Phase1 and lost-COMMIT controls, while Tasks 22–26 separately prepared proposed host custody, cloud admission, offline broker replay model, physical local journal/IPC, and Linux `SO_PEERCRED`. PRs [#440](https://github.com/ASI-integration/asi-landing/pull/440) through [#444](https://github.com/ASI-integration/asi-landing/pull/444) were still open and unmerged when Task27 started. This task is an independent branch from protected `main` at `9bc8175aa772e92366c7a2363e26900a042fc3ce`; it does not import unfinished source, rewrite them or rename existing branches.

## Actual Task27 functionality

`scripts/acceptance/strigunov-task27-release.py` uses Python's standard library to create one **non-executable synthetic release** in a new random, owner-of-process-writable-only OS temporary directory. Exact deterministic USTAR member order:
- `manifest.json`: fixed source baseline, exactly two content digests and lengths, all live permission flags explicitly false and `phase2=BLOCK`
- `bin/custodian-placeholder.txt`: plain-text placeholder, not a program, script or service installer
- `config/custodian-placeholder.json`: synthetic configuration that forbids approval, send and cloud access

The manifest and both dummy member bytes are fixed in reviewed source. Their archive has zero timestamp and UID/GID metadata for reproducibility, mode 0600, and an exact SHA256 digest. The verifier takes an *externally supplied expected digest* and checks the exact physical `.tar` bytes, regular file, local process owner/mode, safe OS temporary root, member allowlist/order, metadata/permissions, manifest/dummy payloads and canonical serialization. It **never extracts or executes** an archive, creates a host service, or connects to PostgreSQL/network.

Tests must physically reject altered bytes even if the adversary recomputes a new digest, forged `canSend` claims, extra or duplicate entries, path traversal, absolute paths, symlink entries, wrong modes/owners/timestamps, oversize, truncated archive, unsafe directory permissions and symlinks. The correct fixture may return `EXACT_BUNDLE_BYTES_MATCHED_ONLY`, but every result still has `authorized=false`, `canInstall=false`, `canIssueReceipt=false`, `canApprove=false`, `canSend=false`.

**Critical:** a digest controlled by the same agent that created the archive is **not an owner signature**. This source-only check does not prove the actual operator approved the executable, that OS root owns it, that the service UID cannot rewrite it, that credentials are isolated, or that the release is safe to install. Future executable packaging must be built separately with independent owner-owned pinned artifact and verified physical host identity, deny rules, vault and real distinct-UID access checks.

## CI and deployment separation

The `.github/workflows/strigunov-task27-release.yml` workflow triggers only on a PR changing these four files, with `contents:read`, an unprivileged hosted Ubuntu 24.04 runner, no secret, signed-key handling, shell install, sudo, cloud or database calls. It uses only disposable temporary files and source checks. Existing mandatory PR `validate` and CodeRabbit independent review must pass. **No automatic merge**: `docs/agent-os/AUTONOMY_POLICY.md` treats main merge as a RED owner action requiring exact PR/branch/head authorization.

The two ASI production Hetzner servers in `Default`, `asi-runtime-hetzner` and `asi-landing-hetzner`, are excluded from this acceptance. No testing against them.

## Release plan after Task27 (not arbitrary task-count promise)

**Gate 28 — cross-task audit and consolidation:** reconcile PRs #440–#445 against protected main, check branch drift and conflicting assumptions, verify CI and CodeRabbit head states, identify any missing integrations and resolve under scope before proposing controlled merge. Do not treat separate green PRs as one passing executable system.

**Gate 29 — independent physical acceptance:** only on a separately approved and owner-controlled disposable cloud host with exact billing approval and immutable owner-reviewed binary/config; real separate UID and denied unauthorized client, protected durable ledger/IPC and verified bootstrap-role retirement, Phase2/revocation/consent synthetic native checks, deterministic cleanup. Production messaging requires a separate live authorization and proof. Additional tasks may arise from either audit; **27 tasks alone do not imply pilot readiness**.

Current permitted end state: `TASK27_SOURCE_TEST_PASS` when native PR checks pass. `OWNER_RELEASE_APPROVAL=NOT_PROVEN`, `CLOUD_CUSTODIAN_INSTALLED=NO`, `PHASE2_NATIVE=NOT_RUN`, `REAL_OPERATOR=BLOCK`, `GUEST_SEND=false`, `PILOT=NOT_LIVE`.
