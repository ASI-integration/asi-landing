# Strigunov G0: limited supervised no-send acceptance

Issue: #464. Draft only; no rollout authorization.

## Baseline and scope

Verified main: `9bc8175aa772e92366c7a2363e26900a042fc3ce`.
Dependency chain (all draft): #453 `5fa6aa30f81f8eeecfd13cba14a56ed2da11efa4` → #454 `b6474bdb976ac5349cf75a6820e6e94896a2efdc` → #455 `eaff188eaa3717480ea771e54fcfb4f482d5209d` → #465.
Custodian #460 `62d551eb55f7eb27b09c9bec3f5f88c2bd50cc98` is separate synthetic evidence, not live owner authority. Atomic outbound quota #423/#424 remains a separate unmerged stack; #424 head `d9e7ec2389476e91e4721129e373359b70c2ba82`. Actual deployed SHA was not probed in this no-production task.

## Reproduced defect and correction

Native run [38866751417](https://github.com/ASI-integration/asi-landing/actions/runs/38866751417), exact head `371fe02cde929dd849bb664685d2485a252a437c`, proved two FIRST submissions created two reservations (PostgreSQL writer PIDs79 and74), conflicting payload returned200 and replay selected another lineage. Both owner sessions were issued by the actual password-login API. Fixture rows after cleanup:0; owned Docker cleanup:PASS. Failed receipts are retained.

The existing `(account_scope_key,idempotency_key)` unique constraint now admits only one account-bound execution before booking side effects. The receipt stores a hash of normalized, recursively key-sorted input. Only completed matching receipts replay; changed payload/property, unavailable reads, ambiguous acknowledgements, force and alternate operator intake actions fail closed. The known booking ID is linked before downstream automation. Catch handling cannot erase lineage or downgrade a possibly completed receipt. Required route audit executes before completion; final route authorization is rechecked.

Run [38867563034](https://github.com/ASI-integration/asi-landing/actions/runs/38867563034), exact head `ecf95b5d23e54d8a3a86aa0e2d5694bf7552cbb6`, passed29 native assertions with4 explicit BLOCK entries. First-write race, conflicting payload, postcommit response loss, restart/replay passed. Typecheck, touched-file ESLint, production build and cleanup passed. Overall CI correctly failed because full G0 acceptance remained BLOCK.

This is a first-writer fence, not a transaction spanning all REST writes. A crash after reservation INSERT and before receipt linkage still needs reconciliation. Unfinished claims never expire automatically. Legacy receipts without the new digest/completion witness, force and non-process account-bound intake actions are deliberately HOLD. They must not be enabled by deleting receipts or fabricating completion. Public unscoped intake remains outside this account-bound fence; it is not approved as the limited pilot ingress. Existing direct booking/operator APIs retain their own authorization rules.

## Private knowledge boundary

Run [38867893730](https://github.com/ASI-integration/asi-landing/actions/runs/38867893730), head `846455e789e287131bdbd4bdc389e1217f230fd4`, reproduced a foreign-property knowledge GET returning200 and a staff-global CRM contact-name leak. Unlike CRM contact ownership, property ownership already has a canonical account relationship. The property-knowledge route now enforces that relationship before direct GET and all POST branches (parse, save and direct update), scopes list queries to owned property IDs, rejects malformed bodies, and rechecks current membership/ownership before returning private records. Empty/error scope never falls back to a global list.

Application pre/post checks do not establish atomic write isolation against a simultaneous property ownership transfer under BYPASSRLS. That database-enforced predicate remains unproven. The CRM negative stays in the runner and must fail until its ownership/role contract is resolved; it is not suppressed to make CI green.

## Gate interpretation

- G0-1 requires private property knowledge, owner CRM semantics, direct/list reads, mutations and revoked sessions. Staff-global CRM and owner-isolated Booking Ops are different role contracts; do not infer owner isolation from staff allowlisting or a response that omits only email/notes. Service-role BYPASSRLS application checks are distinct from nonprivileged SQL permission denial; tenant RLS is not proven.
- G0-2 requires one canonical reservation and consistent lineage. The fixed race is independently reproducible. Uncertain partial completion remains manual HOLD and an explicit acceptance blocker.
- G0-3 proves global outbound stop persistence, four manually injected incident alerts, correct-owner API visibility after restart, gated synthetic prerequisites, worker tasks and closeout. These injected conditions do not prove automatic fault detection. Audit-only `manual.override` is not durable automation takeover. Revision-aware stale acknowledgement remains unproven.
- G0-4 runs all tested API/service children behind an explicit loopback allowlist plus an internal Docker network. Denied local tsx IPC attempts are recorded separately from denied external attempts. Zero external network attempts and no sent/sending intents do not claim direct sender/payment-function instrumentation. Current-main scheduler source independently passes six default-off/dry-run cases; actual activation variables were neither read nor changed. Native live quota admission remains HOLD; no unmerged migration is presented as deployed.

## Reproduction and operational boundary

Run the dedicated G0 workflow on this draft's exact head with the existing owner/event/attempt gates. The runner uses pinned PostgreSQL17/PostgREST/Node images, new in-memory lab credentials, no host ports and no production credentials. It reuses the prior reviewed bootstrap. Failures do not skip independent cases; receipts and owned-resource cleanup are retained. Do not relabel BLOCK as PASS or remove negative assertions to obtain green CI.

No live users, production/staging changes, messages, payments, provider calls, host access, purchases, merges or deployments are authorized. Rollback is abandon this draft; no existing worktree or branch is reset. A limited pilot cannot be activated while any essential gate remains FAIL/BLOCK.
