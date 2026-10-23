# S4-G1 bounded host activation candidate

Status: source candidate; **NOT INSTALLED / NO AUTONOMOUS E2E PASS**.
Base: `b27b07bfffb317ec9a93caf6361d54956a7f12ae`.

## Exact scope

The dispatcher keeps optional PR #520 failures visible without blocking unrelated
mandatory work. Failed mandatory dependencies and uncertain source ledgers still
block. `enginePilot:true` admits one existing-file work order, dependent on the
exact merged #509. It never accepts physical G1 or opens G2.

The pilot adds `test_receipt_replay_flag_requires_literal_false` to the existing
`scripts/strigunov4/test_c4_unit_readonly.py`. It verifies that only literal false
is accepted for `replayAllowed`; booleans, numbers, null, strings and containers
cannot substitute for that exact field. New files and YAML remain forbidden.
The complete checkout is inventoried, including the one oversized existing PNG,
which has a fixed size/hash and no write admission.

`host-package.mjs` builds the actual runner candidate, exact catalog, transitive
module set and SHA256 manifest. Run with repository, original runner, new output
directory and exact base SHA. It refuses an unexpected original runner.
The generated runner changes only its main loop call and adds one import. It
retains the 30-second loop and existing ExecStart; the publisher retains durable
180-second polling. The old publisher is not called and legacy state is frozen.
There is no second daemon, legacy fallback or automatic state migration.

## Protected activation envelope — not yet issued

`/etc/asi-github-engine/owner-public.pem` is an Ed25519 public verification key.
`activation.json` contains `{payload: <exact JSON string>, signature: <base64>}`.
The signing private key is operator-controlled, never available to the runner.
All authority files and ancestors must be root-owned and not group/world writable.
Removing or changing the signed artifact blocks subsequent ticks, including after
restart. No unsigned template is treated as owner approval.

The signed payload must contain:

- `schema: asi.engine-activation.v1`, repository `ASI-integration/asi-landing`;
- host `asi-agent-runner`, service `asi-strigunov-agent.service`, stage `S4-G1`;
- root `/home/project_ayfaar/asi-strigunov-agent/engine`;
- legacy directory `/home/project_ayfaar/asi-strigunov-agent/state`;
- exact `baseSha`, generated `runnerSha256` and byte-exact `catalogSha256`;
- real owner approval reference, `notBefore`, `expiresAt`;
- `automaticCiApproved: true`, `automaticReviewApproved: true`;
- `githubApp: {appId, installationId}` matching the dedicated installation;
- policies `validate` workflow 311380800 and `release_governance` workflow
  390653294 with explicit `event: pull_request_target` for governance only.

`catalog.json` is the generated single-task catalog, not Issue/PR text. Runtime
authorization binds its exact bytes, repository, SHA, branch, paths and four
publication operations. Operation identity remains stable across waiting/restart.

The app key is `/etc/asi-github-engine/github-app.pem`, readable by the service
group but root-owned, never logged. The dedicated App has selected-repository
access only to repository ID 1167177589; effective permissions must be exactly
metadata read, contents write, pull requests write, actions/checks/issues read.
Token minting explicitly restricts repository and permissions and checks the
effective repository list. No PAT fallback. Token renewal cannot clear a poisoned
publication transport or durable FAILED_LOCKED state. Revocation is supported by
`createAppTokenProvider().revoke()`; it must be verified in the protected preflight.
Reference: https://docs.github.com/en/rest/apps/apps

## One installation / reverse-switch operation

Prepare the root-owned authority and app registration only after exact owner
approval of this source revision, generated manifest, secret paths and permissions.
No private key is to be pasted into chat. Preserve existing owner evidence.

Before switching, on `asi-agent-runner`:

1. Verify every manifest hash, actual main SHA, GitHub scope and owner expiry.
   Verify runner old hash `afbac44ff351d7c929e20886b6739bef97e302eb28f89d344902a9364e1d98e8`,
   autopilot hash `760f308d25aa5056181b560a9cc8416c2b19b5e9b35a8f2c78434446c9a187af`,
   unit hash `445224541d1eed211a92fd25894a7a1268d3d103fb4936c43254da275bdf2655`.
