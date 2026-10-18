# C4 retained pilot: executable source package, owner decision pending

## Decision A proposed for explicit adoption

Retain incident 39047710115 in place, including all parents, 24 audit events,
four physical rows and the complete source-known linked graph. Never delete,
detach, change ownership, disable triggers or repeat cleanup 39056059835.
The unconditional #492 preservation holds remain unchanged.
This document proposes A; its creation is not owner adoption or write approval.

For the new fixture, propose retention as restricted synthetic test evidence
until owner review on 2026-11-17. No automatic deletion on that date, failure,
workflow cancellation or success. At review, the owner chooses continued
retention or a separately reviewed archive/deletion plan. This is an operational
proposal for synthetic data, not a legal finding or authorization to retain real
customer data. No real contacts or payment instruments enter this fixture.

The exact new root IDs and synthetic operator email are committed in
`scripts/strigunov4/c4_retained_fixture.json`. These are one-use identities,
not a pool for rerunning failed writes. Booking and intake IDs are returned by
the existing API and reconciled by exact root account/property scope.
The run ID remains in names and booking reference. All IDs must be distinct and
outside the old fixture. UUID/email collisions stop before inserts.

## Existing execution path extended

The same physical workflow, Python gate, SSH tunnel, G0 service and lifecycle
runner are used. No new product route or deployment is introduced.
1. Exact owner/repository/main/workflow SHA, current remote main, first attempt,
   staging environment review and two SHA-bound confirmations remain mandatory.
2. Check pinned PG17/TLS/history, source checkout, strict dependency schema and
   old 24+4 evidence. Fingerprint every column of every source-scoped row,
   ordered by complete primary key. Hashes and raw rows stay private in memory.
3. Emit generated root IDs as a durable reconciliation handoff before writing.
4. Confirm the existing G0 release, systemd identity and effective no-send flags.
   The **fresh email** must already be in both effective operator/admin lists.
   Merely setting lists in the child process does not change the server lists.
   This package only reads that prerequisite; it never reconfigures the host.
5. Create new user/account/membership/property, send the existing HTTP intake,
   read back ownership, repeat identical intake, require one booking, read the
   operator queue and authorized CRM route.
6. Require unauthenticated physical read denial and a read-only cross-account
   rejection for the old booking. Never POST against the old booking.
7. Ensure cleaning/linen/supplies tasks twice with identical IDs; advance the
   existing cleaning sequence with synthetic assignee and reports; deliver and
   verify linen, verify supplies, approve readiness and read it back.
8. Preserve new rows. Verify exact roots, one intake/booking, four physical rows
   and availability ownership. Run the same 148-table/234-FK strict census on
   the new identities; reject cross-scope links and any deployed delivery,
   auto-send-attempt or payment rows. Missing modules remain NOT_DEPLOYED.
9. Recheck effective G0 safety and old complete-row equality. The old witness
   runs in finally even after child failure/timeout. Hard cancellation cannot
   guarantee finally: the durable handoff requires read-only reconciliation.

Read-only witnesses use locked REPEATABLE READ READ ONLY snapshots, RLS refusal,
fixed source identifiers and a repeated catalog comparison. Unknown triggers,
FKs, unsafe metadata or permissions block; no dynamic schema broadening.
Source-known trigger signatures do not prove arbitrary function bodies or opaque
JSON/polymorphic references. These limitations remain prerequisites for broader
acceptance; the hash is not a license to mutate the old graph.

## Prepared red execution envelope; NOT authorized here

As of 2026-10-18, #494 and #495 are merged; observed protected main is
beff46e55b73293774d210354d8276bea4812b2b. The single authorized read-only run
[39118692946](https://github.com/ASI-integration/asi-landing/actions/runs/39118692946)
completed after staging review with TRIGGER_DRIFT. It has not established a live
schema PASS. The [fixed history/object matrix](C4-DEPENDENCY-PROOF.md#root-fix-after-protected-run-39118692946-2026-10-18)
is being reviewed source-only; no new protected run is authorized.
Historical pre-merge main was 375569af41080c50fc7d8516531b79deadedcefa; neither
observation is an automatic future write pin. Obtain actual current main `M`
for any separately approved physical run. Current evidence and completed bounded
final-fix review are recorded in [final acceptance](STRIGUNOV4-FINAL-ACCEPTANCE.md).
Workflow: `.github/workflows/strigunov4-c4-physical-core.yml`, ref main.
Inputs: `reviewed_main_sha=M`, `confirm=RUN_STRIGUNOV4_C4_PHYSICAL_M`,
`retention_confirm=RETAIN_C4_PILOT_M` (substitute the complete M in both phrases).
Typed phrases are technical gates, not owner approval artifacts.

Required owner approval must identify exact M, this one-use fixture, adoption
of A and new evidence retention, permitted INSERT/UPDATE effects, and no-send.
A separate GitHub staging reviewer approval is mandatory. All existing stage
secret names remain unchanged; values must stay in the protected environment.
No local credential reads/copies, permission changes, migrations or deployment.

Expected effects: one synthetic user/account/membership/property, one booking
and intake plus existing lifecycle-generated audit/tasks/drafts/readiness and
availability rows; retain the complete graph. No physical cleanup, provider
messages, payments or changes to the old incident are permitted.
Rollback is **stop and retain**, not cascade deletion. On any failure or unknown
COMMIT, record run/SHA/root IDs, stop automatic retries, perform separately
approved read-only reconciliation, then review any further action.

Stop before writes on missing owner/environment approval, main drift, current
TRIGGER_DRIFT, missing new operator access, collision, missing credentials,
wrong host/database/G0/history/TLS or ineffective no-send. Stop after writes on
any HTTP/ownership/negative/readiness/count/hash discrepancy, process timeout,
unknown receipt or postflight failure. Never turn failure into cleanup.

## Acceptance limits

`booking created`, `C4_PHYSICAL_CORE_PASS` and `FULL_PHYSICAL_E2E_PASS` are
separate claims. The runner still reports `fullPhysicalE2E=NOT_YET_PROVEN`.
It never labels retention as `cleanup=PASS`. Even a passing run requires
independent physical review of operator access, complete behavior and external
egress before READY_FOR_DEMO. Effective flags and zero DB delivery rows alone
are not independent network egress evidence. Supervised API session sealing is
not evidence of a tested human UI login. No readiness label is fabricated.
