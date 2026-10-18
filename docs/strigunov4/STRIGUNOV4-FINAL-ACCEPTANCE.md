# Strigunov 4: acceptance after #495

Decision: **NO-GO / NOT_READY**. Observation: 2026-10-18; refreshed after protected diagnostic completion at 10:34 UTC.
No new booking, physical acceptance or independent egress proof is claimed.
This register supersedes the historical register retained below.

## Current five-stage evidence

| Stage | Status | Verified result / remaining condition |
| --- | --- | --- |
| 1. Protected dependency diagnostic | BLOCK: TRIGGER_DRIFT | [39118692946](https://github.com/ASI-integration/asi-landing/actions/runs/39118692946), job 117649791595 completed after reviewer approval. One missing source-known compatibility trigger, zero unexpected signatures. Exact migration/function state is still unknown. Root-fix matrix and safe receipt: [dependency proof](C4-DEPENDENCY-PROOF.md#root-fix-after-protected-run-39118692946-2026-10-18). |
| 2. Retention A | BLOCK: owner adoption | Full old graph preservation and stop-and-retain behavior are implemented. The proposal below is not adopted; the fresh complete live census remains blocked at stage 1. Historical 24 audit + four physical rows remain the last row evidence. |
| 3. New isolated E2E admission | BLOCK | Merged source and exact-head CI PASS. Bounded independent review of the final receipt fix is complete. Fresh effective server operator/admin membership and usable human demo login are not yet proved. No host configuration was changed or inspected through an alternate credential path. |
| 4. Physical staging E2E | NOT_RUN | No writer dispatch. Exact-SHA owner write approval, adopted retention policy, successful preflights and separate staging approval are required. |
| 5. Independent acceptance/demo | NOT_RUN | Full observed journey, usable operator UI and independent absence of external effects are still missing. READY_FOR_DEMO and FULL_PHYSICAL_E2E_PASS are not established. |

## Exact source and protected diagnostic

Observed protected main: `beff46e55b73293774d210354d8276bea4812b2b`.
Both [#494](https://github.com/ASI-integration/asi-landing/pull/494) and
[#495](https://github.com/ASI-integration/asi-landing/pull/495) are MERGED.
Final #495 head: `f44a8dd8ae31dc9c7360b5bf59abc34167db056c`;
its merge commit is the observed main above. Branches were not renamed.

The owner authorized exactly one dependency read-only diagnostic on that main.
Existing runs were checked before dispatch; no matching dispatch existed.
Actor identity, current main, read-only workflow/source, required prerequisite
jobs and staging environment protection were checked before dispatch.
The workflow uses protected secrets only after the environment gate and
read-only PostgreSQL transactions; it does not run the physical lifecycle.

Exact inputs of run 39118692946:

```text
workflow=.github/workflows/strigunov4-c4-dependency-readonly.yml
ref=main
reviewed_main_sha=beff46e55b73293774d210354d8276bea4812b2b
confirm=PROVE_C4_DEPENDENCIES_beff46e55b73293774d210354d8276bea4812b2b
incident_run=39047710115
```

| Job | Result at observation | Evidence |
| --- | --- | --- |
| offline_source_tests | PASS | [117649660517](https://github.com/ASI-integration/asi-landing/actions/runs/39118692946/job/117649660517) |
| isolated_dependency_postgres | PASS | [117649660371](https://github.com/ASI-integration/asi-landing/actions/runs/39118692946/job/117649660371) |
| protected_dependency_readonly | BLOCK: TRIGGER_DRIFT; no dependent row census | [117649791595](https://github.com/ASI-integration/asi-landing/actions/runs/39118692946/job/117649791595) |

The reviewer approved the existing run; it returned TRIGGER_DRIFT at 10:34 UTC.
It must not be approved or rerun again under the consumed authorization.
The exact safe JSON and root-fix matrix are in [dependency proof](C4-DEPENDENCY-PROOF.md#root-fix-after-protected-run-39118692946-2026-10-18).
The live absence of version 20260810290000 or its function remains unproved.
The reader's unconditional source expectation is being corrected through a new
source-only PR, with exact history/object agreement and unchanged protections.
No live trigger/function installation, migration or schema broadening is authorized.

[#496](https://github.com/ASI-integration/asi-landing/pull/496) remains OPEN at
`d08d7234b5f90dd6dd0de419adcab06484512397`, CI and exact-head documentation review
PASS. Its earlier waiting-for-reviewer snapshot is now superseded here; its
branch/worktree is untouched. The new technical PR carries that documentation
forward plus the root fix, so do not merge the old snapshot independently.
Protected main remains beff46e55b73293774d210354d8276bea4812b2b at inspection.

Next protected operations are separately gated, in this order:

1. Owner approval for ordinary protected merge of the new technical PR's exact
   final reviewed head, after required CI and CodeRabbit. No admin override.
2. On actual resulting main M, fresh owner approval for the fixed dependency
   read-only workflow and inputs documented in dependency proof; then separate
   staging reviewer approval. No dispatch is performed in this task.
3. A proven effective fresh-operator/no-send preflight through the existing
   protected procedure. No arbitrary host credential extraction or changes.
   If allowlists are missing, prepare a separate exact configuration decision.
4. Owner adoption of the retention proposal below and a separate exact-M physical
   INSERT/UPDATE authorization, followed by staging review. Recheck main, schema,
   operator access and no-send before creating anything. Stop-and-retain on any
   uncertain result; no DELETE or automatic retry.

## Verification of the merged source

Exact final #495 CI: [PR validation](https://github.com/ASI-integration/asi-landing/actions/runs/39116663712)
(validate and isolated recovery PostgreSQL PASS),
[physical gate unit and isolated retention PG17](https://github.com/ASI-integration/asi-landing/actions/runs/39116663719)
PASS, [C4 source tests](https://github.com/ASI-integration/asi-landing/actions/runs/39116663663)
PASS, [backup offline checks](https://github.com/ASI-integration/asi-landing/actions/runs/39116663701)
PASS. Protected writer and isolated_full_e2e were SKIPPED; these are not live PASS.
Previous unchanged runtime checks are reused rather than repeating broad suites.

The final two-file fix retains sanitized booking/intake IDs when the old-evidence
postcheck fails, both after child success and after a child Gate error.
Source inspection confirms the final guard receives the saved safe receipt;
two regression tests cover those cases and reject a secret field. This removes
the confirmed loss of returned IDs. It does not recover IDs that a killed or
unreadable child never returned: reconcile by durable root IDs and do not retry.
The old snapshot comparison still executes in finally; hard cancellation can
prevent finally. Read locks do not provide a write fence throughout the run.

Independent bounded source review of the final #495 fix is now complete:
[CodeRabbit exact-range reply](https://github.com/ASI-integration/asi-landing/pull/496#issuecomment-6248763346).
It inspected `4233a811de9c792d36eac9f972c84eedde379510..f44a8dd8ae31dc9c7360b5bf59abc34167db056c`,
both complete resulting Python files, and confirmed identical blobs on merged main.
No actionable defect was found in the requested two-file diff. Both new failure
paths preserve sanitized returned IDs; no cleanup, retry or guard bypass was added.
The reply is bounded source review, not full lifecycle/application review or live
acceptance. Its earlier waiting-run observation is superseded by the later
TRIGGER_DRIFT receipt above. Its main-protection query returned 403; the authorized
local GitHub read separately verifies protections, without changing them.

CI metadata is associated with the final #495 head; PR workflow checkout used
GitHub's synthetic merge commit `77f7fae`, rather than testing that head directly.
The logged 18 gate tests include both final receipt regressions. This qualification
also applies to ordinary PR CI in the new source-only package; report the actual
checkout when evaluating coverage. Source review and CI do not establish staging
history, operator login or absence of external effects.

## Proposed owner retention decision; not a write authorization

Adopt A: leave incident 39047710115 and its complete source-scoped graph in place,
including all parents, 24 audit events, four physical rows and the pristine
Telegram draft. Do not modify, detach or delete any old evidence. Never retry
cleanup 39056059835, whose outcome remains WRITE_UNCERTAIN_RECONCILE_BEFORE_RETRY.

For the separate one-use fixture in `scripts/strigunov4/c4_retained_fixture.json`,
retain one synthetic user/account/membership/property, one deduplicated booking
and intake, and all generated audit, task, draft, readiness and availability
rows as restricted test evidence. Root user/account/property IDs are respectively
`dc194ac7-e586-4f7a-bd27-52fe743a89b7`,
`1ed26348-32e1-4e19-ae0d-07d3658f42ab`,
`ac431190-8cdb-4dfe-be89-3f3f83e258fc`.
No actual total row count is asserted before execution. No real guest contacts,
provider messages or payments are allowed. Review retention on **2026-11-17**;
that date never triggers deletion. Continuation or a later archive/deletion plan
requires a separate decision. This operational proposal does not cover real data.

Stop on approval/SHA/schema/operator/no-send/identity mismatch before writes.
After any failure, timeout, unknown COMMIT or evidence discrepancy: stop and
retain, preserve run/SHA/root and returned child IDs, then separately authorize
read-only reconciliation. No automatic cleanup or reuse of the one-use fixture.
Opaque JSON/polymorphic links and trigger function bodies remain proof limits.

Owner adoption of this proposal alone does not authorize host changes or writes.
A future write decision must specify actual current main M, this fixture and
permitted INSERT/UPDATE effects. See [the execution envelope](C4-RETAINED-PILOT.md).
The narrow dependency diagnostic authorization does not cover a separate host
probe, server allowlist changes, migrations, deployment or a writer dispatch.

## Human demonstration and independent acceptance

After all gates pass, demonstrate only the retained synthetic staging fixture:

1. Open the approved staging operator UI using a genuinely tested human login.
   No session material is included in evidence; a sealed API session is not a
   demonstrated human login. The existing synthetic password hash is not proof
   of usable interactive credentials.
2. Show synthetic intake and its repeated identical request resolving to one
   booking; show the operator queue and authorized CRM booking details.
3. Show cleaning assignment, completion and verification; linen delivery and
   verification; supplies verification; final readiness approval and readback.
4. Show denial for an unauthenticated visitor and a read-only cross-account
   request. Do not POST against the old booking.
5. Match retained new IDs and old before/after equality to the exact run, main,
   G0 release and staging database. An independent reviewer records results.

G0 remains a source pin `d912aec6663de90e5ca4293cc5a69e2e0ed9ff94`, not a new
live observation. The new operator email must be present in both effective
server allowlists; child environment variables do not configure that server.
The current authorization has not established that fact.

The reviewer must separately establish no external Telegram/email/OTA delivery
or payment attempt over the run interval using authorized independent runtime/
egress evidence. Effective flags and zero database delivery rows alone are
insufficient. No monitoring configuration is changed under this task.
Until that evidence and the full human-observed journey exist,
C4_PHYSICAL_CORE_PASS cannot be promoted to FULL_PHYSICAL_E2E_PASS.
READY_FOR_DEMO would only cover this synthetic demonstration, not commercial
production readiness. Production and Sentinel remain untouched.

## Protection observation

Classic main protection: strict required validate (app 15368), admins enforced,
force push/deletion disabled. Staging: required reviewer ASI-integration,
can_admins_bypass=false, custom branch policy main only. No protection or secret
setting changed. A token's ability to approve does not authorize self-approval.

## Historical register preserved verbatim

The following pre-merge snapshot is historical. Its main SHA, merge requests,
review coverage and stage statuses are superseded by the dated evidence above.

<details>
<summary>Pre-merge acceptance register (historical, not current instructions)</summary>

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

</details>
