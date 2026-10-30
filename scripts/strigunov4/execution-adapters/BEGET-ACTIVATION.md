# Existing ASI Engine: Beget source candidate

Target: `pqukibofpo` / `31.129.96.181`; one `asi-strigunov-agent.service`,
account `asi-engine`, runtime `/opt/asi-engine`, private state `/var/lib/asi-engine`.
The existing `asi-github-observer.timer`, staging, PostgREST, nginx and Desktop
Commander are not modified. No Hetzner collection or migration is required.

This source change is NOT an activation, physical G2 acceptance or 24/7 PASS.
The manifest remains `installable:false` until the protected prerequisites below
have independent evidence. In particular, a successful source-only test does not
prove the systemd sandbox on Beget. The actual DC sandbox rejected bubblewrap's
NETLINK_ROUTE socket; no weaker sandbox or alternate access path was used.

## Existing components and scope

The same runner bridge now has an explicit `--beget` entry. It calls the existing
PublicationLoop, Global Dispatcher, Publisher and durable state adapter. No new
queue or observer is installed. Old G1 grants retain their old scope. A new,
versioned Beget stage policy permits only two named G2 witness regression files;
all other new files, workflow YAML, earlier job IDs and physical jobs are denied.
The canonical map remains G1 accepted / G2 in progress / G3 not started.

The 10-minute process loop is independent of finite authorization. Work/CI polls
consume a persisted signed limit; no-work polls do not consume that limit. API
requests (including failures and authentication) and eight publication mutations
are reserved durably before use. Absolute signed validity is at most fourteen
days. Expiry, revocation, exhausted budgets, uncertain writes or retained locks
never produce another grant. A restart reads the same budget and receipts.
The process can remain alive and report BLOCKED after authority ends; it cannot
continue API work or renew itself. Systemd bounds restarts and memory/CPU/tasks.

## Finite proposed catalog (NOT admitted)

- `beget-g2-witness-identity-v1`: create only
  `scripts/strigunov4/test_beget_g2_witness_identity_v1.py`.
  Tests actual UID 65534 rejection, unsafe modes/hardlinks, descriptor/named-inode
  replacement, short reads and descriptor cleanup in the existing witness.
- `beget-g2-witness-races-v1`: create only
  `scripts/strigunov4/test_beget_g2_witness_races_v1.py`.
  Tests the real observe sequence against env, PID, InvocationID and policy races;
  successful output stays redacted and human login remains NOT_PROVEN.

Branches are `asi/engine-task/<id>`. Each task has one absent-before path, fixed
UTF-8 content, exact base commit, local unittest, one Draft PR and no merge.
Templates are inert package input, not already-executed product changes.
Two actual tests run in separate Python processes in protocol acceptance; GitHub
writes, CI and stage approvals there are explicitly fixtures.

## Independent review without paid API calls

No model/CLI subscription or CodeRabbit spending is assumed. The alternative is
an explicitly admitted review of exact prepared deltas on GitHub. `reviews.json`
contains `schema: asi.offline-delta-review.v1`, repository, sourcePr, sourceSha,
reviewerId, fixed notBefore/expiresAt and tasks `{id,baseSha,status:PASS,findings:0,
deltaSha256}`. The delta is SHA256 of compact JSON `[ {path,beforeSha256:null,
afterSha256} ]` in that exact field order. The source reviewer must differ from
the source PR author, approve that exact source head, and use the exact body:

`ASI-OFFLINE-DELTA-REVIEW:<SHA256 of compact JSON tasks array>`

The host rereads authenticated GitHub reviews, including dismissal/revocation,
before preparation/publication and promotion. Its native signed activation binds
the full reviews file hash. Publisher separately verifies exact remote tree,
commit parent, branch, PR, HEAD and required current CI. The offline review is
never manufactured from passing tests or a subprocess claiming independence.
No reviewer private key or additional signing system is introduced.

## Exact G2 single-owner bootstrap exception (owner decision 2026-10-29)

The original independent-human source/review route remains supported. For this
**one existing** Beget Engine and **only two fixed G2 Draft-PR witness tasks**,
the owner authorizes a separate `OWNER_VERIFIED_CI` review mode instead of an
external human reviewer. It is not named or reported as independent human review.

This is an **implementation contract**, not a successful activation: before the
installer and runtime can use it, both must independently query authenticated
GitHub run/review results for the exact pinned source and task deltas, confirm
the owner identity and exact-SHA attestation, and reject expiry or replacement.
Both protected CI workflows must be SUCCESS. The owner must separately sign
the exact manifest, limited catalog, installation and activation grants.
No self-asserted `independent:true` or copied JSON fields can confer access.