2. Install the reviewed bubblewrap prerequisite if absent. Rehearse the fixed
   `sandboxArguments` check on the actual host under the service UID. Prove no
   host home, credentials or network are exposed. A missing/blocked sandbox is
   a stop condition, never a reason to run the test without isolation.
3. Verify the ephemeral Codex process with tools disabled and exact-delta output;
   verify CodeRabbit will review the eventual Draft PR. This source patch adds
   `reviews.auto_review.drafts: true` to `.coderabbit.yaml`, retaining the disabled
   autofix setting. It must be owner-merged before the real pilot. This enables
   ordinary draft reviews repository-wide; no duplicate manual review is requested.
   After that merge, rebuild the catalog against the resulting exact main SHA;
   the b27b07b baseline catalog is then stale and must not be signed or run.
4. Prepare an independent detached full scratch clone at signed base SHA, mode
   0700, in a new private preparation directory **outside** the engine root.
   Never copy credentials or use a linked worktree. Do not create engine/state,
   engine/reports or engine/scratchpads before initializeState.
5. Stop **only** `asi-strigunov-agent.service`. Verify legacy receipts are all PASS,
   no in-flight legacy ledger/journal/lock, and preserve hash-verified backups.
   Save the exact legacy witness. Initialize new engine state once with the
   verified live admission; never initialize over existing files or clear locks.
   Only after successful initialization, move the verified detached clone into
   `engine/scratchpads/g1-receipt-replay-20261022` and create private engine/review.
6. Install the manifest's modules under `bin/engine/`, preserve a new exclusive
   backup of runner, atomically replace only `bin/runner.mjs`, fsync file and
   directory, then restart **only** `asi-strigunov-agent.service`. No unit edit,
   `daemon-reload`, physical staging, production, Sentinel or database action.
7. Read back runner/unit/autopilot hashes, service identity/ExecStart, engine state
   and legacy witness. On installation failure, stop the same service, atomically
   restore the exact runner backup and restart it. Preserve all engine state,
   reports, remote identities and credentials for explicit revocation/reconciliation.
   Never restore an old engine ledger or replay an uncertain publication.

These steps are one bounded protected package, not authorization to execute it.
The exact App IDs, signature/approval and live sandbox/reviewer evidence are not
present yet. A change in base SHA requires a freshly built and approved catalog.

## Verification and honest limits

21 dispatcher tests and 12 focused host integration tests pass, plus the pilot's
one real Python unittest on the full pinned checkout. The tests include signed
scope/tamper/expiry denial, fake live admission denial, excessive App permissions,
review stream/tool-use rejection, new-file/YAML denial, actual process SIGKILL,
lost-response freeze, orphaned legacy-lock denial, restart/no duplicate and terminal idle.
The existing unprivileged multi-job CI also runs the host integration file;
its permissions, triggers and protected-environment behavior are unchanged.
GitHub protocol integration uses a loopback fixture, explicitly not a real PR.
The current local runtime cannot execute bubblewrap network namespaces; the
target host has no bubblewrap binary yet. Therefore live sandbox acceptance,
App identity/revocation, installed service integration and actual GitHub
publication remain UNVERIFIED. Existing 83 Publisher tests were not repeated locally.

The actual ephemeral Codex reviewer was exercised on Hetzner, with the tool
features disabled and no inherited GitHub credentials. Its 7.2-second review
returned PASS/no findings for base b27b07bfffb317ec9a93caf6361d54956a7f12ae and
delta `19158171dc757db19156d0e73049772a494f5962afb997fba15b027eea8c6599`.
The captured event stream passed the production parser with evidence ID
`codex-38d6462ff3c1cb6f01a70b08d18d168049c1d1137ad2babe`.
The parser tolerates only the exact observed pre-turn notice confirming that
Code Mode is disabled; unknown errors, in-turn errors, duplicate notices and
tool execution still fail closed. Review must run afresh on the post-merge base.

The three initial CodeRabbit findings are addressed: signed App/CI policy
validation, immutable full-checkout test base with history available in CI,
and actual seeded-existing-YAML rejection with the exact expected error.

