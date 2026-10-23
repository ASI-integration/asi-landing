# ASI Global Dispatcher — source-only prototype

This module is an advisory routing layer inside the existing Engine, **not a
daemon, an executor, or a new publication loop**. It exports `plan(snapshots)`;
there is no execute, authorize, merge, network, shell or transport port.
Nothing imports it from the installed runner. Atlas, Location and Other exist
only in isolated tests; their fixture goals are not approved product roadmaps.

The baseline is `955ea53b2135c7fe1633ed3ae571ea1cc8b8d9a1`. Keep this change
unmerged until the protected Publisher activation bound to that baseline is
complete. This PR does not rebuild, replace or invalidate that installed-source
candidate by changing main.

## Existing infrastructure and ownership

| Responsibility | Owner |
| --- | --- |
| Strigunov roadmap and task catalog | Existing `decideQueue()`, `WORK_ORDERS`, canonical demo release |
| Product choice and fairness | `createGlobalDispatcher()`; returns an advisory plan |
| Strigunov compatibility | `createStrigunovAdapter()` returns the complete unchanged `nativeQueue` |
| Existing execution state machine | `createOrchestrator()`, runner bridge and execution adapters; unchanged |
| Atomic durable JSON write | Existing orchestrator `atomicWriteJson()`; reused |
| Capabilities, owner signatures, checks, review, publishing | Existing protected host/Publisher chain; not connected here |

The test passes the returned Strigunov `nativeQueue` through the existing
orchestrator's `choose` seam with `execute:false`; all execution ports throw.
This proves compatibility without a second runner or duplicate task catalog.
The adapter preserves optional #520 handling, mandatory dependency blocking,
pilot opt-in, the first unaccepted stage, and final owner acceptance. Its inputs
must come from the existing verified snapshot reader. It intentionally does
not reinterpret native physical acceptance or replace that reader's trust model.

## Product contract and isolated example

`createProductAdapter(contract, {verifyEvidence})` validates:

- stable product/repository identity and a contract hash;
- a finite goal with explicit acceptance criteria;
- an ordered roadmap, explicit preceding-stage dependencies and criteria;
- exact product functions, tools and file paths;
- tests, independent review, PR, CI and report evidence;
- one reservation per task and a bounded number of plans per stage.

The snapshot contains the matching product/hash/HEAD, ordered stage statuses
(`OPEN`, `NOT_STARTED`, `ACCEPTED`) and the product's task queue. Tasks include
identity, stage, priority, dependencies, function, tool, exact paths and status.
Non-ready tasks carry a concrete `nextAction`. Tasks are supplied by the
product's own source of truth; there is no copied central task catalog.

See `contract()`, `snapshot()` and `evidence()` in `dispatcher.test.mjs` for
complete Atlas/Location/Other fixture examples. These are integration examples,
not claims about those products' real goals or acceptance. To add a real product,
replace the fixture inputs with its independently approved contract and verified
read-only snapshot adapter. Do not enable physical execution in this prototype.

Acceptance requires a product/repository/contract/subject/HEAD-bound evidence
envelope, exact PR HEAD, all criteria, successful tests/review/CI and a report.
The separate synchronous `verifyEvidence` port must affirm that envelope using
trusted evidence; a boolean in the snapshot, a Promise or an absent verifier is
rejected. **Tests use fixture evidence only.** No production verifier is claimed.
This v1 snapshot format requires evidence pinned to its HEAD; historical evidence
must be independently revalidated by the product adapter before that HEAD changes.

`selected` contains product, repository, contract hash, HEAD, task scope,
`executable:false` and `authority:null`. Arbitrary authority-shaped task fields
are not forwarded in the selected envelope. READY means a reviewable source
plan, never permission to execute. Product-specific decisions in `products` are
diagnostics, never an authorization object.

## Selection and stop states

