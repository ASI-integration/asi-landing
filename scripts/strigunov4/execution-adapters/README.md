# S4-G1 isolated acceptance seam

This is source-only integration for PR #522, based on
`c6b662213b4685e28af5b3ad6b6048fb4834d18f`. It does not install a runner,
change a live state directory, publish a PR, dispatch a workflow or authorize
physical pilot acceptance.

## Bridge contract

`createReadOnlyRunnerBridge()` remains observation-only and always supplies
`execute:false`. Its cadence and status interface are unchanged.
Snapshot reads have a 10-second deadline (`snapshotTimeoutMs`, positive integer,
maximum 30 seconds). The host receives `fetchSnapshot({signal})` and should
forward cancellation to its read requests. A timeout returns
`WAIT_RECONCILIATION / READ_ONLY_SNAPSHOT_TIMEOUT`; a late response is discarded.
An abort-ignoring read retains the read slot until it settles, so later ticks
cannot overlap it. A fresh read still respects the 180-second cadence.
This observer does not write execution receipts or clear execution stop locks.
`createIsolatedAcceptanceLoop()` is explicitly exported from that same bridge
for acceptance in a separate private Linux directory. It accepts only
`poll({execute:false})`; `execute:true` fails closed before any adapter action.
There is no publisher, shell-action, merge, remote-write or physical-gate port.

The earlier `bridge-contract.mjs` wrapped CI and review individually in
`store.execute()` with the same task ID. Consequently the first receipt could
suppress the second phase. It also used a ledger different from the PR's
single-operation journal. This integration calls the existing pure adapter
functions inside **one** transaction covering selection, CI, review, source
preparation and receipt publication. It reuses `WORK_ORDERS` and `decideQueue()`;
there is no second task catalogue.

The host calls `poll()` on successive ticks; no caller-selected task ID or
manual next-job command is accepted. The next incomplete S4-G1 job is selected
under the cross-process lock. Each source preparation independently rechecks
its review dependencies and requires a trusted exact-task/SHA/path admission.
Local completion does not grant merge or physical execution permission.

## State compatibility and recovery

- `initializeState(root)` is an explicit one-time operation on an empty private
  directory. Never point it at existing state. The live root is forbidden.
- The isolated root owns `state/receipts.json`, `state/heartbeat.json`,
  `state/autopilot-ledger.json`, `reports/` and `scratchpads/`.
- `legacyStateDir` is a separate local copy, read-only. Accepted historical PASS
  records are preserved byte for byte. An old failed/stale receipt, active
  heartbeat, any old autopilot ledger or operation journal continues to block.
  No automatic migration, reset, stale-lock stealing or reconciliation occurs.
- Unique `wx` temporary files, file fsync, atomic rename and directory fsync
  protect each write. A single `state/execution.lock` covers all transaction
  phases. The ledger is durably armed as FAILED_LOCKED before observations or
  candidate writes; IDLE is the final commit point. Multi-file writes are not
  falsely represented as one filesystem transaction.
- PUBLISHED means `artifactType: LOCAL_REPORT_ONLY`, never a GitHub publication.
  There is no `publishedPr` field. Exact receipt/report SHA256 identities are
  verified before advancing; historical results are not fresh review evidence.
- Pending known checks may wait and resume. Errors, unknown results, stale
  identities and unconfirmed history freeze. SIGKILL leaves the durable brake
  and lock; restart blocks pending physical review, without repeating work.
  If storage itself is unavailable, retaining the stop lock is the fallback;
  no software can promise an immediate JSON write after power loss or SIGKILL.

Use private local Linux storage supporting file and directory fsync. Windows,
NFS durability and malicious concurrent access under the same OS identity are
not established by this acceptance. Candidate Git copies must be independent,
private, detached and clean. The preparer handles existing admitted files only; the read-only GitHub
reader can verify both open/unmerged and closed/merged PRs at the exact pinned SHA,
and includes lifecycle in its identity to detect changes. It never merges or
reopens a PR. Scratch Git configuration accepts only safe clone-created branch
metadata (remote=origin, merge=refs/heads/...), with no hooks, includes or
other executable configuration. YAML source proposals are rejected with `NO_APPROVED_SYNTAX_CHECKER` before
any mutation, even if JSON-shaped. An approved, pinned YAML syntax checker is
required before preparing any `.yml` or `.yaml` source. JSON proposals alone
receive JSON normalization. No packages, hooks, repository scripts, commits or
pushes are executed by the preparer.

## Read ports and scope of proof

`createGitHubReader()` performs bounded REST GETs and one fixed GraphQL query.
It cannot perform a GitHub mutation. Tokens stay host-side and are not logged.
CI policies must supply trusted workflow IDs, not names obtained from issue
text. This adapter currently admits exact-SHA pull_request workflow records;
other event/head conventions are blocked rather than inferred as success.
CodeRabbit must be completed on the exact SHA with no unresolved or explicit
outside-diff findings. Skipped reviews cannot pass.

The offline tests supply deterministic read-port data. They exercise real
filesystem locks, durable writes, independent Git fixtures, Python syntax
checks and a killed child process. They do **not** prove current remote PRs
are green, perform a live GitHub adapter run, reconcile actual old state, or
repair a server. All production capabilities remain disabled.

Focused acceptance (isolated loop, runner bridge, and adapter security regressions):

```sh
node --test scripts/strigunov4/execution-adapters/isolated-loop.test.mjs \
  scripts/strigunov4/execution-adapters/security-review.test.mjs \
  scripts/strigunov4/ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.test.mjs
```

The existing ordinary multi-job workflow retains its prior regression command
and adds the new isolated test file. This change does not relax release gates.
