# ASI Agent OS v0 — blocker registry

Этот registry содержит системные пробелы, мешающие безопасной автономности. Task-specific blocker добавляется только если он повторяем или требует изменения платформы. Секреты и персональные данные здесь не записываются.

## Статусы и приоритет

- `open` — препятствие подтверждено;
- `mitigated` — действует временный ручной контроль;
- `closed` — есть проверяемое техническое решение;
- P0 — возможен production/security impact;
- P1 — блокирует автономный цикл;
- P2 — снижает качество или скорость.

## Открытые blockers baseline

| ID | P | Пробел | Evidence | Временное правило v0 | Условие закрытия | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| AO-001 | P0 | Нет enforced protection для `main` | GitHub API: branch protection отсутствует, rulesets пусты на 2026-07-15 | Merge всегда red; агент не merge | Required PR checks, запрет direct push, review policy проверены тестовым PR | Николай |
| AO-002 | P0 | Нет видимых environment reviewer gates | GitHub API не вернул protection rules/reviewers для environments на 2026-07-15 | Любое внешнее staging/production действие останавливать; typed confirmation не считать owner approval | `staging`/`production` environments имеют согласованных reviewers и branch policy | Николай |
| AO-003 | P0 | Production workflows имеют неодинаковые confirmation gates | Deploy и 3 migration workflows требуют phrase; часть live acceptance/diagnostics полагается только на manual dispatch/environment | Все production workflows считать red независимо от YAML | Общий reusable owner-gate/preflight contract покрывает каждый production workflow | Николай + engineering |
| AO-004 | P1 | Migration process фрагментирован | 82 ordered SQL; direct CLI runbook; Python helpers; только 3 специализированных apply workflows | Создавать migration можно, apply — red; всегда review SQL и target identity | Единый migration runbook, plan artifact, dry-run, apply/verify/rollback policy | Engineering |
| AO-005 | P1 | Staging migration count устарел | Bootstrap doc говорит 80, tracked baseline содержит 82 | Перед staging считать файлы заново, не доверять числу в prose | Count генерируется/проверяется CI, runbook не содержит ручное число | Engineering |
| AO-006 | P1 | Нет machine-enforced agent-ready intake/DoD | До v0 отсутствовали Issue/PR templates и Agent OS docs | Использовать новые templates вручную | Templates включены в default flow и проверяются triage automation | Николай + engineering |
| AO-007 | P1 | Test selection частично статичен | PR workflow запускает фиксированный набор tests; `AGENTS.md` задаёт change-aware локальный бюджет | Локально выбирать focused tests по touched seam; CI не считать полным contract proof | Change-to-test map или risk labels формируют обязательный matrix | Engineering |
| AO-008 | P0 | Acceptance safety неоднородна | Staging full lifecycle создаёт/изменяет/удаляет fixtures; production acceptance scripts могут писать/cleanup data | Любую production mutation считать red; staging запускать только при доказанной isolation/fixture ownership | Каждый runner выдаёт machine-readable plan/result, `noExternalActions`, target и cleanup evidence | Engineering |
| AO-009 | P1 | Нет установленных project Skills | В baseline нет `asi-task-execution`, `asi-staging-acceptance`, `asi-production-rollout` | Следовать Agent OS docs вручную | Skills реализованы, validated и forward-tested на безопасных fixtures | Engineering |
| AO-010 | P1 | Current release не обновляется автоматически | Baseline SHA и активные gates ведутся вручную | Проверять `origin/main` при каждой задаче; snapshot не считать live truth | Release manifest генерируется CI и проверяется PR/release workflow | Engineering |

## Добавление blocker

Новая запись должна содержать:

- короткий стабильный ID;
- доказательство из файла, CI/API или воспроизводимого результата;
- заблокированное действие;
- временное безопасное правило;
- проверяемое условие закрытия;
- owner без secret/contact details.

Закрытие blocker требует ссылки на PR/settings evidence и проверки на отдельном безопасном сценарии.
