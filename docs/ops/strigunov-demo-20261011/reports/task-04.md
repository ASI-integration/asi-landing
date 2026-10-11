# Стригунов — Task04: независимая acceptance и audit handoff
11.10.2026. DESKTOP-I29K350. Master task01–04.

## Итог
**PASS — ограниченный исторический синтетический показ пригоден для демонстрации с указанными ограничениями.**
**NOT_MODELED / NOT_RUN — изменение самой политики раннего заезда и отдельные динамические атаки на booking/property/request IDs.**
**BLOCK — объявлять production-пилот готовым или включать реальные операции по результатам этого демо.**
**CodeRabbit NOT_RUN — handoff подготовлен отдельно, сервис не запускался, доступ к локальным файлам ему не предоставлялся.**

Task01/02 не повторялись. Их отчёты, source и machine evidence проверены чтением/хэшами.
Task03 завершён, отчёт полностью read-back verified:
9702B SHA256890766473a233a8ca83d48fe495559b0924bc510f8210c85a55e6e280aec6160.
Task04 — отдельное независимое чтение source/evidence и принятие результатов узкой проверки UI,
а не второй запуск тех же18 Task02 tests.

## Кто и что проверил
Независимый reviewer: /root/task04_independent_acceptance.
Он не писал Task02/03 реализацию, не менял файлы и не запускал tests.
Самостоятельно прочитал:
- master brief, Task01/02 полные reports;
- AGENTS.md и шесть Agent OS policy documents;
- все три новых Task02 файла;
- timeline.json, test-results.json;
- build-viewer.cjs и render-check.cjs до исполнения;
- весь index.html до render;
- evidence-manifest.json, render-results.json после исполнения.
Самостоятельно вычислил SHA256 и подтвердил сохранность Task02 после Task03.
Root выполнил только заранее рассмотренные generator/render scripts и просмотрел screenshots.

## Матрица доказательств
| Требование | Вердикт | Что действительно доказано |
|---|---|---|
| Сохранность Task01/02 | PASS | Старые reports/evidence и три Task02 файла совпадают по SHA256 |
| Historical Task02 acceptance | PASS | 18passed,0failed/pending, один exact test file; повторного запуска нет |
| Source events → UI | PASS | 14 DOM карточек, exact ID/kind/UTC time/detail/raw JSON; render case03 |
| Human approval отдельно от ответа | PASS | Approval11:48; recheck и fake reply11:49; разрешение не выдано за отправку |
| ACK и роли | PASS fixture-only | Required acknowledgment, ожидаемые строковые роли; реальная authentication не проверялась |
| Account/booking/property/request binding | PASS source review | Проверяются все четыре поля |
| Cross-account отрицательный case | PASS historical | Case07 действительно атакует accountId |
| Отдельная подмена booking/property/request | NOT_RUN | Выполненных отдельных негативных cases нет; source review не назван динамической проверкой |
| Missing/stale/future readiness | PASS historical | Cases04–06; перед ответом возраст наблюдения проверяется снова |
| Readiness/cleaning change → revoke | PASS source review | Новое observation или cleaning action очищает decision |
| Новый maintenance blocker | PASS historical | Case13 подтверждает запрет после прежнего approval |
| Изменение самой политики раннего заезда | NOT_MODELED / NOT_RUN | const policy вычисляется один раз; policy version/update отсутствуют |
| Duplicate inbound/action | PASS fixture-local | Cases11–12; память одного fixture, без durable/cross-worker гарантии |
| Duplicate send | PASS fixture-local | Один fake reply; event14 показывает suppression |
| Negative operator/executor | PASS historical | Cases14–15; отрицательных timeline JSON отдельно не сохранено |
| Legal/physical gates | PASS synthetic | Настоящие computePhysicalReadiness/canReleaseCheckInInstructions, синтетические inputs |
| Desktop/mobile presentation | PASS | 12 новых checks, 0FAIL; no horizontal overflow, native details/anchors работают |
| Page network/live sends | PASS checked context | CSP/нет script/adapter и externalPageRequests=[] в offline браузере |
| Host-wide network / hostile same-account isolation | NOT_RUN | Новый browser profile и hashes не являются такой аттестацией |
| Real owner auth / CRM / distributed delivery / restart | BLOCK / NOT_RUN | Эти контуры не доказаны синтетическим fixture |
| RentHouse/CleanControl/Oki-Doki | NOT_INTEGRATED | Реального внешнего подключения нет |
| CodeRabbit external audit | NOT_RUN | Только локальные unpublished артефакты; нет разрешённого upload/publication |

## Подтверждённые ограничения — не скрывать в демонстрации
1. **Policy revocation gap.** Фиксированная классификация12:00 не позволяет проверить изменение политики после решения.
   Stale readiness PASS не закрывает stale policy. UI содержит заметное предупреждение.
   Не исправлялось: текущая задача запрещает менять Task02 source и production.
2. **Динамическая изоляция по остальным IDs не исчерпывающая.**
   Source сравнивает account/booking/property/request; actual case07 проверяет account.
   Для полного динамического доказательства требуются отдельно разрешённые точечные cases.
3. **Положительный timeline не является журналом всех18 tests.**
   В14events есть unknown readiness HOLD, но нет отдельного stale/negative branch.
   duplicateCount=0 относится к identical action replays в этом конкретном показе.
   Event14 действительно подавляет повтор ответа. Inbound/action dedup доказаны отдельным case11, не этим counter.