An actual separate ephemeral Codex review of this package found one installation
ordering defect (scratchpads before initializeState). It is corrected above by
initializing first; no initializer/recovery guard was relaxed. The full-checkout
integration test follows that same order. Isolated atomic runner replacement and
restoration from an exclusive backup passed with byte-exact readback. The final
runner candidate SHA256 is
`a1f722441610728e7018b5c46103656fa64c6fc8586decf85a90572f1e766495`.

Only actual server-created PR + exact-head CI/CodeRabbit + durable verified receipt
and post-restart no-duplicate/idle evidence can produce AUTONOMOUS E2E PASS.

## 2026-10-23 first-start incident: confirmed repair, NOT deployed

This section supersedes the historical host-readiness statements above. Baseline
main is `955ea53b2135c7fe1633ed3ae571ea1cc8b8d9a1`. First live PID 1886767
prepared the one approved file at 10:36:49 UTC (13:36:49 Moscow) and recorded
`FAILED_LOCKED / UNHANDLED_OR_UNKNOWN_RESULT` at 10:36:50 UTC. The service was
stopped; no pilot branch, PR or publication-intent journal was found. Existing
live state and legacy witnesses must remain byte-for-byte intact.

### Root cause and discriminating reproduction

The installed `host-checks.mjs` SHA256 is
`c42956e7c0a8c39f2f4373433886dae479913bd9c9631cdba1599712bad49e24`.
Its `sandboxArguments()` line 19 requests `--proc /proc`. With the service's
`ProtectKernelTunables=yes`, the parent procfs contains protected mounts, and
the nested unprivileged bubblewrap procfs mount fails:

```text
bwrap: Can't mount proc on /newroot/proc: Operation not permitted
```

The real `createHostChecks().runChecks()` reproduced `HOST_PROCESS_FAILED` at
baseline `host-checks.mjs:27:31`. The existing outer `state.mjs` catch records
`UNHANDLED_OR_UNKNOWN_RESULT` instead of unsafe raw subprocess output. This is
the exact failure mechanism reproduced with the installed source and the pilot;
the original live stderr was not retained, so there is no historical stderr claim.

Host evidence directory (outside live state):
`/home/project_ayfaar/asi-engine-preflight-955ea53-20261023/incident-systemd-elj0dly_/`.
`systemd-result.json`, `controls-result.json` and `fixed-result.json` retain the
properties, stderr, exit codes and fixed-module hash. The probes are finite,
collected transient test processes, not a second runner; the real service stayed
inactive/PID 0. They use copied source and scratch data, `PrivateNetwork=yes`,
an empty inherited environment and inaccessible live/App/config paths. No real
GitHub or Codex provider is connected to these reproduction processes.

Reproduce using `probe-controls.mjs` in that directory and its recorded transient
unit properties: service UID/group, UMask 0077, NoNewPrivileges, PrivateTmp,
PrivateDevices, ProtectSystem=strict, ProtectKernelTunables, ProtectKernelModules,
ProtectControlGroups, RestrictSUIDSGID, LockPersonality, SystemCallArchitectures,
MemoryMax=1200M and TasksMax=80. Only the isolated probe root is writable; live
root and `/etc/asi-github-engine` are inaccessible. The approved Python test,
its input bytes, subprocess timeout and bwrap arguments otherwise match runtime.

| Isolated variant | Result |
| --- | --- |
| Original arguments, all service protections | bwrap exit 1; `HOST_PROCESS_FAILED` |
| Original arguments, only test process ProtectKernelTunables=no | 1 Python test PASS |
| No procfs mount, all original protections | 1 Python test PASS; real `runChecks` PASS |
| Fixed sandbox access checks | no procfs, host home, App credentials or non-loopback interface; worktree read-only |

The second row is a diagnostic control only, never a proposed service change.
The fix removes just `--proc /proc`, which this fixed Python test does not need.
It exposes fewer filesystem resources and retains `--unshare-all`, read-only
binds, the empty environment and the same test. No fallback outside bwrap exists.
Fixed module SHA256:
`0e372a36f02e318fb247a2ef09a84a1408dfed57facd3c7cec212c7b1a20bb2b`.

