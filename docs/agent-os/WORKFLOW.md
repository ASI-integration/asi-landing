# ASI Agent OS v0 — autonomous task workflow

## Выпуск прежде отдельной задачи

Для активного демонстрационного релиза единственный источник этапов — `docs/agent-os/releases/strigunov4-demo.json`. Первым действием агент определяет `nextStage` через `node scripts/agent-os/check-demo-release.mjs`. Следующая задача допустима, только если закрывает конкретный критерий этого этапа.

Новый PR после введения правила указывает `Release-Stage`, `Release-Mode`, а для диагностики — `Release-Diagnostic-Iteration`. CI сравнивает фактический diff с закреплёнными путями этапа. Предыдущие PR #502, #508 и #509 не блокируются задним числом. Одобрение изменения контракта/исключения проверяется по точному SHA через GitHub-комментарий владельца, а не по словам агента в PR.

После двух диагностических PR по одному этапу вместо нового анализа агент обязан выдать выбор: конкретный ремонт, безопасная изоляция, ограничение объёма релиза или точечная помощь инженера. Ни скорость, ни владелец не могут отменять обязательные требования безопасности без отдельного явно разрешённого процесса.

Задача DONE и релиз ACCEPTED — разные состояния. Переход к следующему этапу допускается после подтверждения физических критериев текущего и отдельного владельческого решения. Доказательства должны относиться к реальному источнику/run/SHA, а не к синтетическому unittest. Контракт нельзя самостоятельно менять, чтобы обойти запрет или повысить готовность.

## «Стригунов 4» / S4-G1: одно разрешение на безопасный цикл

В пределах **утверждённой цели текущего этапа и его точного списка файлов** агент
не запрашивает по одному разрешению на каждое обычное действие. Получив задачу,
он самостоятельно выполняет анализ, локальные правки, точечные тесты, проверку
типов и линтера, commit/push в **свою существующую согласованную ветку**,
публикацию и обновление PR, проверку CI и CodeRabbit, исправление замечаний
в том же scope и подготовку итогового отчёта. Предпочтителен **один связный
пакет с проверяемым результатом**, а не цепочка микрозаданий. Не переименовывать
существующие ветки, не плодить PR и не повторять уже подтверждённые действия.

Это постоянное **правило организации green/yellow-работы**, а не право на
произвольные изменения: обязательно соблюдать `AGENTS.md`,
`AUTONOMY_POLICY.md`, `OWNER_GATE.md`, действующий `nextStage`, ограничения
тестов и автоматические проверки GitHub. При неизвестном SHA, противоречащих
свидетельствах, нехватке изоляции или неразрешённом выходе за scope — **BLOCKED**;
не объявлять успех и не выполнять слепые повторные операции.

С владельцем связываться **одним пакетным запросом только по реальным красным
границам**: merge, изменение канонического контракта/защиты, секреты,
новые платежи/расходы, изменение серверов и DNS, применение SQL или данных,
реальные сообщения, переход на следующий физический этап, внешние защищённые
approval gates. Каждое такое действие по-прежнему требует точного
target/SHA/эффекта и предусмотренного независимого подтверждения. Уже
полученное разрешение на безопасную работу **не пере-запрашивать**; разрешение
на один red-шаг не распространяется на другой.

GitHub-движок и серверный автопилот могут повторять **только допустимые
чтения и обратимые source-only шаги**, пока их исполнительные адаптеры,
реальное состояние, остановки при ошибке и внешние полномочия не приняты.
Успешная автоматическая проверка не заменяет физический S4-G1 PASS и не
открывает S4-G2. Приоритет — минимальный работающий пилот, а не развитие
движка ради самого движка.

## Полный цикл

### 1. Intake

Агент читает agent-ready Issue, `AGENTS.md`, `CURRENT_RELEASE.md`, `PRODUCT_CONTRACT.md` и документы затронутого контура. Затем фиксирует:

- цель и acceptance criteria;
- in-scope/out-of-scope;
- предполагаемые файлы и consumers;
- green/yellow/red уровень;
- требуемые checks;
- возможные blockers.

Default GitHub intake — только form `.github/ISSUE_TEMPLATE/agent-ready-task.yml` (`blank_issues_enabled: false`). Triage workflow `.github/workflows/agent-intake-triage.yml` и checker `scripts/agent-os/check-agent-intake.mjs` fail-closed блокируют неполный Issue. Если Issue неполный, статус `BLOCKED`/triage comment; агент не объявляет задачу `READY`. Вопрос владельцу нужен только когда разные ответы меняют продуктовый контракт или риск.

