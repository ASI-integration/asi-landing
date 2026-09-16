### Цель
Docs-only Agent OS intake regression fixture.

### Контекст и источники истины
docs/agent-os/DEFINITION_OF_DONE.md
docs/agent-os/WORKFLOW.md

### In scope
- scripts/agent-os/check-agent-intake.mjs

### Out of scope
- Production and staging mutation

### Acceptance criteria
- Incomplete intake is BLOCKED
- Complete intake is READY

### Ожидаемый уровень автономности
yellow — выполнить с обязательным отчётом

### Возможные red-действия
- [x] Нет известных red-действий

### Требуемая проверка
- node --test scripts/agent-os/__tests__/agent-intake.test.mjs

### Staging, rollout и rollback
не требуется

### Решения Николая
не требуются

### Готовность задачи
- [x] Цель и acceptance criteria проверяемы
- [x] Out of scope указан явно
- [x] В Issue нет secrets и персональных данных
- [x] Я понимаю, что red-действия потребуют отдельного явного разрешения