Old-writer GitHub token fencing, provider-origin evidence, native Beget
systemd/bwrap isolation, one-use root admission, zero-paid API budget, single
publisher lock, stop-on-uncertain-write, protected-main pin and strict expiry
remain mandatory. This exception grants **no** live deployment, merge, writes
outside the two witness paths, extra lanes or post-expiry continuation.
A missing check stays BLOCKED; the operator must not fabricate evidence.

## Protected prerequisites — one decision, independently checked atomic actions

1. Effective source review and required CI on the final integration SHA. The
   #548 approval covers its original SHA only and is not requested again.
2. Authorized protected integration makes the catalog's EXACT base SHA main.
   A squash/merge that produces another SHA requires binding the catalog to that
   actual SHA before signing; never edit a signed file or pretend trees are SHAs.
3. Independently verify revocation of the old writer's GitHub installation and
   credentials, including expiry of outstanding tokens. Retain authenticated
   provider evidence off the old host. DNS/SSH failure is not fencing. The
   root-owned SHA-bound fence record includes oldInstallationId, repository,
   method REVOKED_OLD_GITHUB_INSTALLATION, oldCredentialsRevoked,
   outstandingTokensExpiredAt, independentEvidenceSha256,
   verifiedBy protected-install-review and deniedPullRequests including 531.
   New app identity differs. No old mutable ledger is copied into clean state.
4. Verify the exact unit's native sandbox on Beget under an authorized protected
   test, including no network from test children and no authority visibility.
   No bypass of DC restrictions is permitted. Record source/unit/bwrap hashes.
5. Existing trusted owner public key, separate exact signed installation and
   Beget activation artifacts, finite catalog, authenticated independent review,
   and minimal GitHub App are provisioned through their explicit protected gate.
   Installation is not implicitly allowed by CONTRACT-CHANGE or this runbook.

## Install candidate and provenance

Build with `buildBegetCandidate({repository,output,baseSha})` in host-package.mjs.
The runtime layout preserves sibling Dispatcher imports. Manifest pins every
runtime module, installer, unit and catalog. The executable is the existing
runner bridge, not the historical runner patch. Installer `--package <absolute>
` only checks and prints the plan. `--apply --node <verified-node> --bwrap
<verified-bwrap>` requires root, exact host, absent Engine/unit/state/account,
root-owned signed install-approval.json, exact manifest and evidence hashes.

Dependency bytes verified on Beget:

- Node 22.16.0 from existing `/opt/asi-node22/bin/node`:
  `8142d37c6f2f372ef040419e7a111a6baf17df89f8078d02447d6c639ae20c1d`.
- Ubuntu noble amd64 bubblewrap 0.9.0-1ubuntu0.3, downloaded without installation
  from configured APT metadata: deb
  `2461f1beee9cb04c8942739fe1a2b37e7b7c2a3d518f0779dc75f9245baa3094`;
  extracted binary
  `e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71`.

The installer copies verified bytes to root-owned `/opt/asi-engine/node` and
`/opt/asi-engine/bwrap`; it does not change the shared Node installation, APT,
AppArmor, DC permissions or `/usr/bin`. Dependencies remain subject to independent
provenance/security review; matching hashes alone are not native isolation PASS.

The one-use root install claim is created before mutations. Only the new unit,
new account, new runtime/state and named authority-file read permissions change.
Initial state/routing/budget are created once; runtime never recreates them.
Installation output INSTALLED_ACCEPTANCE_PENDING is not final acceptance.

## Repair: two-phase Beget native-isolation bootstrap

The former single-phase installer required `native-isolation.json:PASS` before
creating the very `asi-engine` user and exact systemd unit under test, while
rejecting any pre-existing account/unit. It remains backward compatible, but
**must not be used to assert native isolation from an unrelated `nobody` probe**.

This source revision introduces two separately owner-signed transitions using
the **existing** installer, package, host, runtime and final activation gates:

1. **Stage only**: `beget-install.py --package <exact-package> --stage --node
   <verified-node> --bwrap <verified-bwrap>`. Requires root on `pqukibofpo`,
   a fresh owner Ed25519-signed `stage-approval.json` with
   `schema: asi.beget-isolation-stage-authorization.v1`, pinned
   `manifestSha256`, `sourceSha`, `baseSha`, `unitSha256`, host, unit,
   and the fixed `STAGE_ACTIONS` array in source; at most 14 days.
   Verify absence of an existing Engine/user/state/active authority,
   package closure, Node/bwrap bytes, exact protected main and current grant.
   One use writes a durable stage claim, creates only the new unprivileged
   account, root-owned runtime bytes, private empty state directory and exact
   **disabled/inactive** service file. It does **not** enable/start the unit,
   grant access to GitHub App keys, initialize a live catalog, mint a token,
   publish code or declare a physical PASS.
