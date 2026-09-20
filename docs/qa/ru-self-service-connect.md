# RU: от первого экрана до подготовки объекта

Baseline: `e438803a5dfe167198b36670984decd5bea381c0`.
Ветка: `feat/ru-self-service-connect`.

## Что было проверено на действующем сайте

Главная отправляла посетителя к форме заявки `#pilot-form`; инструкция находилась глубоко на странице. Первый экран говорил о «ручной координации». `/connect` обещал 7 дней с регистрации, хотя публичные условия говорят о 14 днях после готовности. Обычный `/dashboard/channel-connections` показывал панель; форма подключения зависела от операторских contactId/objectId. Мобильная версия действующей главной также просмотрена.

## Изменение

Три широкие плашки ведут в `/ru/connect`. После Google или email/пароля пользователь возвращается в `/dashboard/channel-connections?setup=1`: менеджер → площадки → данные одного объекта → проверка готовности. Шаги сохраняются на сервере, можно продолжить позже. Владелец и управляющий определяются по членству в аккаунте; accountId/propertyId не принимаются от клиента.

Переиспользуются действующая авторизация, ops_v17_onboardings, properties, база знаний объекта и RU commercial pilot lifecycle. Выбор менеджера сохраняет намерение подключения, но не выдаётся за рабочую интеграцию. Доступы и возможности площадок проверяет ASI; автоматическое подключение всех площадок не обещается. Запуск остаётся за существующим процессом проверки, бесплатные дни не начинаются при регистрации/входе. После передачи на запуск повторная анкета не перезаписывает объект. Участие в «Стрегуново» отмечается явно, без заранее установленной галочки.

Прочие информационные секции сохранены. Интерфейс международного подключения сохраняет прежнюю сетку и оформление. Незаданный тариф при входе больше не сбрасывает существующий. Добавлен небольшой dev-wrapper для совместимости Next.js с управляемым локальным просмотром; зависимости не менялись.

## Проверки

- PASS: 30 тестов в 3 целевых файлах: journey (17), homepage (6), design acceptance (7).
- PASS: ESLint всех изменённых и новых TS/TSX-файлов.
- PASS: `npm run typecheck` отдельно от сборки.
- PASS: `npm run build` (134 статические страницы; существующая конфигурация пропускает lint/typecheck внутри build, поэтому они запущены отдельно).
- PASS: `git diff --check`, review полного изменённого кода.
- PASS: desktop — проверены первый экран и публичное подключение; каждая из трёх плашек реально нажата и открыла `/ru/connect`.
- PASS: responsive iframe 390 и 360 px, desktop browser engine; нет горизонтального переполнения, первая плашка помещается в 844 px высоты; мобильный переход открывает публичную форму. Это проверка адаптивной вёрстки, не физического телефона.
- PASS в изолированных тестах: email signup/login с bcrypt; неверный пароль/дубликат; OAuth redirect/state; запрет раннего trial; сохранение шагов; account isolation; ошибки БД и повтор сохранения; запрет изменений после запуска.
- SKIP: настоящий Google OAuth, cookies реального браузерного входа и запись в рабочую Supabase. Локально нет настроенных секретов и тестовой базы. Подменённые границы в тестах не являются доказательством live E2E.
- SKIP: отдельный site:audit crawler — требует другого браузерного механизма; вместо него выполнена непосредственная проверка через разрешённый браузер.

## Граница готовности

Код и локальная проверка готовы для draft review. Полный live acceptance остаётся PARTIAL: перед merge требуется пройти вход и четыре шага в настроенной тестовой среде и подтвердить сохранение в реальной БД. Никакие рабочие объекты или пользователи для проверки не создавались. Production, миграции, DNS, платежи и отправка реальных сообщений не затрагивались. Deploy и merge не выполнялись.

## Авторизация изменений

Исходный запрос владельца прямо разрешает заменить первый экран, CTA, условия группы и путь подключения. Это основание для изменений red-категории public UX/commercial flow; дополнительное разрешение на эти же изменения не требуется. Оно не распространяется на deploy или merge. Старые тесты текста заменены проверками утверждённого пути, количества/назначения CTA и условий; остальные acceptance guards сохранены.


## Исправление schema blocker и передача оператору (PR #318)

База исправления: `8cedcb3a863aa9a3a310ed075e2e17a9354bcfcf`. Последующие изменения UI из этой ветки сохранены. Homepage/copy и компоненты формы не менялись.

