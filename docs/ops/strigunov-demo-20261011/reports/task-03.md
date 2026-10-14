# Стригунов — Task03: локальный визуальный показ
11.10.2026. DESKTOP-I29K350, Remote Desktop Commander.

**PASS — локальный read-only viewer создан и проверен.**
12/12 presentation checks PASS. Task02 не перезапускался и не изменялся.
Master assignment разрешает после этого продолжить Task04; ограничение старого brief «STOP after Task03» заменено только в этой части.

## Где открыть демо
Файл:
C:\Users\Admin\asi-strigunov-2x\strigunov-demo-03-20261011\index.html

Локальный URL:
file:///C:/Users/Admin/asi-strigunov-2x/strigunov-demo-03-20261011/index.html

В Windows: открыть Проводник, вставить полный путь к index.html в адресную строку и нажать Enter.
Или вставить file:/// URL в адресную строку Chrome/Edge.
Ничего устанавливать, запускать сервер или входить в production не нужно.
JSON links работают, пока соседние timeline.json, test-results.json и evidence-manifest.json лежат рядом с HTML.
Открытие страницы не запускает тесты, сценарий, provider или отправку.

## Что видно
- Крупный баннер «СИНТЕТИЧЕСКОЕ ДЕМО — НЕ PRODUCTION».
- Одна синтетическая бронь/квартира; запрос заезда в12:00.
- 14 карточек, по одной на фактический event исходного timeline.json.
- Время МСК, роль участника, исходный текст события, состояние и раскрываемый exact JSON.
- Отдельные ACK, уборка assigned/in_progress/completed/verified, наблюдение готовности,
  решение оператора, повторная проверка, один ответ в fake sink, подавление повторного ответа.
- Неизвестная readiness показана фактическим HOLD на шаге3.
- 18 ранее выполненных tests показаны отдельным разделом; stale/negative outcomes не выданы за новые события.
- Отдельное предупреждение: изменение самой политики заезда не моделировалось/не проверено.
- Approval в11:48 явно отделён от synthetic reply в11:49.
- Physical/legal inputs названы fixtures; реальные документы/подписи отсутствуют.
- Ссылки на исходные JSON и manifest; исходный SHA256 виден на странице.
- Нативные раскрывающиеся details и переходы по разделам работают без JavaScript.
- Статическая история не имитирует живую работу или автоматическое обновление.

## Изоляция и неприкосновенность Task01/02
Исторические evidence проверены по байтам, а не повторным исполнением:
Task01 report24512B SHA2562a9fa68e32517d102978d12062fb683a41a7aabe92c12f88661dce3681ba4d92.
Task02 report17673B SHA256feecbd9a2c28c6a94a29893e1bf901ae1a664049c0172161e9137b8c40d5f912.
Task02 results18/18 и timeline14events остались неизменны.
Task02 branch astra/strigunov-demo-task02-20261011, HEADf42cd99f57bafa681def155a676619a1d80504fe.
Его три uncommitted path сохранены побайтово, staged/tracked изменений нет.

Viewer построен отдельно от всех Git worktrees:
C:\Users\Admin\asi-strigunov-2x\strigunov-demo-03-20261011
Новых веток и checkout не создавалось. Production/UI routes, существующие tests/CI/код не менялись.
До записи подтверждено отсутствие целевого каталога; обнаруженные writer briefs не относятся к нему.
Файлы создавались исключительно внутри собственного нового artifact directory.
Первый write_file до создания каталога вернул ENOENT и ничего не записал; затем каталог создан стандартно.

## Безопасность exact-source review
Независимый reviewer /root/task04_independent_acceptance прочитал:
- оба source scripts целиком и их imports/helpers до исполнения;
- весь generated HTML до render;
- исходные Task01/02 reports/source/evidence;
- render-results после исполнения.

Positive allow-list:
1. build-viewer.cjs — только node:fs/path/crypto, два pinned input hashes,
   проверка synthetic flag/scope/chronology/counts, escaped HTML, четыре exclusive-create outputs.
