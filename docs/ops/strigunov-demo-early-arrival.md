# Стригунов: синтетический ранний заезд в 12:00

Task 02, base SHA `f42cd99f57bafa681def155a676619a1d80504fe`.
Это один локальный сценарий поверх существующих Booking Ops решений.
RentHouse/CleanControl и Oki-Doki **не подключены**. Все имена и идентификаторы синтетические.

## Что переиспользуется

- `classifyCanonicalCheckinTime`, `buildCanonicalRuCheckinTimeReply`: настоящая классификация 12:00 и условный ответ.
- `buildOperatorHandoffDecision`: настоящее консервативное решение передачи оператору.
- `validateCleaningTransition`: настоящие переходы pending → assigned → in_progress → completed → verified.
- `computePhysicalReadiness`: настоящие проверки уборки, белья, расходников, ремонта и финального подтверждения.
- `canReleaseCheckInInstructions`: настоящий совместный physical/legal gate.

Новые файлы не импортируются production entrypoints. Это не новый scheduler или worker.
Время свежести (5 минут), роли синтетических участников, журнал, входные события и приёмник ответов —
явно локальная композиция демо, не новая production авторизация.
Решение оператора связано с конкретными account/booking/property/request и ревизией наблюдения.
Любое новое наблюдение/изменение уборки отменяет предыдущее разрешение.
Перед записью ответа готовность вычисляется повторно с текущим временем.
Исторически записанный ответ не удаляется, если позже появился блокер: новый ответ запрещён.

## Показ

`runStrigunovEarlyArrivalDemo()` запускается только из проверенного focused test:
11:40 МСК запрос гостя → условная политика → одна задача уборки и передача оператору →
безопасное ожидание → acknowledgment → уборка назначена/начата/завершена/проверена →
наблюдение готовности и ручной legal fixture → решение оператора →
повторная проверка → один ответ в синтетическом массиве → повтор подавлен.
В журнале каждого шага есть actor, время, evidence и идентификаторы брони/задачи/решения.
Pending/отрицательные ответы представлены безопасным текстом и событием, но не выдаются за доставку.
Один положительный ответ попадает в fake sink; реальных отправок нет.

## Безопасность запуска

Production physical-readiness module имеет тяжёлые импорты. **Не запускать demo обычным import в приложении.**
Focused test до загрузки этого модуля заменяет ровно пять границ на throwing stubs:
`@/lib/supabase`, `repository`, `lifecycle`, `tasks`, `lifecycle-autopilot-service`.
Проверяемые readiness/policy/transition/handoff функции не подменяются.
После каждого теста проверяется ноль вызовов запрещённых границ.
Canon не имеет runtime imports; handoff имеет только type imports; node:crypto не вызывает сеть.
Нет application setup, реальных адаптеров, env/secret reads, DB/Git/host writes в тестовом графе.
Import safety и точные хэши должны быть независимо проверены перед любым запуском.

Положительный allow-list: только
`src/lib/booking-ops/__tests__/strigunov-early-arrival-demo.test.ts`.
18 cases: полный сценарий; policy/handoff; completed≠verified; missing readiness; stale;
future/invalid time; cross-account; missing decision; legal hold; previous checkout;
повторы; replay conflict; новый blocker; отказ оператора; отказ исполнителя;
неверная роль/переход; missing acknowledgment; неизменяемый snapshot/время.
Широкие тесты, production acceptance и внешние интеграции не входят в Task02.

При проверенном runner разрешён Vitest run с точным include одного файла, node environment,
без setup/globalSetup, без watch/API/coverage, максимум один worker, без автозагрузки .env.
Существующие зависимости разрешено только читать; cache/report писать лишь в task evidence directory.
Нельзя обходить Restricted, менять ExecutionPolicy или повторять запрещённый запуск иным способом.
Если runner не разрешён, сохранить CODE_ONLY / NOT_RUN и предложить отдельный изолированный CI.

## Пределы доказательства и следующий шаг

Дедупликация здесь process-local; она не доказывает cross-worker/restart durability или atomic delivery.
Уборка и ручное решение — синтетические входы, не реальные подписи/аутентификация работника.
Production rollout, owner browser acceptance, публичные privacy gates и distributed delivery остаются отдельными.
Task03 candidate: показать полученный проверенный журнал в существующем изолированном интерфейсе
с явной меткой «синтетический сценарий». Task03 не запускать в рамках Task02.
Фактические результаты и хэши: внешний `astra-strigunov-demo-task-02-result-20261011.md`.
