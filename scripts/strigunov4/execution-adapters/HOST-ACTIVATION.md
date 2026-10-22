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
- service `asi-strigunov-agent.service`, stage `S4-G1`;
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
App identity/revocation, genuine runtime independent review and actual GitHub
publication remain UNVERIFIED. Existing 83 Publisher tests were not repeated.

An actual separate ephemeral Codex review of this package found one installation
ordering defect (scratchpads before initializeState). It is corrected above by
initializing first; no initializer/recovery guard was relaxed. The full-checkout
integration test follows that same order. Isolated atomic runner replacement and
restoration from an exclusive backup passed with byte-exact readback. The final
runner candidate SHA256 is
`a1f722441610728e7018b5c46103656fa64c6fc8586decf85a90572f1e766495`.

Only actual server-created PR + exact-head CI/CodeRabbit + durable verified receipt
and post-restart no-duplicate/idle evidence can produce AUTONOMOUS E2E PASS.
