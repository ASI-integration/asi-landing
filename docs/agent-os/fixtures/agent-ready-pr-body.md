## Результат

Focused Agent OS intake enforcement for AO-006.

## Scope

- Issue: AO-006
- Baseline SHA: 234f5911779f307e3fac230c7243ea388b4066ca
- In scope: agent-ready templates and intake checker
- Out of scope: production, staging, Runtime

## Product contract

- [x] Существующие product invariants сохранены
- [x] Утверждённый UX/public copy не изменён
- [x] Location scoring/SSOT/public contracts не изменены
- [x] Account scope, auth/RLS и server-only boundaries не ослаблены
- [x] Реальные сообщения/provider calls не включены

Отклонения и owner approval: none

## Autonomy и риск

- Уровень: `yellow`
- Риск и mitigation: templates/docs only; fail-closed triage
- Требуемое решение Николая: none

## Изменённые файлы

- `.github/ISSUE_TEMPLATE/config.yml`
- `scripts/agent-os/check-agent-intake.mjs`

## Проверки

| Check | Result | Evidence |
| --- | --- | --- |
| Focused tests | pass | agent-intake.test.mjs |
| Touched-file ESLint | not run | node scripts only |
| Typecheck | not run | no TS changes |
| `git diff --check` | pass | clean |
| Exact diff review | pass | AO-006 only |

Почему skipped checks допустимы: docs/scripts-only change.

## Data, migration и external side effects

- [x] Migration-файлы не менялись
- [x] Ни одна migration не применялась
- [x] Production data не читались и не изменялись
- [x] Staging data не изменялись
- [x] Secrets не читались, не печатались и не менялись
- [x] DNS, платежи и внешние сообщения не затрагивались

## Staging / rollout / rollback

- Staging status: not required
- Target и expected SHA: n/a
- Acceptance evidence: fixture triage
- Rollback: revert PR
- Production status: не запускался

## Blockers и handoff

- Blockers: none for AO-006
- Следующий безопасный шаг: review draft PR
- Что требуется от Николая: merge decision later

## Checklist

- [x] В PR только task-relevant files
- [x] `AGENTS.md` и Agent OS документы соблюдены
- [x] Acceptance criteria закрыты либо явно помечены `BLOCKED`/`PARTIAL`
- [x] CI status проверен
- [x] PR остаётся draft, пока не готов к review
- [x] Merge не выполнялся
