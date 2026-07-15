## Результат

<!-- Что изменилось и какой проверяемый outcome получен? -->

## Scope

- Issue:
- Baseline SHA:
- In scope:
- Out of scope:

## Product contract

- [ ] Существующие product invariants сохранены
- [ ] Утверждённый UX/public copy не изменён
- [ ] Location scoring/SSOT/public contracts не изменены
- [ ] Account scope, auth/RLS и server-only boundaries не ослаблены
- [ ] Реальные сообщения/provider calls не включены

Отклонения и owner approval:

## Autonomy и риск

- Уровень: `green` / `yellow` / `red`
- Риск и mitigation:
- Требуемое решение Николая:

## Изменённые файлы

<!-- Сгруппируйте по назначению; не вставляйте generated/unrelated files. -->

## Проверки

| Check | Result | Evidence |
| --- | --- | --- |
| Focused tests | not run | |
| Touched-file ESLint | not run | |
| Typecheck | not run | |
| `git diff --check` | not run | |
| Exact diff review | not run | |

Почему skipped checks допустимы:

## Data, migration и external side effects

- [ ] Migration-файлы не менялись
- [ ] Ни одна migration не применялась
- [ ] Production data не читались и не изменялись
- [ ] Staging data не изменялись
- [ ] Secrets не читались, не печатались и не менялись
- [ ] DNS, платежи и внешние сообщения не затрагивались

Если что-либо выше неприменимо, укажите exact target, dry-run, impact, cleanup и approval:

## Staging / rollout / rollback

- Staging status:
- Target и expected SHA:
- Acceptance evidence:
- Rollback:
- Production status: не запускался / ожидает отдельного red-разрешения

## Blockers и handoff

- Blockers:
- Следующий безопасный шаг:
- Что требуется от Николая:

## Checklist

- [ ] В PR только task-relevant files
- [ ] `AGENTS.md` и Agent OS документы соблюдены
- [ ] Acceptance criteria закрыты либо явно помечены `BLOCKED`/`PARTIAL`
- [ ] CI status проверен
- [ ] PR остаётся draft, пока не готов к review
- [ ] Merge не выполнялся