2. render-check.cjs — только own local HTML/JSON + существующий Playwright.
   Task02 test file и приложение не импортируются и не запускаются.

HTML не содержит script/form/iframe/img/external stylesheet.
CSP: default-src none, script-src none, connect-src none, object/base/form/frame restrictions;
разрешён только встроенный CSS.
Все ссылки — фрагменты этой страницы или три соседних JSON.
Это статический read-only файл, не authenticated dashboard и не средство управления.

## Реально выполненная проверка
Generator PID4476 exit0.
Render-check PID1720 exit0, **12 PASS / 0 FAIL**:
1. Проверенные immutable input/output hashes.
2. Synthetic banner и историческая маркировка.
3. Все14 DOM-карточек: exact event.id/kind/detail/raw JSON/UTC datetime.
4. Единые account/booking/property/request/task, один reply связан с approval.
5. Все18 исторических test labels равны машинному evidence; не дополнительные timeline events.
6. Ограничения policy change / integrations / restart видны.
7. Evidence links локальные, hash совпадает.
8. Desktop1440×1000: нет горизонтального overflow, сохранён full-page screenshot.
9. Details раскрывается и показывает точный event без page JavaScript.
10. Mobile390×844: нет горизонтального overflow, anchors работают, screenshot сохранён.
11. Нет активных controls/page scripts, pageErrors=[].
12. externalPageRequests=[]; все pinned file hashes сохранились.

Existing Chromium headless, chromiumSandbox:true, новый отдельный profile в render-evidence/browser-profile.
offline:true, javaScriptEnabled:false, serviceWorkers:block, downloads:false.
Никакого security/policy bypass, установки браузера или production server.
Контекст закрыт после проверки. Свежий профиль не использовал owner browser session.
Ноль внешних page requests доказан в проверенном браузерном контексте; OS-wide network isolation
и защита от враждебного процесса того же Windows account НЕ аттестованы.
Root просмотрел обе сохранённые картинки: порядок/контраст/расположение согласованы с read-only показом.
Некоторые исходные reason keys оставлены в event detail по-английски ради точности;
русские заголовки объясняют их смысл. Это ограничение оформления, не новая бизнес-логика.

## Артефакты и хэши
Все пути ниже относительно viewer directory:
| Файл | Байты | SHA256 |
|---|---:|---|
| build-viewer.cjs | 18732 | e8545f8b71ffe50968ce22acc35d3142f930097f176896ac9300a9f17c7d5a5c |
| render-check.cjs | 8065 | aaa5ab3049fbcc09ef301d8ad75f815ac82a168688a00c0e7af1d4674704557b |
| index.html | 40586 | dfbef4a056146f10a88410d6b4d1dec6f2d96f516e4d3a8a3142aaed6e277af0 |
| timeline.json | 12273 | d5e330e401468cd978a3b363f285ee35e227e477ada3706dbfaea8a4f833e6c3 |
| test-results.json | 7927 | dc0e4401e62a676a6fde74c55225424ddcf8d5d7c8379cbec9ecce4b704c47ef |
| evidence-manifest.json | 1210 | 1a268b21003b46c04e56885869f0dc54758d9ff748aff3ad5e4525dbc78798d1 |
| render-evidence/render-results.json | 1612 | e4565bace539a3207d6c8c4f26b9e9bfa8e8301733e2efc2c2e639f8ae76dfa3 |
| render-evidence/desktop.png | 451168 | 75b574e56286c3391c93650a5bcb0134501391078bf8a03dc61c06508bb34741 |
| render-evidence/mobile.png | 523562 | a6d4caaab86564a1c4aa2d0518f3231d50185088e0780943d389df76e97ff0f8 |

## Переход к Task04
Task03 завершён после полного readback/SHA256 отчёта.
Следующий разрешённый шаг — независимая acceptance exact source/evidence и CodeRabbit handoff.
Реальные гости/транспорт/интеграции/production, Git публикация и deployment по-прежнему запрещены.
