# Strigunov 4 final acceptance

Decision: **NO-GO / NOT_READY**. No physical five-stage completion is claimed.
Date: 2026-10-18. This is the current evidence register, not a readiness certificate.

| Stage | Actual status | Evidence / remaining gate |
| --- | --- | --- |
| 1. Schema diagnosis | BLOCK | [#494](https://github.com/ASI-integration/asi-landing/pull/494) at b72d3ff70e1ed57d15dc78690c16bffcb831d835: CI SUCCESS, CodeRabbit no actionable comments; merge and diagnostic dispatch await exact owner approvals. [39111579833](https://github.com/ASI-integration/asi-landing/actions/runs/39111579833) remains TRIGGER_DRIFT. |
| 2. Retention A | BLOCK | Policy and executable full-row invariant prepared; owner adoption and new-fixture retention approval pending. [Old witness](https://github.com/ASI-integration/asi-landing/actions/runs/39106534287) proves 24 audit + four physical rows, not a complete future snapshot. |
| 3. Executable isolated acceptance | BLOCK | Existing runner extended; focused source/PG verification recorded in PR. Fresh operator access, schema admission and independent source review required before any physical run. |
| 4. Real staging E2E | NOT_RUN | No new dispatch or stage writes in this task; exact main SHA, owner write authorization and GitHub staging approval mandatory. |
| 5. Independent acceptance/demo | NOT_RUN | Physical E2E, external no-send evidence and human operator/demo access remain unproven. |

## Source and live evidence are separate

[#493](https://github.com/ASI-integration/asi-landing/pull/493) is merged.
Protected main observed: 375569af41080c50fc7d8516531b79deadedcefa.
[#494 CI](https://github.com/ASI-integration/asi-landing/actions/runs/39112711112)
and [independent review](https://github.com/ASI-integration/asi-landing/pull/494#issuecomment-6247705170)
cover exact b72d3ff70e1ed57d15dc78690c16bffcb831d835.
No table names for actual drift may be inferred before the approved diagnostic.

G0 remains pinned to d912aec6663de90e5ca4293cc5a69e2e0ed9ff94.
Source comparison found the CRM auth, physical-readiness route/execution and
Booking Ops scope code unchanged between G0 and this baseline. This supports
compatibility planning; it is not a new live health, DB or service observation.
The ten absent optional modules in the old witness are NOT_DEPLOYED, not zero.

## Proposed demonstration route after GO

Use only the isolated staging fixture: synthetic request -> intake and dedup ->
operator booking queue / authorized CRM -> booking readback -> synthetic cleaner
assignment/completion/verification -> linen delivery/verification -> supplies
verification -> final physical approval -> read-after-write and negative access
checks -> preserved test evidence. No real sending or payment step.

Before GO an independent reviewer must tie every observation to workflow run,
current source SHA, exact G0/database identity and this fixture; verify tenant
isolation, actual operator access, no-send/egress and immutable old evidence.
The final reviewer must record residual limitations and confirm the usable demo
access route without disclosing session material. Source review is not physical
acceptance. No production/customer-channel readiness claim follows from this pilot.

## One next owner operation

Authorize ordinary protected merge of **PR #494**, exact HEAD
**b72d3ff70e1ed57d15dc78690c16bffcb831d835**, with current checks and protections.
Side effect: source merge only. Stop on changed HEAD/checks/protection failure;
never admin override. Verify resulting main SHA and merged state afterwards.
No staging action is included. Its later read-only dispatch needs its own exact
new-main authorization and staging environment review, as required by the task.

The retained execution envelope, policy proposal, one-use identities, expected
side effects, rollback/reconciliation and stop conditions are in
[C4-RETAINED-PILOT.md](C4-RETAINED-PILOT.md).

## Retained package verification

Source package: [PR #495](https://github.com/ASI-integration/asi-landing/pull/495).
Runtime-code commit: 43880c8c307b968823a00b5b6bf4ef672ed70230.
Local 16 focused gate tests and 6 actual isolated PostgreSQL17 tests PASS;
typecheck, touched-file ESLint, syntax, YAML and diff checks PASS. The temporary
cluster was stopped and removed. [Physical source/PG CI](https://github.com/ASI-integration/asi-landing/actions/runs/39114465226)
and [PR validation](https://github.com/ASI-integration/asi-landing/actions/runs/39114465195)
are the initial runtime-code checks; consult the PR checks and CodeRabbit
coverage for the latest exact HEAD. A green source check is not stage acceptance.

Read-only GitHub settings verification in this task confirms classic main
protection: strict required `validate`, admins enforced, force push and deletion
disabled. Staging has a required reviewer and `can_admins_bypass=false`.
No settings were changed. Owner authorization and environment review remain
separate prerequisites despite the configured workflow confirmation strings.
