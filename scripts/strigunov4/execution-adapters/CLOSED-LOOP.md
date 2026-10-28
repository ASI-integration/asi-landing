# Existing Engine closed-loop source candidate

This opt-in addition to `createPublicationLoop` connects the unchanged #529
Dispatcher to the existing Engine lock, ledger, preparation, Publisher, CI and
receipts. It installs no daemon, scheduler, transport, queue or live authority.

The reviewed dependencies are copied unchanged from #529
`ed74fe87f36994fea028562e382d6bb0f9add37c` (dispatcher/product adapter), and #533
`3bc5434f372b8eef2f3fb8d466bc0af49a51f8ad` (stage-authority verifier only).
The source-check ordering in `pr-validation.yml` is reused unchanged from #545
`bd99d4d02ad44dcb44ca1b0644311a5594b15390`. Trusted base release governance is
unchanged. An earlier approval for those SHAs does not approve this integration.

## Transaction and selection

The existing Engine execution lock encloses selection, durable Dispatcher
reservation, preparation, review, Publisher intent/readback and terminal receipt.
The Publisher remains the only writer. A later tick re-reads and hash-verifies
the Engine report/receipt pair before feeding a published work-order identity
back to the Dispatcher. Completed work is excluded and a different admitted
order can be selected. A pending PR resumes before another order is reserved.
Lost responses, retained locks, changed catalogs, corrupt evidence and crashes
remain blocked; there is no automatic stale-lock removal or rollback of receipts.

`closedLoop` requires an existing private routing state, immutable stage policy,
trusted owner-comment reader and finite `maxTicks` (1–100). Policy/catalog must
bind the same IDs, unique work orders, branches, base and paths. The #533 verifier
limits a policy to eight tasks and 14 days, checks the exact owner ID/comment,
and is re-read for revocation before publication mutations. The existing native
Publisher capability and signed host admission remain independently necessary.
This source does not turn a GitHub comment into a host activation grant.

The existing minimum three-minute interval and persisted poll count apply across
restarts. Budget exhaustion stops further reads/preparation; no automatic retry
or model-spend loop is created. The production host must separately admit exact
API/model cost and rate limits and enforce them in its existing ports. This
candidate supplies no model account and incurs no paid API calls in acceptance.

## Independent review

Closed-loop mode requires an explicit `publishedReview` host port; it never
implicitly selects a paid CodeRabbit review. Its immutable policy SHA is bound
into the Publisher capability request. Evidence must identify the repository,
PR, exact head/base, independent reviewer policy and evidence SHA256. The same
evidence is read again before promotion. Only allowlisted metadata is persisted.
The original, non-opted-in Publisher retains its existing CodeRabbit contract.
No live alternative reviewer has been installed or authorized by these tests.

## Current scope and physical boundary

Native Engine/G1/host restrictions are intentionally unchanged. The fixture uses
two distinct existing G1 work orders and inert owner/host-grant data to test the
protocol. It does not reopen G1 or make the current G2 physical-login gate an
autonomous software task. Current G2 has no separately admitted source backlog.

Before any Beget installation: verify the actual old Engine identity and fencing,
its historical state, signed authority/catalog, public key identity, current main
protection, compatible host/stage admission, resource/cost limits and rollback.
Then require one exact owner decision for the named changes. Until then the
existing observer stays read-only; no `RUNNING` server executor is claimed.

## Acceptance

`node --test scripts/strigunov4/execution-adapters/closed-loop.test.mjs`

The positive case performs real isolated Git-file changes and Python checks,
uses a separate local process for review, and traverses the real Publisher/CI
reader against the existing loopback GitHub fixture. Pending publication,
verified first order, verified second order and terminal idle are distinct ticks.
All simulated PRs and host grants are fixtures, not live publications/authority.
SIGKILL proves process-crash handling, not power-loss durability.

## Native host entry point

The existing host-runtime hook now accepts an optional `closedLoop` member only
inside the verified owner-signed activation payload. It contains `policy`,
`intervalMs` (600000–900000), `maxTicks` (1–100), and `reviewMode: coderabbit`.
The stage policy must have the same base and validity as the host envelope;
its task identities must match the signed native catalog. The native host,
G1 stage, single pilot, checks and App restrictions remain unchanged.
This is not Beget/G2 admission or a migration of the installed recovered Engine.

Routing uses the existing Engine root's `routing` directory, which must already
be initialized by a separately admitted installation. No automatic initializer
or fallback runs in the hook. Owner comments are fetched through the existing
authenticated reader, with issue/repository/comment identities checked each time.
No custom published reviewer is implicitly authorized by native host consent.
With no override, the Publisher still requires its full exact-head CodeRabbit
review; skipped review never passes. No provider calls are made by these tests.

`buildRuntimeClosure()` in host-package.mjs creates a non-installable, hashed
source closure preserving scripts/strigunov4 and scripts/global-dispatcher.
The old pilot package layout does not contain the sibling Dispatcher modules;
do not use the old builder/installer/claim to relocate this runtime. The closure
imports successfully but is deliberately marked installable:false. An installed
runner/dependency/authority witness and old-executor fencing remain mandatory.

At the real current G2 map there is no admitted prepare-source work order. This
patch does not reopen G1, publish its pilot again, accept G2 or authorize G3.
The 100-tick bound is finite (at ten minutes, at most about 16h40m); it is not a
14-day unlimited execution grant and is never reset automatically. A Beget
profile, current-stage catalog, check/reviewer implementation and enforceable
cost envelope still require exact admission.