### 2. Baseline и ветка

1. Проверить `git status -sb`, текущую ветку и remote.
2. Не захватывать unrelated tracked/untracked changes.
3. Обновить read-only сведения об `origin/main`.
4. Создать отдельную task branch от согласованного baseline.
5. Зафиксировать baseline SHA в рабочем отчёте.

### 3. План и preflight

- Проследить существующий flow от entry point до persistence/external boundary.
- Найти tests, acceptance и runbook.
- Проверить protected areas и migration impact.
- Определить минимальный patch и focused validation.
- Для red подготовить preflight, но остановиться до side effect.

Phase 2 preflight записывается по [`schemas/task-preflight.schema.json`](schemas/task-preflight.schema.json). Проверки выбираются через [`change-to-test-map.json`](change-to-test-map.json), а red-действие дополнительно следует [`OWNER_GATE.md`](OWNER_GATE.md). Typed confirmation остаётся только техническим предохранителем.

### 4. Реализация

Агент вносит минимальное изменение, сохраняет существующие seams, добавляет focused evidence и обновляет документацию только там, где изменился контракт. При новом факте, повышающем риск, уровень пересчитывается немедленно.

### 5. Локальная проверка

Порядок по умолчанию:

1. static review и search consumers;
2. focused test;
3. ESLint touched-файлов;
4. typecheck;
5. `git diff --check`;
6. точный diff и status review.

Для docs-only задач code checks не запускаются без причины. Broad suite требует отдельного обоснования и разрешения по `AGENTS.md`.

### 6. Publish

Для green/yellow scope агент:

1. stage только явные task paths;
2. проверяет staged diff;
3. делает один или несколько осмысленных commits;
4. push task branch;
5. создаёт draft PR по repository template;
6. проверяет PR diff и CI status;
7. исправляет собственные ошибки в той же ветке.

Push и draft PR — yellow: обязательны branch, SHA, URL, changed files и checks в отчёте.

### 7. Staging

Staging нужен, когда локальные проверки не доказывают интеграционный контракт. До запуска агент обязан доказать:

- отдельный staging target и database identity;
- ожидаемый commit SHA;
- отсутствие production credentials;
- disabled/dry-run external sends;
- acceptance-safe fixture и cleanup;
- rollback path.

В v0 агент не запускает staging, если GitHub protection/identity prerequisites из `BLOCKERS.md` не закрыты. После их закрытия staging deploy и безопасная acceptance могут стать yellow.

### 8. Owner gate

Николай подключается только когда:

- требуется red-действие;
- конфликтуют product contracts;
- невозможно доказать target/record identity;
- требуется broad validation;
- blocker требует внешней настройки или бизнес-решения.

Запрос должен быть коротким: действие, причина, target, evidence, side effect, rollback и точная формулировка требуемого разрешения.

### 9. Release и production

Merge, production deploy, production migration/data mutation, secrets, DNS, платежи, реальные сообщения и UX contract changes не являются продолжением общего разрешения на задачу. Для каждого нужен отдельный red gate. После разрешения агент следует конкретному runbook, проверяет exact SHA/target, выполняет stop conditions и возвращает post-action evidence.

### 10. Завершение

Агент сверяет `DEFINITION_OF_DONE.md`, обновляет `CURRENT_RELEASE.md` только в release-changing PR, регистрирует новые системные blocker gaps и выдаёт итоговый отчёт. Draft PR остаётся unmerged до решения владельца.

Phase 2 result artifact соответствует [`schemas/task-result.schema.json`](schemas/task-result.schema.json). Repository Skill [`.agents/skills/asi-task-execution/SKILL.md`](../../.agents/skills/asi-task-execution/SKILL.md) автоматизирует этот локальный цикл, но не расширяет полномочия агента.

## Статусы

| Статус | Значение |
| --- | --- |
| `READY` | Контракт и prerequisites достаточны для автономной работы |
| `IN_PROGRESS` | Реализация или проверки продолжаются |
| `AWAITING_OWNER` | Подготовлен red preflight, требуется Николай |
| `BLOCKED` | Нельзя безопасно продолжить без внешнего изменения или решения |
| `PARTIAL` | Полезный результат создан, но часть acceptance недоступна |
| `DONE` | Выполнен весь DoD, обязательных действий не осталось |

## Формат blocker handoff

```text
BLOCKER: AO-XXX / краткое имя
Blocked action: точное действие
Evidence: что проверено
Risk: почему нельзя продолжать
Need from Nikolay: одно конкретное решение/действие
Resume condition: проверяемое условие
Safe work completed: что уже готово
```
