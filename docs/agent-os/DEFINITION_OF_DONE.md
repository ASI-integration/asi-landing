# ASI Agent OS v0 — definition of done

Задача считается завершённой только когда результат проверяем, scope чист, а все side effects отражены в отчёте. Наличие кода без evidence не является Done.

## 1. Контракт задачи

- Цель, acceptance criteria и out-of-scope сформулированы.
- Определён owner, autonomy level и список red-действий.
- Указаны затронутые product contracts, migrations, UX, external providers и environments.
- Неоднозначности разрешены до потенциально рискованного действия.

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
