# ASI Agent OS — Phase 2

## Цель

Сделать task contract проверяемым машиной и дать агенту единый безопасный путь от intake до draft PR. Phase 2 не меняет product behavior и не включает внешние среды.

## Порядок реализации

| Этап | Результат | Статус |
| --- | --- | --- |
| 1 | Draft 2020-12 validation для task preflight, result, owner gate и safety artifacts | implemented |
| 2 | Единый owner-gate contract; typed confirmation не является approval | implemented |
| 3 | Change-to-test map с fail-closed protected/red classification | implemented |
| 4 | Repository Skill `asi-task-execution` и локальные validators | implemented |
| 5 | Docs-only agent-ready pilot Issue | created: `#103` |
| 6 | Safe internal-tooling code-fix Issue | created: `#104`, scheduled after `#103` |
| 7 | Staging acceptance | contract-only; допускаются только isolated fixtures |
| 8 | Production rollout | read-only preflight artifacts only; dispatch отсутствует |

## Не входит в Phase 2 без отдельного red-разрешения

- merge и изменение release source;
- repository settings, branch protection и environment reviewers;
- production deploy, rollback, migrations или data mutations;
- работа со secret values, DNS, платежами и реальными сообщениями/provider calls;
- изменение утверждённого UX/public copy.

## Локальная проверка

```powershell
node scripts/agent-os/validate-contracts.mjs
node --test scripts/agent-os/__tests__/contracts.test.mjs
python C:/Users/Admin/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/asi-task-execution
```