- В signup/login/Google token/Google callback восстановлен выбор по `getIsRuHost()`: RU → `ruCommercial`, international → прежний `deferTrial`.
- RU account создаётся с name/plan_code и owner membership. Не передаются lifecycle_status, trial_started_at, trial_ends_at; не создаётся subscriptions clock. Повторный RU login также не пишет таймер. Дефолт схемы subscription_status не является clock и не используется как RU commercial SSOT.
- Старый `/api/auth/onboarding` приведён к тому же RU-правилу, чтобы через него нельзя было случайно запустить 14 дней при регистрации. International ветка сохранена.
- Завершение анкеты создаёт `verify_channel_manager` в существующей `ops_operator_tasks`, видимой оператору в operational board. Задача содержит account/property/manager/channel summary; Wi-Fi и инструкции доступа в неё не копируются. Повторная отправка использует существующий dedup lookup и обновляет описание открытой задачи, не сбрасывая работу оператора. Это минимальный handoff, не полный автоматический bridge. Гарантию конкурентной уникальности сверх существующего repository здесь не добавляли.
- Ошибка создания задачи возвращает ошибку сохранения: wizard не переходит в завершённый шаг; повторная попытка проверена.
- Удалена запись `ops_v17.data.channelManager` из owner intake: анкета не создаёт параллельный статус подключения. SSOT подключения не меняется; RU pilot clock остаётся в `ru_commercial_pilot_lifecycle`.

Проверки исправления: focused/auth **39/39** в 5 файлах; `test:location-golden` **457/457** в 76 файлах; typecheck PASS; полный lint PASS с существующим предупреждением `ThemeProvider.tsx:49` (useMemo dependency); diff-check PASS. Первая сборка скомпилировала код и 134 страницы, но упала на очистке `.next/export` (ENOTEMPTY); выполнен повтор после очистки только сгенерированного каталога.

Regression fixture по умолчанию отклоняет любую запись accounts.lifecycle_status с PGRST204. В этих условиях проходят RU signup, membership, login и оба Google-входа. Отдельно проверено прежнее international lifecycle_status=signup, без trial clock. Все БД/session/provider boundary в тестах изолированы; production schema не менялась и live signup этим отчётом не подтверждается.

Миграции, production, merge, deploy, секреты и реальные внешние сообщения не затронуты. Расширенные auth/location проверки явно запрошены владельцем в задаче исправления.

Финальная сборка: **PASS**, `npm run build`, exit 0, 134 страницы после полной очистки сгенерированного `.next`. Runtime/конфигурация/зависимости проекта не менялись. Implementation commit: `7ba5f47ff04e6cdea503e996d93c8270ee298848`. Исправление auth blocker и минимальный operator handoff завершены; live E2E остаётся отдельной непроведённой проверкой исходной полной приёмки.

## Final RU public-path gap review — 2026-09-20

Base: `a5ecac2336367120bb7c3c5df618feb048cf2274`, same draft PR #318.

- One `RU_HOME_METADATA` source now supplies title/description for host-routed `/` and `/ru`. Title: «ASI сама ведёт рутину ваших объектов». Description includes free setup, 14 days after readiness and optional 1 000 ₽/object/month. International metadata remains unchanged; runtime tests cover both hosts and HOST_VARIANT=ru.
- Preserved approved H1, three wide CTAs, four steps and all commercial terms. Replaced the tentative «ASI создаётся» and abstract lower-section paragraphs with direct product language. Added the two-sentence ASI Global/product explanation. Comparison is now three short items; card headings and dialogue labels are more readable. Example: «Поздний выезд нужно согласовать. Передаю вашу просьбу управляющему». Compact footer now describes object routine, not only guest messaging.
- Owner wizard labels now use «закрытой группы Ярослава Стригунова». No auth, billing, connection SSOT or operator-handoff implementation changed in this iteration.
- Updated obsolete text assertions, retained structural/commercial guards, added three metadata regression tests. The browser spec's group-name assertion follows the approved name; this spec was not run through a second browser driver.

Verification:
- PASS: 72 focused homepage/metadata/auth/connect/billing tests across 9 files, including RU signup against a fixture without accounts.lifecycle_status and operator-handoff retry.
- PASS: `npm run test:location-golden`, 457 tests / 76 files.
- PASS: `npm run typecheck`; ESLint on all touched TypeScript files; `git diff --check`.
- PASS: production build, 134 pages. First attempt collided with the running dev server's generated cache; stopped preview, moved generated .next aside and rebuilt cleanly. No runtime/config/dependency changes committed.
- Browser: local HOST_VARIANT=ru. Desktop root, all three CTA clicks, header CTA, /ru/connect and legacy /connect redirect inspected. Responsive iframe content viewports 390 and 360 px; no horizontal overflow. Inspected hero/header, steps, pricing, comparison, capability cards and bottom CTA/footer. Mobile menu entry opens /ru/connect. Production build also served locally for final verification.
- LIMITATION: responsive desktop-browser frames are not physical-device testing. Live email/Google authentication, real session cookies, real database persistence and live operator task delivery remain unverified: local credentials and a test database are not configured. Isolated auth/connect tests are not live E2E evidence.

Code is ready for final review; full-task acceptance remains PARTIAL pending live auth-to-wizard acceptance in a configured test environment. No merge or production deploy.
