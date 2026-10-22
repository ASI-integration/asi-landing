# Limited publisher candidate — no live installation

Dependency: PR #522 `07d889185e797f67433f22da56a644a0b7bed28c`.
This candidate adds the missing publication operation to the existing dispatcher,
source preparer, CI/review adapters and shared state lock. It does not alter #522's
observer or turn its `execute:false` into publishing permission.

`createPublicationLoop` accepts a trusted, immutable host catalog mapped to an
existing `WORK_ORDERS` source job. `decideQueue` must admit that job at S4-G1.
Only the first incomplete catalog job is selected; a blocked job stops the queue.
The loop uses the existing `state.execute` lock, ledger, heartbeat and receipts.
Legacy files are read-only and their byte hashes must remain unchanged. The
isolated-root restriction remains: this is not yet a live-runner admission.

## Entry and host contract

Create the existing isolated state once with `initializeState`; never initialize
over existing state. Supply a separate legacy snapshot and private independent
detached scratch clones at the exact admitted base SHA. The existing preparer
supports at most three existing .py/.mjs/.js/.json files. YAML/new files are still
blocked. Its inventory bounds are unchanged; a full repository clone exceeding
them is a stop condition, not permission to omit files silently.

Construct `createPublicationLoop({root,legacyStateDir,catalog,fetchSnapshot,
remote,reader,authorize,runChecks,independentReview,ciPolicies})`. Default
`poll()` is inert (`OBSERVE_ONLY`); publication requires `poll({execute:true})`
AND a matching host capability. No import starts a loop or reads a token.
The existing 30-second host tick may call poll; a durable timestamp limits
GitHub intake to once per 180 seconds, including after restart.

Each catalog entry contains id, kind=`github-publisher`, stage=`S4-G1`,
workOrderId, repository, exact base SHA, pr=null, exact new branch and proposed
existing-file bytes with before-SHA256. Branches are restricted to
`asi/engine-task/<lowercase-id>`. No caller-supplied shell command is accepted.
The catalog and all capability/test/review ports are trusted host configuration;
they must never be constructed from Issue/PR/comment text or unchecked model output.

`authorize` must independently validate the actual owner/capability artifact.
It returns an exact request binding, a one-use operation id, expiry and explicit
automatic-CI/review side-effect permissions. A boolean copied from an issue is
not authorization. The complete task binding includes its source bytes and paths.
The implementation binds and checks the returned capability; it does not issue
owner grants, provision credentials or implement the installed host's signer.

`runChecks` executes only a host-owned approved check plan in an already secured
test sandbox; it returns PASS bound to base SHA and delta SHA256. `independentReview`
must verify separate review evidence bound to the same base/delta, with a bounded
evidence id. These ports are not an arbitrary command runner and are not supplied
by an Issue. The package's fixture reviewer is synthetic protocol evidence and
must NEVER be used as the production review port.

## Remote operations and evidence

The transport fixes repository/origin and exposes only bounded reads plus
create-tree, create-commit, create-new-branch and create-Draft-PR. No ref update,
force push, merge, comment, dispatch, reviewer request or deployment API exists.
A review finding locks the task: automatically broadening a grant or updating an
already-published branch is deliberately unsupported. A correction needs a fresh
exact delta/review/capability and separately reviewed recovery; no duplicate PR.

Before each mutation: capability expiry, protected main SHA, task-branch refs
and all-state PR history are checked, followed by a durable intent. Tree leaves,
modes, one-parent commit, branch SHA, PR identity/body, exact paths and blob hashes
are verified independently through reads. GitHub has no cross-resource atomic
transaction: movement after a precheck can leave an object/branch/PR, so readback
failure always locks rather than claiming no remote effect.

`PUBLISHED_WAITING` records verified publication, not successful CI/review. Only
after exact-head CI and CodeRabbit pass, fresh evidence is unchanged, and final
remote identity is rechecked does the shared store emit the final PASS report
containing `artifactType: GITHUB_PR_VERIFIED`. Existing LOCAL_REPORT_ONLY metadata
is not redefined as remote publication. Subsequent selection verifies the report
hash, task binding and receipt/ledger correspondence before skipping the job.

`ci-reader` retains pull_request as default. The sole explicit target-event
exception is `release_governance`, workflow ID 390653294, repository ASI, exact
PR head and pinned base associations. A base-SHA result cannot substitute for
head-SHA evidence. Required validate/governance policies cannot be omitted.
This does not change workflows, owner exceptions or GitHub protection settings.

## Failure and recovery

The shared ledger is durably armed before intake. Every unknown response,
network timeout, storage failure or crash stops advancement. An abort-ignoring
transport is permanently poisoned; no late continuation schedules another write.
SIGKILL leaves the lock/armed ledger and subordinate intent. Restart never retries
an uncertain mutation, even when a PR might already exist. No automatic lock
clearing, state rollback, receipt deletion or compensating GitHub action exists.
Reconciliation is a separate physical/owner-controlled operation.

## Minimum deployment permissions and remaining gates

Dedicated repository-scoped GitHub App installation: metadata read, contents
write, pull requests write, actions/checks/issues read for evidence. No Actions
write, administration, environments, secrets, deployments or workflow write.
Contents write is broader than one branch: retain server-side protection and
the host capability boundary. A live credential's effective permissions and
installation/repository identities must be verified before activation. Token
values are never emitted, included in PR bodies, or stored in journals.

Before live use: independently review this candidate; complete #522's exact-SHA
release/review gates; approve the new file scope; obtain the installed runner's
actual source/state/hook and backup hashes; wire authenticated snapshot/catalog/
checks/review/capability providers; approve a specific safe publication target.
The generic preparer consumes admitted proposals; a fully autonomous coding-agent
provider is still a host integration requirement. The current module is not proof
of an autonomous model producing changes, a live PR, or a 24/7 executor.

## Isolated verification

`node --test scripts/strigunov4/execution-adapters/github-publisher.test.mjs`
uses real modules, real private Git copies/Python checks, actual loopback HTTP,
real process SIGKILL and durable files. GitHub payloads and independent review
are protocol fixtures. No real GitHub token, PR or paid AI request is used.
The workflow candidate includes this test alongside the existing adapter checks.
