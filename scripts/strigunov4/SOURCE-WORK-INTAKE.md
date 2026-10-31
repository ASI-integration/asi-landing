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