2. **Physical native acceptance**: An authorized operator tests the **staged
   exact unit with its real UID and effective systemd restrictions**. Record
   UID, InvocationID/test session, exact unit and package hashes, AppArmor and
   bubblewrap identity, expected network denial for isolated test children,
   and absence of authority visibility. A static `systemd-analyze` result,
   a sandbox test outside systemd, or a stopped unit is **insufficient**.
   Store an independently authenticated, root-owned
   `native-isolation.json` bound to exact host/unit/bwrap and source evidence.
   If a protected native test cannot be executed, **BLOCK**; do not create
   synthetic results or relax systemd, AppArmor or Desktop Commander.
3. **Activate only after acceptance**:
   `beget-install.py --package <same-exact-package> --activate-stage --node
   <verified-node> --bwrap <verified-bwrap>`. Requires the separate, current
   owner-signed `install-approval.json` and `activation.json`, review and
   fence records, exact catalog and native evidence, verified old-writer
   revocation, same protected main and intact staged code/account/unit/receipt.
   Rechecks everything at its irreversible one-use claim, then grants
   minimal group-readable authority, initializes new state and enables/starts
   the **same** unit. A changed, running, enabled or mismatched staged service
   is refused. Stage and activation are not the same approval.

### Already staged with restrictive umask: one signed, mode-only recovery

The existing Beget stage is **not** eligible for `--stage` again and must not
consume an `--activate-stage` claim while the original root-owned runtime is
not traversable by `asi-engine`. The newer installer bytes have a different
identity from the original staged package. A future-stage umask fix cannot
change that original package or replace its already consumed stage approval.

**Protected operator sequence (not permission granted by this document):**

1. Obtain the **original exact stage package** including its original installer,
   manifest, unit and file closure, and independently verify its provenance.
   Review the proposed repairer's exact Git commit and full tests; it is
   source-only until that review, owner signature and operator identity pass.
2. As a separately authenticated root operator on `pqukibofpo`, run the new
   reviewed repair script with `--package <original-package> --stage-repair-plan`.
   This is read-only: it verifies signed original stage approval, root-owned
   stage receipt and consumed stage claim, all exact staged bytes, UID and
   effective *disabled/inactive* unit, and outputs **only** SHA-bound proof
   fields (never a signature or secret). If any proof is missing, stop with
   UNKNOWN; do not guess the original manifest hash.
3. After independent review, owner may separately sign a one-use
   `repair-approval.json` envelope with
   `schema: asi.beget-stage-mode-repair.v1`, the exact
   `host`, `unit`, `manifestSha256`, `sourceSha`, `baseSha`,
   `originalInstallerSha256`, `unitSha256`, `stageClaimSha256`,
   `stageReceiptSha256`, `serviceUid`, `repairScriptSha256`,
   `actions: ["normalize-exact-staged-runtime-modes-only"]`,
   `oneUse: true` and an integer millisecond `notBefore/expiresAt` window
   no longer than 14 days. Use only the installed owner public-key verifier;
   the private signing key must stay on the authorized owner device. A text
   message, checklist or this runbook is not a signed approval.
4. With that **new exact signed approval** and no live activation materials,
   an authenticated operator may execute `--package <original-package>
   --repair-stage-modes` using the exact independently reviewed root-owned
   repair script. It rechecks grant, original claim/receipt and *all staged
   bytes* before atomically reserving its own one-use repair claim. It changes
   **only mode bits** of original root-owned `/opt/asi-engine` directories,
   script/manifest files and Node/bwrap executables; never contents, owner,
   state, authority, GitHub rights, unit enablement or any other service.
   Expected output is `STAGED_MODES_REPAIRED_NATIVE_ACCEPTANCE_REQUIRED`,
   **not** an Engine start or activation.
5. On any result other than exact confirmed success, preserve the consumed
   repair claim, original stage receipt/claim, runtime and failed-state
   evidence; no replay or manual chmod. Independently retest all file hashes,
   effective UID access and native systemd/bubblewrap isolation. Continue the
   already-required independent fence/review/candidate/signature gates before
   the *original* stage-package activation path can be considered.

