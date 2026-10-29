# ASI Agent OS v0 — autonomy policy

## Принцип

Агент работает до проверяемого результата и не останавливается ради обычных обратимых решений. Остановка обязательна перед red-действием, при неоднозначной цели или когда нельзя доказать safety prerequisite.

Уровень классифицируется по самому рискованному действию задачи. Разбиение задачи не может искусственно понизить уровень.

## Green — выполнить самостоятельно

Агент выполняет без предварительного разрешения и включает результат в обычный отчёт:

- read-only аудит tracked-файлов, истории и CI metadata;
- поиск, анализ, план и оценка риска;
- изменения документации, тестов и внутреннего tooling без продуктового side effect;
- локальные изменения кода в согласованном scope, если они не затрагивают red-контракты;
- создание task branch;
- focused tests, typecheck и ESLint touched-файлов в пределах `AGENTS.md`;
- локальный dry-run, который доказуемо не пишет данные и не вызывает внешние сервисы;
- подготовка diff, commit message и draft PR body.

## Yellow — выполнить автономно с обязательным отчётом

Агент может выполнить действие без предварительной остановки только при доказанных prerequisites. В отчёте обязательны target, команда/механизм, результат, evidence и rollback/cleanup:

- commit, push task branch и создание/обновление draft PR;
- установка обычных project dependencies из lockfile;
- изменение внутренних API, схем типов или lifecycle seams при наличии focused regression tests;
- создание новой migration без применения к любой базе;
- change-aware расширение тестов сверх минимума, но не broad suite без согласования;
- staging deploy на подтверждённый изолированный target;
- staging data setup/mutation только для deterministic acceptance fixtures с cleanup;
- staging acceptance без реальных сообщений, платежей и production credentials;
- read-only production diagnostics по установленному runbook без вывода secret values или персональных данных.

Если staging identity, isolation, safety flags, fixture ownership или rollback не доказаны, yellow-действие не выполняется и становится blocker. В Agent OS v0 внешние yellow-действия допустимы только после устранения соответствующих блокеров из `BLOCKERS.md`.

## Red — остановиться и получить явное разрешение Николая

Всегда red:

- merge в `main` или изменение release source;
- production deploy и rollback;
- production migrations и любые production DDL;
- production data insert/update/delete/reconciliation/backfill;
- работа с secret values: создание, чтение, замена, копирование или ротация;
- DNS, TLS и публичная маршрутизация;
- платежи, возвраты, provider activation и реальные финансовые операции;
- любые реальные исходящие сообщения или вызовы внешних провайдеров;
- изменение утверждённого UX, публичного RU copy или продуктового обещания;
- изменение location scoring, SSOT или public score contracts;
- изменение GitHub protection rules, environments, reviewers или repository secrets;
- создание/экспорт production backup либо доступ к его содержимому;
- destructive Git rewrite опубликованной ветки, если он явно не заказан;
- широкие тестовые прогоны за пределами бюджета `AGENTS.md`.

## Что считается разрешением

Разрешение должно быть дано Николаем явно и указывать:

1. конкретное действие;
2. точный target/environment;
3. ref/SHA, migration или идентификатор записи, если применимо;
4. допустимый side effect;
5. ожидаемую проверку после выполнения.

Разрешение действует только на указанное действие в текущем цикле. Значение `confirm_*` в workflow — технический предохранитель, но не доказательство разрешения владельца.

## Обязательный red preflight

Перед запросом разрешения агент готовит, но не выполняет:

- точный plan и команды/workflow inputs;
- доказательство target identity;
- dry-run или read-only preview, если он безопасен;
- ожидаемый diff/data impact;
- rollback и stop conditions;
- список секретов по именам без значений;
- post-action verification;
- ссылку на зелёный CI/acceptance evidence.

## Эскалация и запреты

- Не подменять blocker догадкой.
- Не повторять red-действие по старому разрешению.
- Не печатать secrets в логах или отчёте.
- Не использовать production credential для staging.
- Не считать успешный PR check доказательством deploy или live acceptance.
- При конфликте правил применять более строгий уровень и записывать причину в `BLOCKERS.md`.


## DRAFT #551 — standing release envelope (не вступил в силу)

Предложение не меняет v0, действующие owner gates, main/protection или права служб.
Одна будущая подпись ограничивает repository, target/environment, action-class,
App/installation, policy/security digest, точные разрешённые пути, срок до 14 суток,
нулевой paid API budget, счётчик операций и отзыв. Текущий HEAD и artifact digest
проверяются заново по независимому CI/review; смена HEAD внутри этих границ сама
по себе не требует подписи владельца. Изменение security contract, policy, secrets,
permissions или границ требует отдельного решения. Source, release и activation
не взаимозаменяемы; production не входит в данный проект envelope.

`assessReleaseEnvelopeProposal` в существующем governance-модуле — чистая модель,
не используемая `checkPr`, CI admission или host Authority. Она всегда возвращает
`authorized=false`, включая PROPOSAL_ELIGIBLE. JSON от PR не является доверенным
evidence. Существующие exact-HEAD approvals остаются обязательными.

До защищённого включения необходимы: отдельное утверждение policy digest;
trusted-base verifier с аутентифицированным owner/signed envelope и свежим отзывом;
проверка полного diff без rename hiding, policy/security hash из доверенного base;
связанные с exact HEAD независимые CI/review и artifact evidence; интеграция с
существующим durable claim/Authority (atomic budget reservation + task idempotency);
повторная проверка отзыва непосредственно перед effect. UNKNOWN/FAILED_LOCKED
сохраняются, расход бюджета и срок не сбрасываются при рестарте. Подпись не заменяет
branch protection, environments, fencing, native isolation, rollback и host checks.
Криптографический envelopeDigest должен вычисляться по каноническому payload без
поля самого digest; модель не реализует подпись/проверку и не доказывает её.

Миграция: draft/tests → independent review → отдельное принятие новой policy →
интеграция existing Authority/Verifier и CI → изолированные replay/concurrency tests →
отдельно разрешённый physical acceptance. До этого любые release/install остаются
BLOCKED. Откат будущей политики: прекратить новые claims, сохранить журнал и
UNKNOWN, вернуться к v0; не отзывать/менять ключи неявно.
