# ASI Agent OS v0 — definition of done

Задача считается завершённой только когда результат проверяем, scope чист, а все side effects отражены в отчёте. Наличие кода без evidence не является Done.

## Обязательная связь с релизом

Для новых PR текущая релизная цель, следующий незакрытый этап, его конкретный критерий и фактически изменяемые файлы проверяются через `scripts/agent-os/check-demo-release.mjs` в `validate`.
Отдельный PR может быть DONE, пока `READY_FOR_DEMO` остаётся NOT_READY.
Никакие зелёные тесты/CodeRabbit или написанный код не заменяют физическую приёмку.
Изменение самого реестра этапов требует независимого owner approval на точный PR HEAD; обычная строка `approved` в PR его не заменяет.
Результат каждой диагностики должен вести к решению, а не создавать новую неопределённую диагностическую ветку.

## Нетерминальный статус и запрет ложного завершения

До финального отчёта исполнитель обязан ответить на четыре проверяемых вопроса:

1. **Что действительно завершено?** Назвать исходный продуктовый критерий и конкретный artifact/run/PR/receipt, а не только количество PASS или readiness ZIP.
2. **Почему нельзя продолжить самостоятельно?** Для каждой остановки привести доказанную первопричину, перечень разрешённых вариантов и факт выполнения минимальной допустимой коррекции.
3. **Что конкретно требуется от владельца?** Только новое необходимое red-действие (target, SHA, effect, ограниченный срок и возврат), если уже существующее точное разрешение не подходит. Не запрашивать повторно и не дробить на несколько микроразрешений.
4. **Где возобновить выполнение?** Указать неизменный task ID, checkpoint, сохранённые доказательства и проверяемое событие для возвращения к работе без нового intake.

Если оригинальная цель не выполнена, BLOCKED / PARTIAL / AWAITING_OWNER — это **пауза**, не финальный продуктовый успех. Нельзя заменять невыполненную продуктовую задачу синтетическим тестом, диагностическим PR или подготовительным архивом. Не объявлять completed на основе исправного Engine/Dispatcher без реального следующего цикла.

После временного снятия блокировки инструмента или предоставления дополнительных полномочий в post-action evidence должна присутствовать проверка возврата прежнего состояния; отсутствие возврата является незакрытым blocker.

Клиентская приёмка включает отсутствие необоснованных повторных паролей/окон/согласований и понятное восстановление после типовой ошибки. Контроль риска мошенничества и запрещённых внешних side effects остаётся обязательным; удобство не оправдывает обход защиты.

## 1. Контракт задачи

- Цель, acceptance criteria и out-of-scope сформулированы.
- Определён owner, autonomy level и список red-действий.
- Указаны затронутые product contracts, migrations, UX, external providers и environments.
- Неоднозначности разрешены до потенциально рискованного действия.
- Intake обязан пройти machine check `scripts/agent-os/check-agent-intake.mjs` (Issue form / task input / PR DoD). Incomplete intake — `BLOCKED`, не `READY`.

## 2. Реализация

- Изменён минимальный необходимый набор файлов.
- Существующие seams и SSOT переиспользованы; параллельный flow не создан.
- Нет случайных package, generated, `tmp/` или user-файлов.
- Для bug fix добавлена или обновлена focused regression-проверка, если это практически возможно.
- Новая migration имеет уникальный numeric prefix и проверена как отдельный review artifact; она не применена без отдельного разрешения.

## 3. Проверки

Минимальный default для code change:

- `npm.cmd run typecheck`;
- ESLint только touched-файлов;
- 1–2 focused test-файла или около 30 тестов;
- `git diff --check`;
- review точного `origin/main...HEAD` diff.

Для docs/templates-only change достаточно:

- проверки Markdown/YAML структуры подходящим локальным parser/linter, если доступен;
- проверки ссылок и путей;
- `git diff --check`;
- review точного diff.

Не запускать `npm test`, broad suites или `test:location-golden` без основания и разрешения, требуемого `AGENTS.md`.

## 4. Контрактные проверки по типу изменения

| Изменение | Дополнительное evidence |
| --- | --- |
| Public API/type | consumer search, compatibility check, focused contract test |
| Auth/account scope/RLS | negative cross-account case и server-only boundary review |
| Lifecycle/task | точная identity маршрутизация, idempotency/convergence test |
| Migration file | dependency order test, destructive statement review, dry-run plan без apply |
| RU UI/copy | простая русская формулировка, visual check, явное UX approval если контракт меняется |
| Staging | target identity, SHA, safety flags, fixture ownership, cleanup и acceptance report |
| Production | только owner-approved red runbook с dry-run/preflight и post-action evidence |

## 5. Git и Pull Request

- Работа находится в task branch, `main` не загрязнён.
- В commit staged только task-relevant files.
- Draft PR объясняет что, почему, риск, проверки, rollout/rollback и side effects.
- CI status проверен; failure не скрыт и не объявлен success.
- Merge не выполнен агентом без отдельного red-разрешения.

## 6. Финальный отчёт

Machine-readable result соответствует [`schemas/task-result.schema.json`](schemas/task-result.schema.json).

Отчёт содержит:

- branch, commit SHA и PR URL;
- changed files;
- выполненные checks с точными результатами;
- autonomy classification;
- staging/production/data/migration/message/provider/secret/UX side effects;
- незакрытые blockers и кто должен действовать;
- следующий безопасный шаг.

Если обязательный пункт не выполнен, статус — `BLOCKED` или `PARTIAL`, но не `DONE`.
