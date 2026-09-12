# SP-10 — Strigunov closed-beta staging acceptance (Landing #272 + Runtime #127)

Status: **plan only**. Do not execute staging from this document until both PRs are
owner-approved and an explicit staging gate is given.

Pinned heads (update if either PR moves before staging):

| Repo | PR | Branch | SHA |
| --- | --- | --- | --- |
| `ASI-integration/asi-landing` | [#272](https://github.com/ASI-integration/asi-landing/pull/272) | `codex/strigunov-pilot-closed-beta` | use PR #272 HEAD at staging time (cross-repo contract + this plan) |
| `ASI-integration/asi-os-runtime` | [#127](https://github.com/ASI-integration/asi-os-runtime/pull/127) | `fix/owner-control-plane-orphan-slot-recovery` | `61197da129b8eb2f2d15f366cfb139d7519125a1` |

## Contract under test

- Runtime publishes authoritative lane availability on runner-readiness.v2
  `capabilities.executor.state` / `reasonCode` (never Bridge leases).
- Landing `/pilot` create consumes that executor capability after owner-console
  reconciliation. It does **not** parse `execution-slot.json` or `holderStartTicks`.
- Existing-task HITL continues/cancels the **same** `taskId` via the owner-decision seam.
- Public RU copy stays: Готово к работе / В работе / Нужен ваш ответ / Готово /
  Временно недоступно / Не удалось выполнить — no Runtime/Bridge/runner/lane jargon.

## Safe merge / deploy order (for operators)

1. Merge and stage **Runtime #127** first (authoritative executor lane evidence).
2. Then merge and stage **Landing #272**.
3. Do not leave production on new Landing + old Runtime: Landing would trust a
   pre-#127 executor signal that may ignore a busy lane.

## Migration preflight (mandatory, recorded, fail-closed)

Do **not** apply `20260912210000_asi_runtime_bridge_single_lane_admission_v1`
(public) or `20260912210000_runtime_bridge_single_lane_admission_v1`
(`runtime_bridge` staging follow-up) until this count is recorded.

Operator query (use the schema you are about to migrate):

```sql
SELECT count(*)
FROM public.asi_runtime_bridge_tasks
WHERE status IN ('queued', 'running', 'awaiting_owner');
```

Staging free-tier schema variant:

```sql
SELECT count(*)
FROM runtime_bridge.asi_runtime_bridge_tasks
WHERE status IN ('queued', 'running', 'awaiting_owner');
```

| Count | Action |
| --- | --- |
| 0 | Safe to apply. Record the count and SHA, then apply. |
| 1 | Safe to apply. The existing row becomes the unique occupant. Record the count, `task_id`, and SHA, then apply. |
| >1 | **STOP.** Do not apply. Do not pick a winner. Do not delete, fail, cancel, or mutate historical rows. Owner-authorized reconciliation is required first. |

The migration itself re-runs this count and raises
`asi_runtime_bridge_single_lane_preflight_failed` when count > 1, before
creating `idx_asi_runtime_bridge_single_nonterminal`. That is a backstop, not a
substitute for recording the operator query.

This document does not authorize applying the migration.

## Staging sequence (deterministic)

Prerequisites: isolated staging Runtime + Landing at the pinned SHAs above;
invited `pilot_beta` session; green docs/pilot template only; no merge/deploy
capabilities exposed through `/pilot`; **Bridge single-lane migration preflight
recorded as 0 or 1** (see above). Do not start the sequence below if the
preflight count is >1 or unrecorded.

| Step | Action | Pass evidence |
| --- | --- | --- |
| 1 | Healthy runner, free lane | `GET /api/pilot/readiness` → `canSubmit: true`, message `Готово к работе`. Owner readiness `components.executor.state=ready` with diagnostic `runtime_execution_lane_ready` (internal only). |
| 2 | Create first green task | `POST /api/pilot/tasks` → 200/201, returned `taskId=T1`, status queued/running. |
| 3 | Second create while T1 owns lane | `GET /api/pilot/readiness` → `canSubmit: false` / `Временно недоступно`; `POST /api/pilot/tasks` → 503 `readiness_blocked`. Executor reason diagnostic `runtime_execution_lane_occupied`. |
| 4 | Legitimate ACTION_REQUIRED / HITL | With T1 awaiting owner: create still blocked (`runtime_execution_lane_owner_action_required`). `GET /api/pilot/tasks/T1` returns HITL with `canContinue` for allowlisted docs/pilot gate only. |
| 5 | Owner `continue` | `POST /api/pilot/tasks/T1` owner decision `continue` → same `taskId=T1` resumes; no second task created. |
| 6 | Terminal release | T1 reaches succeeded/failed; result card shows `Готово` or `Не удалось выполнить` without internal jargon. |
| 7 | Subsequent create | After lane free again: readiness `canSubmit: true`; create task `T2` succeeds. |
| 8 | Orphan recovery (Runtime-side) | Induce/observe recovered orphan on Runtime (PR #127 path). After next fresh runner-readiness publish with `executor.state=ready`, Landing readiness must reopen (`canSubmit: true`). Landing must not stay blocked by any local slot cache (it has none). |
| 9 | Privilege boundary | Attempt privileged merge/deploy wording / non-allowlisted gate → HITL `canContinue=false` and owner-decision POST 403; create path never accepts client merge/deploy fields. |

## Non-goals

- No production deploy from this plan.
- No merge of #127 or #272 from this plan.
- No copying of Runtime orphan-recovery algorithms into Landing.
- No UX copy changes.