Hypothesis B is rejected for this host path: `createHostSnapshot()` verifies
`checkedAt` is neither future nor at least 30 seconds old, then projects the
validated product gate into `project[511]`; it does not return `checkedAt`.
Advancing only that fresh timestamp produces identical JSON. Tests also reject
stale/future observations and changed main/Issue/stage, and retain changed PR/gate
data. The full admission equality check remains unchanged. Its guards run before
preparation as well as before remote writes; removing them is not this repair.

Focused validation is `node --test scripts/strigunov4/execution-adapters/host-integration.test.mjs`.
The new procfs regression fails on baseline and passes after the patch. Tests
also preserve failed state across restart, forbid publication after authority,
SHA or gate changes, and exercise an explicitly separate recovery model with
one loopback fixture PR and no duplicate. These fixture results are NOT live E2E.

### One proposed recovery procedure — fresh owner approval required

Do not execute this procedure under the consumed installation approval. Its
expiry is 2026-10-25 11:00 Moscow, and its post-first-start rule forbids automatic
rollback/replay. The installed runner itself does not change for this module fix:
`a1f722441610728e7018b5c46103656fa64c6fc8586decf85a90572f1e766495`.
Nevertheless the manifest and executable module change; old signatures cannot
authorize the replacement. The old switch helper is not a recovery command.

1. Bind a new recovery approval to the reviewed repair commit, rebuilt manifest,
   old/new module hashes, current runner/unit/autopilot hashes, all retained state
   hashes, unchanged pilot base/catalog/branch/path, and a new activation payload
   with a distinct ownerApprovalId (hence distinct operationId). Sign the actual
   activation and recovery payloads with the owner's existing Ed25519 key and
   give separate explicit installation/recovery authorization. Never regenerate
   that key or reuse the old installation signature. This permits one recovery
   attempt and at most one pilot Draft PR, not automatic retries. A changed main
   or expired approval stops the procedure and requires new exact artifacts.
2. Recheck inactive/PID 0, no competing publisher, exact file/state hashes,
   signature/expiry, main 955ea53 and G1 prerequisites. Reconcile the same pilot
   branch and all PR states through the approved App broker. Require no remote
   branch/PR and no local publication-intent journal. Any inconsistency stops
   recovery without changing anything. Preserve an exclusive reconciliation
   record. No source branch is renamed and #529 remains untouched/Draft.
3. With the service stopped, preserve exclusive copies of the old module and
   signed activation. Atomically rename the entire failed `engine` directory to
   `engine.failed-20261023-1886767` (destination must not exist); fsync the parent
   and verify every retained file hash. This retains FAILED_LOCKED, receipts,
   heartbeat, reports, locks and the partially changed scratch file exactly as
   evidence. Never edit a failed receipt into PASS or run an initializer over
   old files. Record the failed-generation hash in the external recovery receipt.
4. Atomically replace only `bin/engine/execution-adapters/host-checks.mjs` with
   the reviewed bytes; verify the whole new manifest. Install the newly signed
   activation, retaining owner-public.pem, catalog and App key unchanged. Verify
   `loadHostAuthority()` as the service UID. Under the explicit recovery approval,
   create the now-absent canonical engine root and call the existing initializer
   exactly once. Install a fresh independent detached scratch clone at 955ea53;
   never reuse or reset the archived dirty scratchpad. Link old/new operation
   identities and generation hashes in the recovery receipt outside live state.
   This is an operator-supervised generation replacement, not an automatic reset
   capability in the Engine. Only one canonical engine root can be run.
5. Verify unchanged runner, unit, ExecStart, legacy state, App permissions and
   complete sandbox protections. Start only the same service once. Require a
   real server-created Draft PR, exact HEAD CI/CodeRabbit and durable verification.
   Only after its terminal receipt, perform the separately approved one control
   restart and confirm no duplicate/IDLE. Any failure/timeout/unknown remote
   outcome means stop and preserve both generations; no automatic retry, rollback,
   lock clearing or manual pilot PR. Keep the failed archive permanently as
   incident evidence, even when the recovery succeeds.

The rehearsal performs steps 3–5 only in a disposable test model with inert
authority and loopback transport. It verifies all failed-generation bytes/modes
are unchanged, one fixture PR is made, and restart cannot publish another.
Live activation remains BLOCKED pending fresh signed recovery approval; physical
G1, G2, production, Sentinel, staging, SQL, App configuration and secrets are
outside this repair.