4. **Роли и actors — fixture provenance.**
   Event02 наследует actor гостевого intake: это инициатор цепочки, а не доказательство права гостя назначать клинера.
   UI не выдаёт эти данные за production authorization.
5. **Некоторые raw reason keys английские.**
   Русские заголовки объясняют смысл, исходные данные сохранены для точной сверки.
   Это небольшое ограничение оформления, не повод менять защищённый Task02.

Не найден новый production exploit: production code не изменён и приложение не запускалось.
Приёмка ограниченного показа PASS не равна закрытию перечисленных пробелов.

## Фактические новые проверки
Положительный allow-list: build-viewer.cjs, затем отдельно рассмотренный render-check.cjs.
Generator exit0; render PID1720 exit0, **12/12PASS**.
Browser: existing Chromium, sandbox enabled, fresh profile, offline, page JS disabled,
service workers blocked, downloads disabled; context закрыт после проверки.
Зависимости не устанавливались, .ps1/policy bypass, серверы, БД, реальные провайдеры не запускались.
Task0218tests не перезапускались.
Desktop1440×1000 и mobile390×844 full-page screenshots сохранены/просмотрены.

## Подтверждённые артефакты
Viewer directory: C:\Users\Admin\asi-strigunov-2x\strigunov-demo-03-20261011

| Артефакт | Байты | SHA256 |
|---|---:|---|
| index.html | 40586 | dfbef4a056146f10a88410d6b4d1dec6f2d96f516e4d3a8a3142aaed6e277af0 |
| evidence-manifest.json | 1210 | 1a268b21003b46c04e56885869f0dc54758d9ff748aff3ad5e4525dbc78798d1 |
| render-evidence/render-results.json | 1612 | e4565bace539a3207d6c8c4f26b9e9bfa8e8301733e2efc2c2e639f8ae76dfa3 |
| timeline.json | 12273 | d5e330e401468cd978a3b363f285ee35e227e477ada3706dbfaea8a4f833e6c3 |
| test-results.json | 7927 | dc0e4401e62a676a6fde74c55225424ddcf8d5d7c8379cbec9ecce4b704c47ef |

Task02 source hashes unchanged:
- demo.ts8148a0a8105c7afcc7d79452300d032034ebd1c94d3e5204f29054be6db4da6e
- test.ts0c46dc67d32252ac9861949895343c351dd6ae2369b8530397f7e6a6f08eeae1
- docs.md6c4b35e5c35e37146160fce6756ae70b335aec7f7cd078be0bc4d98a090d1e36

Source commit/head f42cd99f57bafa681def155a676619a1d80504fe.
Branch astra/strigunov-demo-task02-20261011, worktree C:\tmp\astra-strigunov-demo-task02-20261011.
Task02 остаётся ровно тремя untracked файлами. Viewer находится вне Git.
Git add/commit/push, rename/reset/stash/merge не выполнялись.

## Воспроизводимый показ Стригунову — около трёх минут
1. Открыть файл index.html из viewer directory двойным щелчком/через Проводник.
   Сказать: «Это проверенный синтетический сценарий, внешние системы пока не подключены».
2. Показать запрос на12:00 и шаг3: «Система не обещает заселение, пока готовность неизвестна».
3. Показать ACK и уборку: assigned → in_progress → completed → verified.
   «Завершение работы отдельно от проверки результата».
4. Показать шаги9–12: свежее наблюдение → решение оператора → повторная проверка → один fake reply.
   «Разрешение человека ещё не считается отправкой».
5. Показать последний шаг: повтор ответа подавлен.
6. Раскрыть одну исходную запись: показать время, роль, одну booking identity и evidence.
7. Перейти «Когда нельзя подтверждать»:18historical cases, отдельно оговорить policy change NOT_PROVEN.
8. Открыть ссылку timeline.json/manifest: это сохранённые байты, не анимация или выдуманный live status.
9. Завершить границами: real auth/CRM/restart/send/integrations/production отдельно.

Показ не требует запуска generator, render-check, Node, Dispatcher или веб-сервера.

## Оставшиеся production pilot blockers
Это сохранённые выводы Task01 и границы данного сценария, **не свежий production audit Task04**:
- Privacy/release: Task01 endpoint сообщил252c97488b50376945810d4720ff99e319019525,
  предшествующий privacy fixbc250b2e200834765a8219ef43deebb558d6eaa6.
  Новый production SHA/установленные bytes в Task04 не проверялись.
- Owner auth: успешная авторизованная owner/browser acceptance и отрицательный non-owner access не доказаны.
  Не путать development owner-panel risk с автоматически доказанным Booking Ops bypass.
- CRM: реальные persistence/операторская обработка/consent/cross-worker lead admission не доказаны этой синтетикой.
- Delivery: real transport, atomic quota, crash window, durable dedup и restart recovery не доказаны;
  fake sink и Map не закрывают эти свойства.
- External integration: RentHouse/CleanControl/Oki-Doki не подключены, ручные fixtures не провайдерская подпись.
- Не включать сообщения/пилотный трафик на основании этого PASS.

## Завершение и handoff
CodeRabbit handoff:
C:\Users\Admin\asi-strigunov-2x\strigunov-demo-01-04-coderabbit-handoff-20261011.md

Следующий отдельный шаг: разрешённая передача точного минимального audit bundle после secret/privacy scan,
либо согласование узкой дополнительной acceptance для policy/identity gaps.
Ни передача, ни следующий coding task сейчас не выполнялись.
Остановиться после сохранения, полного readback и SHA256 verification Task04 и handoff.
