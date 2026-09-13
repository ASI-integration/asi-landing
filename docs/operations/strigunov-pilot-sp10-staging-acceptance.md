# SP-10 — Strigunov closed-beta staging acceptance (Landing #272 + Runtime)

Status: **staging runbook, isolated staging environment only**. This document
does not authorize a production merge or deploy, and does not authorize
applying any migration. It describes the exact, deterministic staging
sequence an operator runs against isolated staging Runtime + Landing
checkouts at the pinned SHAs below.

Staging can be run from the exact commit SHAs pinned below **without
merging either PR**. Merging is not required to run isolated SP-10 staging
acceptance.

## Pinned accepted revisions (PRE-SP10)

These are the **pre-SP10 accepted code revisions** — the exact Landing and
Runtime commits this runbook stages and exercises. They are not a
production deployment target.

| Repo | PR | Branch | Accepted SHA |
| --- | --- | --- | --- |
| `ASI-integration/asi-landing` | [#272](https://github.com/ASI-integration/asi-landing/pull/272) | `codex/strigunov-pilot-closed-beta` | `52d7c63e3629036b87786b0cba7f7d12e3e9e979` |
| `ASI-integration/asi-os-runtime` | [#127](https://github.com/ASI-integration/asi-os-runtime/pull/127) | `fix/owner-control-plane-orphan-slot-recovery` | `6c417eafd4d9ecb054b557b4e2128cd989f35eef` |

The prior Runtime pin `61197da129b8eb2f2d15f366cfb139d7519125a1` is obsolete
and superseded by `6c417eafd4d9ecb054b557b4e2128cd989f35eef`, which adds the
restart-safe `runner_reconcile_owner_gate` consumer exercised in step E
below. If either PR moves before staging, update this table before running
the sequence.

## Contract under test

- Runtime publishes authoritative lane availability on runner-readiness.v2
  `capabilities.executor.state` / `reasonCode` (never Bridge leases).
- Landing `/pilot` create consumes that executor capability after owner-console
  reconciliation. It does **not** parse `execution-slot.json` or `holderStartTicks`.
- Existing-task HITL continues/cancels the **same** `taskId` via the owner-decision seam.
- Owner-gate crash-recovery reconciliation (`reconcile_asi_runtime_bridge_owner_gate`)
  survives a Runtime restart while a task is `awaiting_owner`, without creating a
  duplicate gate and without requiring manual file deletion.
- Public RU copy stays: Готово к работе / В работе / Нужен ваш ответ / Готово /
  Временно недоступно / Не удалось выполнить — no Runtime/Bridge/runner/lane jargon.

## Migration order (staging only)

Do not apply any migration until the mandatory non-terminal count preflight
(below) has been run and recorded, and its result is 0 or 1.

### public schema

1. `20260912210000_asi_runtime_bridge_single_lane_admission_v1.sql`
2. `20260913000000_asi_runtime_bridge_owner_gate_reconcile_v1.sql`

### `runtime_bridge` staging schema

1. `20260912210000_runtime_bridge_single_lane_admission_v1.sql`
2. `20260913000000_runtime_bridge_owner_gate_reconcile_v1.sql`

The owner-gate reconciliation migration (`...owner_gate_reconcile_v1`) is
applied **only after** the corresponding single-lane admission migration
(`...single_lane_admission_v1`) has succeeded, in both schemas.

## Migration preflight (mandatory, recorded, fail-closed)

The non-terminal count preflight happens **before** the single-lane
migration is applied, in either schema.

Do **not** apply `20260912210000_asi_runtime_bridge_single_lane_admission_v1`
(public) or `20260912210000_runtime_bridge_single_lane_admission_v1`
(`runtime_bridge` staging follow-up) until this count is recorded.

Operator query (use the schema you are about to migrate):

```sql
SELECT count(*)
FROM public.asi_runtime_bridge_tasks
WHERE status IN ('queued', 'running', 'awaiting_owner');
```

Staging schema variant:

```sql
SELECT count(*)
FROM runtime_bridge.asi_runtime_bridge_tasks
WHERE status IN ('queued', 'running', 'awaiting_owner');
```

| Count | Action |
| --- | --- |
| 0 | Proceed. Record the count and SHA, then apply. |
| 1 | Proceed. The existing row becomes the unique occupant. Record the count, `task_id`, and SHA, then apply. |
| >1 | **STOP.** Do not apply. Do not pick a winner. Do not delete, fail, cancel, or mutate historical rows to force the count down. Owner-authorized reconciliation is required first. |

The single-lane migration itself re-runs this count and raises
`asi_runtime_bridge_single_lane_preflight_failed` when count > 1, before
creating `idx_asi_runtime_bridge_single_nonterminal`. That is a backstop, not
a substitute for recording the operator query above.

This document does not authorize applying any migration on its own; the
operator runs and records the preflight, then applies migrations as an
explicit staging step.

## Runtime / Landing staging order (operator sequence)

1. Database migration preflight (record the non-terminal count; see above).
2. Apply the single-lane admission migration (public, then `runtime_bridge`
   staging schema).
3. Apply the owner-gate reconciliation migration (public, then `runtime_bridge`
   staging schema).
4. Stage Runtime at the exact accepted SHA
   (`6c417eafd4d9ecb054b557b4e2128cd989f35eef`).
5. Verify Runtime health/readiness before touching Landing.
6. Stage Landing at the exact accepted SHA
   (`52d7c63e3629036b87786b0cba7f7d12e3e9e979`).
7. Execute the SP-10 acceptance sequence below.

Staging uses the pinned commit SHAs directly; it does not require merging
either PR into its base branch, and this runbook does not authorize doing
so. Nothing in this sequence implies or authorizes a production deployment.

## SP-10 acceptance sequence (deterministic)

Prerequisites: isolated staging Runtime + Landing at the pinned SHAs above;
invited `pilot_beta` session; green docs/pilot template only; no merge/deploy
capabilities exposed through `/pilot`; **Bridge single-lane migration preflight
recorded as 0 or 1**, and both migrations applied in the order above. Do not
start the sequence below if the preflight count is >1 or unrecorded, or if
either migration has not been applied.

| Step | Action | Pass evidence |
| --- | --- | --- |
| A | FREE — healthy runner, free physical lane | `GET /api/pilot/readiness` → `canSubmit: true`, message `Готово к работе`. Owner readiness `components.executor.state=ready` with diagnostic `runtime_execution_lane_ready` (internal only). Physical Runtime lane state FREE. |
| B | FIRST TASK — create T1 | `POST /api/pilot/tasks` → 200/201, returned `taskId=T1`, status queued/running. T1 is the sole non-terminal Bridge task. Physical Runtime lane state RUNNING, owned by T1. |
| C | SECOND CREATE BLOCKED | While T1 owns the lane: `GET /api/pilot/readiness` → `canSubmit: false` / `Временно недоступно`; `POST /api/pilot/tasks` → 503 `readiness_blocked` (`admission_busy`-equivalent). Executor reason diagnostic `runtime_execution_lane_occupied`. No T2 row is created in `asi_runtime_bridge_tasks`. |
| D | OWNER GATE — T1 reaches ACTION_REQUIRED | T1 transitions to `awaiting_owner` (`ACTION_REQUIRED`). Create remains blocked (`runtime_execution_lane_owner_action_required`). `GET /api/pilot/tasks/T1` returns HITL with `canContinue` for the allowlisted docs/pilot gate only. Physical Runtime lane remains occupied by T1 (`ACTION_REQUIRED`). |
| E | RESTART WHILE AWAITING OWNER | Controlled staging Runtime restart while T1 is `awaiting_owner`. Verify: `reconcile_asi_runtime_bridge_owner_gate` reconciliation runs on restart even though normal execution readiness is blocked; physical lane remains `ACTION_REQUIRED`; Landing still shows the exact same pending gate (`taskCycle`/`gateId` unchanged); no duplicate owner gate row is created; no manual file deletion is required to recover; T2 cannot be created during or after the restart. |
| F | OWNER CONTINUE | Owner approves/continues the allowlisted gate: `POST /api/pilot/tasks/T1` owner decision `continue`. Verify: the old `ACTION_REQUIRED` generation is safely released/fenced (prior lease token invalidated, not deleted); the same Bridge task `T1` is reclaimed (no new `taskId`); `ownerDecision` recorded as exactly `"approved"`; T1 resumes under a new physical RUNNING generation; no second Bridge task is created. |
| G | TERMINAL | T1 reaches succeeded/failed. Result card shows `Готово` or `Не удалось выполнить` without internal jargon. Old reconciliation evidence (superseded gate/lease rows) is cleared appropriately. Physical Runtime lane becomes FREE. |
| H | NEXT TASK | After lane free again: readiness `canSubmit: true`. `POST /api/pilot/tasks` → T2 can now be created. |
| I | OWNER REJECTION OR EXPIRY (if practical in staging) | Exercise one controlled rejection or gate-expiry case on a separate task. Verify: the task becomes terminal (failed/rejected); Runtime releases the exact old hold (physical lane returns to FREE, no orphaned `ACTION_REQUIRED`); no continuation occurs on that task. |
| J | PRIVILEGE BOUNDARY | Attempt privileged merge/deploy wording / a non-allowlisted gate → HITL `canContinue=false` and owner-decision POST 403. Create path never accepts client merge/deploy fields. Existing merge/deploy denial checks are preserved end-to-end. |

## Evidence to record

For every SP-10 run, record:

- Landing SHA
- Runtime SHA
- Migration filenames applied (all four, in the order above)
- Preflight non-terminal count (per schema)
- Staging timestamp
- T1 `taskId`
- T2 `taskId` if created
- Readiness state at each transition (steps A–J)
- Runtime physical lane state at each transition: FREE / RUNNING / ACTION_REQUIRED
- Bridge task state at each transition: queued / running / awaiting_owner / completed / failed
- Owner-gate `taskCycle` / `gateId` (identifiers only)
- Restart point (step E) and post-restart reconciliation result
- Final verdict (PASS / BLOCK)

Do **not** record:

- `leaseToken`
- `originalLeaseToken`
- `ownerToken`
- Runner credentials
- Secrets
- Full sensitive gate payload contents

## Pass / fail

**SP-10 PASS** requires all of the following, evidenced across steps A–J:

- Exactly one non-terminal Bridge task at any point in time.
- Exactly one physical Runtime execution owner at any point in time.
- No concurrent executor.
- The owner gate survives a Runtime restart (step E) with no duplication and
  no manual recovery step.
- Reconciliation is idempotent (re-running it does not create a second gate
  or a second RUNNING generation).
- Approved continuation resumes the **same** Bridge task (step F).
- A terminal or rejected task releases the lane safely (steps G, I).
- A subsequent task becomes admissible only after the lane is free (step H).
- Pilot exposes no privileged merge/deploy path (step J).

**Any violation of the above is SP-10 BLOCK.**

## Non-goals

- No production deploy from this plan.
- No merge of either PR from this plan.
- No copying of Runtime orphan-recovery algorithms into Landing.
- No UX copy changes.
- No mutation of historical Bridge task rows to force the preflight count down.
