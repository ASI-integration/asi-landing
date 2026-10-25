# ASI — панель процессов (наблюдение)

Owner directive 25.10.2026. `/dashboard/development/processes` использует существующую владельческую сессию и `ASI_DEVELOPMENT_OWNER_EMAILS`. Вход — из `/dashboard/development`; ссылка на `/dashboard/engine-progress` сохранена. GET `/api/dashboard/development/processes` возвращает 401 без сессии, 403 вне allowlist и private/no-store для владельца.

Четыре карточки: Backup G → H; Стригунов 4/G2 (фиксированный HOLD); серверные архивы; Runtime Worker. Канонические критерии G2 читаются из JSON текущей установленной версии приложения. Панель не утверждает физическую приёмку этапа и не меняет карту. Нет кнопок исполнения, запуска, остановки, merge или повторного задания.

## Источники и свежесть

Существующий `scripts/mission-control-reporter.py` дополнен отдельным режимом `--operations-panel`. Он читает существующие `jobs/*.json`, указанный backup summary и необязательный итоговый inventory SHA-256. Проверяет наличие PID через tasklist; PID не отправляется в браузер. Режим не вызывает старый сборщик других продуктов, не пишет локальные latest.json, не меняет Tkinter app.py и не запускает задачи.

- Число файлов берётся из verified_files/planned_files, ошибки из errors; объём verified_gib/gib_total является округлённым источником значением.
- SUCCESS становится DONE только при полном числе файлов и нуле ошибок.
- Исторический результат серверных архивов требует четырёх разных записей с PASS, SHA-256 и размером. Время — mtime ранее сформированного итогового отчёта, не новый hash-check. Копии независимые; внешняя БД и лаборатория не покрыты, восстановление не доказано.
- Присутствие Worker не доказывает ACTIVE/DONE задания: task остаётся UNKNOWN.
- Отдельные sourceUpdatedAt, observedAt, receivedAt. Отсутствующий источник — UNKNOWN. Неизменяемая историческая квитанция не получает новое время проверки от heartbeat. RUNNING backup без обновления 120 секунд — STALE даже при живом reporter. Отключённый транспорт через 120 секунд делает устаревшими все передаваемые карточки. G2 остаётся HOLD.

## Существующий HTTPS transport

Используется POST `/api/internal/mission-control/status` и уже разрешённая серверная credential-проверка Mission Control. Владелец читает данные через отдельный session-only GET. Machine ingest credential не предоставляет браузерный доступ; новая схема не создаёт task/queue/authorizer вызовов. Не выдавать credentials посторонним.

Новый envelope `asi.operations.v1` содержит только allowlisted идентификаторы/enum, числа, UTC даты, SHA-256. Extra fields, произвольные тексты, пути, названия ключей и raw logs отклоняются. Хранится отдельный `operations.json` в существующем Mission Control state directory, mode 0600; существующие project status/task/Engine файлы не переписываются. Atomic rename сохраняет целостность чтения, внутри процесса записи последовательны. Нет постоянного lock после аварии; при нескольких web workers возможна потеря одного конкурентного наблюдения, следующий свежий отчёт восстанавливает статус. Это телеметрия, не claim выполнения.

В operations-режиме разрешён только HTTPS endpoint без query/userinfo; редиректы запрещены, сертификаты проверяются стандартной библиотекой. Тайм-аут 8 секунд, последовательные запросы, интервал не меньше 5 секунд. Нет входящего доступа к Windows, tunnel или новой службы. По умолчанию существующий endpoint указывает на основной сайт — до разрешённого deployment НЕ запускать push туда.

Подготовительная проверка, без сети:

```powershell
python scripts/mission-control-reporter.py --operations-panel "ПУТЬ_К_СУЩЕСТВУЮЩЕЙ_ПАНЕЛИ" --backup-inventory "ПУТЬ_К_ИТОГОВОМУ_INVENTORY" --dry-run
```

После подключения точного разрешённого preview со штатной авторизацией и уже настроенным credential:

```powershell
python scripts/mission-control-reporter.py --operations-panel "ПУТЬ_К_СУЩЕСТВУЮЩЕЙ_ПАНЕЛИ" --backup-inventory "ПУТЬ_К_ИТОГОВОМУ_INVENTORY" --endpoint "https://РАЗРЕШЁННЫЙ_PREVIEW/api/internal/mission-control/status" --loop --interval 7
```

Пароли/токены не вводятся в командной строке. Применяется существующий механизм получения credential; не печатать его и не переносить в browser bundle. Не запускать второй reporter, если существующий уже переведён в этот режим. В этой задаче установка фонового reporter и внешний deployment не выполнялись.

## Приёмка и безопасное отключение

Локально: focused TS tests, Python reporter regressions, ESLint/typecheck, реальный HTTP owner 401/403/200 и страница из task branch; изолированные credentials не считаются live owner login. Браузер должен опрашивать через 7 секунд без перекрывающихся запросов и сохранять последние значения с признаком STALE при сбое.

Внешняя приёмка: утверждённый HTTPS preview exact SHA, владелец входит штатно с компьютера/телефона, минимум два новых Windows отчёта видны на странице, счётчики соответствуют summary, raw source paths отсутствуют, G2 HOLD, остановка только reporter даёт STALE и не влияет на копирование/Tkinter/Worker. До этого не объявлять web operational PASS.

Отключение ограничено reporter этой панели и её preview. Не останавливать backup/Worker/Engine; не удалять исторические отчёты. Нет миграций, task state edits, production/Sentinel или защиты дисков.
