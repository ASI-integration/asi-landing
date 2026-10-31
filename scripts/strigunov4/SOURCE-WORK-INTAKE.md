# ASI Stage 3 — Source-work intake candidate (not live authority)

**Purpose:** Accept a new, bounded, owner-defined assignment, call one separately
configured code-producer callback, and produce a deterministic content-hash-bound
source proposal. The result cannot cause a GitHub write. The existing Beget Engine,
Dispatcher and Publisher remain the only possible operational path.

## Existing machinery to reuse

- execution-adapters/change-preparer.mjs: sandboxed Git worktree, exact
  before/after hashes, source size and syntax checks. Current G2 creation
  accepts ONLY the two legacy witnesses; do not bypass this rule.
- execution-adapters/github-publisher.mjs: host-admitted publication intents,
  exact tree/PR readback, local tests, CI/review and terminal receipts.
- execution-adapters/state.mjs: one native execution lock and durable journal.
- owner-lane-native-bridge.mjs in Draft PR #556: five-lane advisory selection.
- Draft PR #552: 365-day parent and <=14-day child permission model still needs
  an actual authenticated signed issuer, protected adoption and validation.

## New candidate boundary

source-work-intake.mjs exports inspectSourceIntake and proposeSourceWork.
It pins the exact task ID, one of five static owner branches, repository,
base SHA, stage, file count, literal file paths and beforeSha256. The
producer receives an immutable, limited task view. Its output is bounded and
hashed. An error or mismatch returns BLOCKED; a matching output returns
PROPOSAL_PREPARED with authorized:false. A copied catalog JSON or a model
callback is never itself a credential.

## Required integration to finish Stage 3

1. Extend the EXISTING signed host catalog/admission for bounded new tasks.
   Currently only two G2 regression files are admitted. Authenticated native
   issuer and verifier must bind lane, scope, budget and owner-signed lease.
2. Configure a real, sandboxed code-generation provider for Beget. No such
   provider is installed or billed by this source-only change. Producer output
   remains untrusted until exact source preparation and scoped tests pass.
3. Adapt the EXISTING preparer and Publisher to consume candidate output only
   after native admission, path/target/branch checks, reviewer/CI evidence.
   This module exposes no publish, write, merge, root or deploy capability.
4. Persist intake, attempts and duplicate suppression under the existing
   execution lock and receipt ledger; unknown outcomes retain a lock.
5. Prove an actual new owner-approved task (NOT either hardcoded G2 witness)
   produces source, runs real tests, publishes one Draft PR, verifies exact
   CI/review and receipt, then continues to the next task while Windows is OFF.

No new Engine, daemon, queue, added reviewer, increased security tier,
database migration, credentials, live sends or production effects.
A mocked producer and green source tests are NOT an autonomous worker.

## 31 October follow-up: source-to-Publisher handoff

The existing Draft PR also contains source-publisher-handoff.mjs and negative
regressions. The handoff binds the immutable original intake digest to one
Publisher-shaped task with a separate fixed publication branch
(asi/engine-task/<task-id>). It rehashes every change and keeps
authorized:false. It refuses TS/TSX until the existing source preparer has a
pinned syntax checker, and refuses JSON whose bytes would be normalized later.
The source intake now checks the original task and catalog both before and
after awaiting a model/provider callback, rejecting changed scope.

This closes only the **source candidate / shape compatibility** layer. The
real native source preparer still has a hardcoded G2 two-witness rule and the
installed Publisher requires the signed workOrderId, release admission, sandboxed
provider, CI/review and durable receipt. No invocation of the installed Engine
or real end-to-end automated coding cycle is claimed.

## Model coding adapter — 31 Oct 2026 source checkpoint

A real OpenAI Responses API adapter (source-responses-provider.mjs) is now
implemented, without installing a second agent or paid-provider service.
It pins the HTTPS endpoint to https://api.openai.com/v1/responses, demands a
host-configured explicit model, protected API credential and *already
authorized* pre-request model budget, disables model tools and server-side
response storage, requests structured JSON code changes and never retries a
request after unknown outcome. The task's bounded objective is included in the
task binding and revalidated across asynchronous generation.

A separate exact Git SHA reader (source-git-context.mjs) supplies ONLY
allowlisted source file bytes from a clean, privately-owned, DETACHED checkout,
with checked .git/config, source SHA256, no symlinks, content size limits,
matching requested paths and unchanged Git HEAD after reading. The source
coder output still passes through source-work-intake.mjs and
source-publisher-handoff.mjs, then the existing Change Preparer.

The source-provider-offline-cycle.test.mjs actually invokes the existing
Change Preparer on a private synthetic Git repo using a bounded structured
model response returned by an in-memory mocked HTTP transport. It checks
the generated Python syntax, expected file, unmodified source HEAD and
zero GitHub/provider effects. This is an OFFLINE integration proof, NOT
a real model run, real GitHub Draft PR or autonomous Engine acceptance.

### Remaining LIVE activation requirements (not granted by this PR)

1. An authenticated owner-issued, revocable standing parent/child delegation
   from #552, with one enforceable durable budget authorizing both provider
   requests and Publisher operations, zero secret leakage and no per-commit
   owner prompt. A JavaScript callback alone is NOT signed authority.
2. Independently approved provider/model, protected API credential and
   accounted paid-token budget on the existing Beget Engine. No credentials
   or real model calls have been provisioned in this source package.
3. Signed expansion of current two-G2-witness execution catalog through #556
   to one new non-witness source task, and a native transaction-bound
   handoff into the EXISTING preparer / Publisher. Existing G2 hardcoded
   limits must not be bypassed by a task prompt.
4. On Beget with Windows OFF: a real new task → approved source context →
   actual model generation → existing sandboxed checks → reviewed Draft PR →
   exact CI + terminal durable receipt → next task, with no unknown-outcome
   replay and a physical recovery witness.

Do not count 45 passing offline tests as actual 24/7 autonomous coding.
Keep NORMAL_OWNER_CONTROLLED, one existing Engine and one Publisher.

## Ground Zero next-five hardening checkpoint — 31 October

AI coding provider (still source-only):
- snapshot the complete bounded task identity before async context reads and
  recheck immediately before and after a provider budget reservation;
- bind paid-provider pathDigest to exact source bytes and objective, not only
  literal paths/before SHA, without resetting prior native spend;
- require the completed model identity to match the reserved model;
- reject any unexpected tool call or additional output item, even alongside an
  otherwise valid text response;
- continue to fail closed on uncertain API outcome, without automatic retry.

The existing fake-network end-to-end check still invokes the actual
Change Preparer on a private detached Git fixture; no real paid model request,
live GitHub PR, signed owner delegation, five-lane activation or root access.
These safeguards do NOT supply an approved native API spending authority.