The recovery mode's Python/Node fixture tests do not establish physical
native acceptance or approve `repair-approval.json`. No new Engine, worker,
catalog entry or background service is authorized by this recovery.

Never regenerate a consumed claim, delete the staged evidence after an unknown
outcome, or use `--apply` as a fallback for failed staged activation. The
existing observer, staging and protected production services are out of scope.
Only successful live two-task receipts and a separately approved controlled
restart can establish Engine physical acceptance.

## Physical acceptance after exact protected admission

Capture PID, InvocationID, unit/source/dependency SHA and OS flock owner. Verify
one new task is selected by Dispatcher, one real Draft PR is published, exact CI
and independent review pass, and Engine receipt/report digests agree. Then the
second distinct task must complete automatically. Verify only two allowed task
branches/PRs; no #531 modification/republication. Record fresh observer state.
Verify the new service's enabled state and one separately authorized controlled
restart after terminal receipt and IDLE. Require new PID/InvocationID, intact
receipt/budget/routing hashes and no replay. SIGKILL fixture tests prove process
crash fail-closed behavior, not power-loss durability or native reboot operation.

## Safe disable / rollback

On installation failure the installer never reapplies. If the new unit was
created it executes `systemctl disable --now asi-strigunov-agent.service` and
requires MainPID=0. Failure to confirm returns STOP_UNCONFIRMED. Retain claim,
all runtime/state/authority files and historical evidence; do not reset counters,
restore ledgers or delete uncertain remote results. No other service is stopped.
There was no preexisting target unit/runtime to overwrite: exact absence is a
mandatory precondition. Retiring the inert account/runtime later is a separate
bounded cleanup; disabling is the safe rollback, not history deletion.

Pre-claim requirements: authority directories must be root-owned, non-writable by group/other, and traversable by the new service UID (for example 0711); authority files remain restricted. The installer rejects inaccessible directories without changing their permissions or consuming a claim. Activation host/service and validity are checked before the claim. Package generation requires a clean tracked/untracked source tree and unchanged HEAD.

## Five owner workstreams — source boundary, not installed runtime

The owner named five **logical** lanes on 2026-10-29: Engine #549
(`asi/beget-one-engine-20261028`), RU Auth #554
(`feat/ru-unified-auth-20261029`), P0 integration #552
(`asi/standing-delegation-551`), trusted evidence
(`asi/p0-trusted-evidence-worker-20261029`) and atomic budget
(`asi/p0-atomic-budget-worker-20261029`). All target
`ASI-integration/asi-landing`. Five ChatGPT scheduled sessions are **not**
five systemd processes, verified server workers or durable heartbeats.

The **current signed Beget activation schema still admits exactly two G2
witness tasks**, not any of these five lanes. The read-only
`owner-lanes.mjs` source adapter names them without granting permissions.
Its admission token is minted only by the existing signed host verifier;
missing/unverifiable authority yields UNKNOWN. An authenticated catalog
omission is BLOCKED; a catalog match alone remains UNKNOWN without independent
service-instance and heartbeat evidence. It never marks RUNNING or IDLE.

Future extension requires an **explicit protected new signed catalog and
activation policy** for every exact repo/base/branch/work-order/path, with
nonoverlap and separate authorization for any new product action. Do not
treat the five names as a blanket grant or repurpose the two G2 witnesses.
Reuse the existing Dispatcher under the **same durable Engine execution
lock and single Publisher**, at most one mutation/pending PR at a time.
When authorized, cooperative candidate rotation must bound starvation and
persist per-lane eligibility, last-served and capped retry/backoff (without
retrying UNKNOWN, FAILED_LOCKED or uncertain writes). Fairness never overrides
dependency, review, budget, isolation or stage gates.

The future per-lane journal belongs under the existing Engine state/lock,
with `currentTask`, terminal `result` and `lastHeartbeat` durably committed
and identity-bound to the **actually observed** Beget hostname, approved
systemd unit, live MainPID and InvocationID. A protected local reader must
cross-check kernel/systemd identity, fresh timestamps and file provenance;
GitHub commits, Actions and ChatGPT schedule starts are not heartbeats.
Only then may an authenticated GPS #537 read-only adapter display
VERIFIED RUNNING / BLOCKED / IDLE / UNKNOWN, using UNKNOWN on stale,
missing or unverified evidence. No parallel server collector, DB, queue,
secret, DNS change or GPS deployment is authorized by this source note.

**Installation priority stays first.** These source-only safeguards are not
a reason to delay one protected two-witness Engine acceptance, and a resident
service after grant expiry is BLOCKED, not authorized perpetual execution.
