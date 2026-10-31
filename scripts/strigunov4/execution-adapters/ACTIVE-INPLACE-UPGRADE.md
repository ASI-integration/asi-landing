# ASI: active Beget Engine, state-preserving upgrade source candidate

**Status: SOURCE CANDIDATE ONLY. NOT INSTALLABLE. NO ROOT APPLY.**

31 October 2026: Existing asi-strigunov-agent.service is already enabled and
running on Beget pqukibofpo. Its protected live manifest has a source SHA older
than merged protected main and only 19 original runtime modules. The standing
parent/child source merged in #552 is therefore NOT currently resident in the
Engine runtime, let alone signed/adopted.

Original beget-install.py deliberately rejects an existing unit/account/state.
Original beget-staged-repair.py deliberately requires disabled/inactive unit.
NEVER use either to replace the running service, reinitialize private state,
delete a lock or bypass a one-use claim.

## What this change supplies

host-package.mjs can include an explicitly pinned six-module standing source
set as extra roots, plus ONLY five specifically required existing agent-os
imports. Default packaging remains unchanged unless explicitly requested.

beget-active-upgrade-candidate.mjs checks old manifest source hashes and
produces a source package with a continuity report referencing exact old/new
source/manifest/catalog/unit digests. It remains
authorized:false, installable:false. It has NO file replacement, root command,
daemon control, signing, network or migration method. An unsigned manifest or
a GitHub PR comment is never installation authority.

This package adds source bytes but DOES NOT wire standing issuer/revocation,
signed child renewal or cumulative budget into the live request path. A
source-only preview that returns authorized:false must NOT authorize effects.
Missing runtime integration must be independently reviewed before upgrade.

## Separate requirements for a protected active in-place upgrade

1. Independently authenticate current host, systemd InvocationID/unit and all
   installed immutable files. Inspect protected durable ledger, receipts,
   journal and in-flight GitHub operations only through an authorized operator.
   Preserve old generation and signed admission, without revealing secrets.
2. Complete native standing issuer, child renewals, authentic public-key trust
   registry and revocation floor, tied to the existing one native lock. Parent
   duration <=365 days; child <=14 days; no repeat owner approval in scope.
3. Implement a separately independently reviewed and owner-signed active
   update. Require exact old/new manifest and stop/restart scope. First prove
   there is no UNKNOWN/FAILED_LOCKED or in-flight remote GitHub effect.
   Stage new bytes outside live runtime on the same filesystem and durably
   preserve the original generation, budget and receipts before swapping.
4. Controlled replacement of only the existing service, preserving private
   state, one-use claims, budgets and fences. On unknown outcome never replay
   publication or refund provider spend, and keep recovery evidence.
5. Prove exact new PID/InvocationID, signed authority and five admitted
   workstreams with verified per-lane heartbeat; one new real
   code-to-Draft-PR/CI/review/receipt and controlled restart with no replay.

Keep NORMAL_OWNER_CONTROLLED. No second Engine, unauthorized root work,
unbudgeted paid provider calls or physical PASS from source tests.

## Exact signed active-upgrade preflight (source-only)

The separate beget-active-upgrade-preflight.mjs now validates the
existing Ed25519 owner-signed approval envelope under strict
old/new package SHA, pinned Beget host/unit, seven exact
state-preserving actions, and a <=14-day authorization window. A
valid test-fixture signature returns SOURCE_SIGNATURE_VERIFIED with
authorized:false and installable:false. It does not use GitHub
comments as keys or owner-signature custody.

The fixed-path read-only probe refuses non-root operators before
trying to read any protected generation or state. On Beget the
unprivileged asi-dc session returned PRIVILEGED_OPERATOR_REQUIRED
for the exact candidate. This is expected and cannot be bypassed
with a caller-supplied identity, chmod or a forged JSON receipt.

The checked source fixture still DOES NOT provide a root-owned
public-key provenance attestation, native in-flight Publisher lock
inspection, active generation exchange/restart implementation,
independently witnessed rollback/restore, or a live authenticated
365-day parent/14-day child permit. Only a separately authorized
operator can collect and sign those physical facts. The one
existing service must remain active until an explicitly authorized
in-place upgrade has passed those independent gates.