Tasks become candidates only in the first unaccepted stage, with accepted
dependencies and permitted functions/tools/paths. Within a product, higher
priority wins; ties use task ID. Across products, least-recently-served wins;
ties use product ID. For N continuously eligible products, each gets a turn
within N successful reservations, regardless of another product's priorities.
Blocked products do not stall healthy products.

| Status | Meaning and next action |
| --- | --- |
| READY | A source plan can be reviewed; execution remains disabled |
| WAITING | Await dependencies/evidence; remain IDLE without inventing work |
| BLOCKED | Correct the reported snapshot, reservation or acceptance blocker |
| FAILED_LOCKED | Reconcile failed/uncertain work or persistent state; no automatic retry |
| ACCEPTED | Independently verified final criteria; no further tasks |

An accepted stage cannot be reopened. Accepted/published task tombstones block
stale snapshots from proposing duplicate work. A failed task remains locked even
if a later snapshot calls it READY. Each planned task is reserved once, including
when the caller loses the result. New SHA, polling, process restart and cosmetic
task changes cannot retry that identity. A stage plan budget prevents endlessly
renaming fixes without acceptance. There is no reset/retry API in this prototype.
No-progress is a concrete stop condition, not another diagnostic task.

## Durable routing metadata and crash behavior

Call `initializeRoutingState(privateEmptyDirectory)` once, then construct the
dispatcher with that directory and the registered adapters. Use a disposable
Linux directory outside live installations for this source-only prototype.
Registration cannot silently remove products or change a bound contract.

One private `routing.json` contains separately keyed product histories and the
global fairness counter. One exclusive `routing.lock` serializes proposals.
The journal is atomically renamed and file/directory-fsynced before returning a
plan. Its SHA256 checksum detects corruption, **not malicious rewriting by the
same OS owner**; this is not a signature or authority store. Private directory,
file ownership/modes, no symlinks/hardlinks, bounded input and schema checks are
also enforced. Existing executor receipts and publication locks remain untouched.

- Clean restart retains fairness, accepted stages and reserved task identities.
- Lost response after journal commit cannot return the task again.
- SIGKILL mid-iteration leaves the lock and stops on restart.
- Malformed/truncated/checksum-invalid state stays preserved and locked.
- No stale-lock takeover, automatic rollback or clearing failed state exists.

Recovery from an interrupted transaction is deliberately fail-closed: a reviewer
must reconcile the preserved journal/lock against external evidence before any
future separately reviewed recovery mechanism is used. This is not automatic
live crash recovery or a successful autonomous GitHub E2E claim.

## Validation and physical integration gates

Run only the focused test file:

```sh
node --test scripts/global-dispatcher/dispatcher.test.mjs
```

The existing unprivileged source-test workflow now runs it as well. It covers
native-route equivalence, the existing orchestrator seam, dependencies, G1/G2
denial, evidence forgery, cross-product scope denial, priority/fairness across
restart, terminal-state replay, no-progress limits, concurrency, corrupt state,
private paths and a real child-process SIGKILL. The tests create no GitHub PRs.

Before any physical product integration:

1. Finish the current exact-main Publisher activation; do not merge this PR first.
2. Obtain exact-HEAD source scope approval and independent review; merge is a
   separate owner decision. Existing release governance remains unchanged.
3. Approve each real product's goal, roadmap, acceptance and task catalog; replace
   fixtures with independently verified snapshot/evidence readers.
4. Admit product-bound capabilities (repository/SHA/branch/files/operation),
   credential isolation and separate owner signatures. Never reuse Strigunov
   authority for Atlas or Location.
5. Review a handoff into the **existing** runner/orchestrator/Publisher chain and
   its shared execution locks; build a new SHA-bound activation package, rehearse
   rollback and obtain protected installation approval. No second daemon.
6. Prove one actual product cycle, current-HEAD CI and independent review,
   durable receipt, duplicate prevention and crash reconciliation before enabling
   more products. Physical G2 stays closed until independent G1 acceptance #511.
