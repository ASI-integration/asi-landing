# C4 EnvironmentFiles: ограниченное чтение и кандидат ремонта

Baseline: `1582d42dd18daabea21260a09d8bc814276de651`. Основание — защищённая
квитанция run `39213017307`, attempt 1: `EXACT_EXPECTED_OPTIONAL`,
`BLOCK_REASON_ENVIRONMENT_FILES`. Она уже потреблена. Исторические записи
остаются `UNKNOWN`; `claim=ABSENT` не разрешает replay.

## Граница этого пакета

Пакет добавляет одну фиксированную процедуру чтения unit и локальный,
неподключённый к серверному запуску кандидат файловой транзакции. Приложение,
env-файл, операторские списки, SQL, бронирования, отправки и платежи не меняются.
Публикация, merge и любой защищённый запуск требуют отдельно применимого
разрешения. Workflow только чтения не включает apply/recovery job и не передаёт
модули `candidates/c4_unit_*` на сервер. `host.live` и его обязательный
`ignore_errors=no` остаются неизменными.

## Один следующий диагностический запуск

В исходной main этого workflow ещё нет. Он может запускаться только после
рассмотрения пакета, CI/CodeRabbit и штатного merge. Значение `<S>` ниже —
**фактический будущий полный SHA main с этим кодом**, а не исходный baseline,
не PR head и не предположение о будущем merge SHA.

```text
workflow: .github/workflows/strigunov4-c4-unit-readonly.yml
ref: main
reviewed_main_sha: <S>
confirm: READONLY_C4_UNIT_<S>
```

Связь с incident `39213017307` зафиксирована исходниками. Отдельное разрешение
владельца предшествует dispatch; настоящий reviewer staging обязателен.
Перед SSH проверяются owner/ID, main, SHA workflow/checkout, attempt 1,
текущая защищённая main и GitHub API. Для этого workflow допускается ровно
один `workflow_dispatch` за всё время: не только один attempt данного run.
Предыдущий failed dispatch тоже закрывает процедуру. Другой активный ручной
run в любой из пяти очередей GitHub блокирует чтение. Сохранена общая группа
конкурентности C4 без отмены уже работающей операции. Прямой SSH не заменяет
защищённую процедуру.

Доступ использует уже проверенный SSH transport и прежний pin host key.
Единственная общая правка transport — `python3 -B`, запрещающий создание pyc.
Секреты доступны только защищённой job и только по существующим именам
`STAGING_SSH_HOST`, `STAGING_SSH_PORT`, `STAGING_SSH_USER`,
`STAGING_SSH_PRIVATE_KEY`. GitHub token имеет `contents: read`, `actions: read`.
Техническая confirm-строка сама не является согласием владельца.

Worker читает только исходные bytes фиксированного
`/etc/systemd/system/asi-landing-staging.service`, его metadata/xattrs и
фиксированный набор `systemctl show` свойств этой службы. Он не читает `.env`,
`/proc/*/environ`, журналы, БД или unit других служб. Обычные atime/журналы
доступа оговариваются в разрешении. Нет `cat`/дампа unit, открытия редактора,
artifact с plaintext, сетевого вывода содержимого или server-side backup.

Открытие выполняется через directory fd с `O_NOFOLLOW`, обычный файл ограничен
64 KiB, проверяются root ownership, безопасный режим, один hard link, отсутствие
подмены inode/metadata между чтениями. PID, InvocationID, время старта и
свойства manager должны быть стабильны между двумя наблюдениями. Это всё равно
не атомарный снимок, что прямо указано в квитанции.

Исходные bytes остаются в памяти сервера. Проверенный planner вычисляет delta
и SHA256 **непосредственно из них**. В журнал выходит только замкнутый JSON:
source SHA/run ID, OLD/NEW SHA256, размер, число удалённых байтов, классификация
директивы, `NeedDaemonReload` и фиксированные признаки безопасности. Никаких
исходных строк unit, environment values, PID, hostname или исключений с их
содержимым. Decoder проверяет поля, типы, enums, связи и размер 4096 байт,
запрещает duplicate JSON keys, неизвестные значения и выдачу nonzero exit за
успех. Неизвестное исключение не печатается.

## Получение точного преобразования

Проверяется прежний OLD SHA256:

```text
9072dd1a276c7bea2bb7d17031a51b250177e2806cd632e26728028c0a8a01d9
```

`c4_unit_contract.plan` сохраняет все байты, кроме одного ведущего `-` перед
точным env-путём в единственной `EnvironmentFile` директиве `[Service]`.
Поддержаны реальные LF/CRLF, пробелы/табуляция и отсутствие последнего LF:
никакой нормализации файла. Несколько директив, reset, wildcard, другой путь,
quotes/continuation или неподдержанный синтаксис дают закрытый отказ.

Возможны два различных результата:

| Диск | Результат | Следствие |
|---|---|---|
| Единственная exact optional директива | `REMOVE_ONE_OPTIONAL_BYTE`, removedBytes=1, вычисленный NEW hash | Можно запечатать байтовый патч и обновление pins |
| Директива уже mandatory | `ALREADY_MANDATORY_ON_DISK`, removedBytes=0, OLD=NEW | Не менять файл и pins; разбирать загруженную конфигурацию/NeedDaemonReload |

В пакете **нет установленного NEW hash сервера**. Синтетические хеши из тестов
не применяются к staging. Данные квитанции связываются с реально выполненными
run/job/source SHA и checksum masked log; произвольный JSON не является
доказательством происхождения или разрешением.

## Согласованное обновление хешей

Полный поиск по архиву exact baseline нашёл пять употреблений OLD:

| Исходник | Решение |
|---|---|
| `staging_no_send_host.py` | Обновить pin для действующих operator/observer/no-send consumers |
| `c4_staging_readonly_probe.py` | Обновить pin для physical pre/post, retained и incident consumers |
| `protected_staging_host_probe.py` | Обновить pin в действующих protected admission/SQL/G0 consumers; это не разрешение их повторять |
| `g0_activation_host.py` | Обновить pin в действующем protected G0 wrapper; старую активацию не повторять |
| `candidates/systemd_candidate.py` | Исторический кандидат: оставить bytes и его SHA256SUMS неизменными |

`candidates/c4_unit_pin_plan.py` готовит все четыре замены только после реальной
квитанции, требует exact исходные SHA256 каждого файла и одно употребление OLD.
Исторический файл тоже проверяется по SHA256 и возвращается без изменений.
Это чистая функция, не CLI записи. Сейчас четыре runtime pins не изменены.
Если изменится main/содержимое consumers, план нужно перепроверить по новой
базе; он не переносится автоматически. Новые упоминания OLD в byte planner и
repair precondition являются намеренным pin исходного состояния.

В момент перехода: normal guards принимают только NEW+mandatory, отдельный
ремонт проверяет OLD+optional до записи и NEW+mandatory после. Приём обоих
хешей в обычном guard, substring, игнорирование optional и drop-in запрещены.

## Кандидат атомарной транзакции

`candidates/c4_unit_transaction.py` — проверенный **офлайн-кандидат**, не готовая
команда серверного применения. Его запуск как CLI закрыт. В текущем виде он
принимает только приватные disposable directories; настоящий
`/etc/systemd/system` по этой ветке не принимается. Для будущего apply нужен
отдельно рассмотренный source-owned adapter, закрепляющий directory fd,
службу, source SHA, действительную квитанцию, NEW hash, operator/process checks,
все shared locks и scope `daemon-reload`. Ни одного такого разрешения сейчас нет.

Подготовленная последовательность:

1. Связать свежие owner approval, точный SHA новой main, OLD/NEW, новый repair
   run/record и разрешённый recovery. Проверить отсутствие конкурирующих
   GitHub/host операций. Удерживать общий lock ремонта и существующие locks
   operator/no-send в определённом порядке до завершения проверки/rollback.
   Зафиксировать окно без некооперирующих root-изменений.
2. Проверить exact исходный файл/metadata, effective optional, службу/release,
   PID+InvocationID+время старта, семь эффективных no-send флагов и loopback GET
   health/version. Сохранить приватные fingerprints процесса и остальной
   конфигурации, без вывода env/секретов. Текущая unit-only квитанция эти проверки
   процесса не выполняет и не заменяет.
3. До возможной записи создать новый одноразовый claim, приватные оригинальные
   bytes, metadata/xattrs и `prepared.json`. Все создаются с O_EXCL, file fsync
   и directory fsync. Старые evidence/claim не удалять и не переиспользовать.
4. Создать файл на том же filesystem, восстановить uid/gid/mode/xattrs и
   исходные времена, проверить exact candidate hash. Сохранить durable
   apply-intent и inode кандидата. Сверить исходный inode/bytes непосредственно
   перед `os.replace`, затем fsync каталога. Rename атомарен для читателей;
   check+rename не являются kernel CAS против другого root-писателя.
5. До reload повторить проверку отсутствия посторонних изменений и pending
   manager operations. Записать reload-intent. Общий лимит модели — 180 секунд,
   последние 90 зарезервированы исключительно под recovery. Каждая реальная
   команда/GET в будущем adapter обязана иметь timeout по тому же deadline.
6. Выполнить отдельно разрешённый `systemctl daemon-reload`, затем доказать
   exact NEW hash, mandatory, отсутствие drop-ins, `NeedDaemonReload=no`,
   неизменные процесс/окружение/release, безопасные флаги и health/version.
   Лишь затем durable success; он означает только unit contract, а не
   operator admission или пилот. При потере связи результат не повышать до PASS.

`daemon-reload` перечитывает все unit-файлы и запускает generators. Проверка
одного `NeedDaemonReload` не доказывает безопасность этой общесистемной операции.
До разрешения apply требуется доказать неизменность остальных unit/generator
inputs, отсутствие незавершённого reload и сохранение production/Sentinel.
Текущий bounded reader не расширяется ради обхода этой границы. Если доказать
изоляцию нельзя, `isolation` callback обязан отказать до записи/повторного reload.

**Перезапуск в unit-only ремонт не включён.** Удаление optional-префикса не
изменяет значения уже загруженного env, поэтому требуется загрузка контракта
manager, с сохранением PID. `daemon-reload` не обновляет environment процесса.
Если далее потребуется изменение operator allowlists, это отдельный env repair
и отдельно разрешённый staging restart. Запрещены автоматические restart,
`reload-or-restart`, повтор G0 activation и переключение релиза. Изменение PID
в unit-only операции — отказ/ручное восстановление, не повод перезапускать снова.

## Откат и прерывание

При обычном исключении или первом SIGTERM/SIGINT используется резерв recovery.
Файл восстанавливается только из проверенного приватного OLD и только если
текущие bytes/inode принадлежат нашему candidate. Чужие/неизвестные изменения
не перезаписываются. UID/GID/mode/xattrs/mtime проверяются после восстановления.
Если reload ещё не мог начаться, лишний reload не выполняется.

После reload-intent восстановить диск недостаточно: нужен разрешённый reload
OLD и проверка первоначальных fingerprints/health/no-send. При неизвестном
незавершённом reload повторная команда запрещена до доказательства quiescence.
Без этого возможен итог OLD на диске, NEW в manager и `MANUAL_RECOVERY_REQUIRED`;
он не скрывается за «откат прошёл». Изменившийся процесс также блокирует успех.

SIGKILL, потеря питания/host и обрыв SSH не гарантируют автоматический rollback.
Остаются claim, оригинал и журналы намерения; новая попытка apply блокируется.
`inspect_recovery` только читает и классифицирует bytes. `recover_explicit`
предназначен для нового отдельно разрешённого recovery run, с отдельной
одноразовой записью; старый apply не запускается снова. Неполная/испорченная
backup/metadata или конкурентные bytes означают ручное восстановление.

Если процесс погиб внутри первого rollback, существующий rollback-intent
принимается только при точном совпадении приватного содержимого. Intent
сохраняется до создания временного файла. При перехваченной ошибке удаляется
только новый временный файл этого вызова с подтверждёнными inode/metadata;
остатки после SIGKILL и старые свидетельства сохраняются. Наличие recovery.json
запрещает повторный recovery до новой записи запроса или manager action.

Даже видимый `success.json` не является единственным критерием: ошибка fsync
могла произойти после появления файла. Recovery evidence и текущие проверки
имеют приоритет. Откат возвращает исходный **BLOCKED baseline**, а не strict
`host.live PASS`. Старые записи успеха/отката сохраняются для расследования.

## Проверки и предел доказательства

Команда для Linux/root на изолированном рабочем каталоге:

```bash
cd scripts/strigunov4
python3 -B -m unittest test_c4_unit_readonly test_c4_unit_transaction -v
```

32 focused tests / 2 files: exact byte delta и newline preservation, строгий
parser/decoder, symlink/hardlink/FIFO/race/metadata отказы, admission/source/
replay/concurrency, все четыре pins, независимый читатель во время atomic
replace, настоящие flock/SIGTERM/SIGKILL, durable backup, отдельный recovery,
резерв времени, неизвестный reload, PID drift и конфликт success/recovery.
Дополнительно проверены SIGKILL внутри rollback, повтор уже завершённого
recovery, несовпадающий rollback-intent и очистка собственного нового temp.
Ранее полученные восемь тестов OLD→UNIT BLOCK→NEW/mandatory→PASS используются
как сохранённое доказательство; runtime `c4_operator_host.py` не изменён.

Systemd и HTTP в тестах — явная модель. В текущем Linux окружении создание
отдельного user/PID/mount/network namespace отклонено (`Operation not
permitted`), поэтому настоящий isolated systemd не запускался. Успешный
SIGKILL-тест не доказывает стойкость filesystem/storage к потере питания.
Настоящие unit bytes/NEW hash, reload, operator membership и физический E2E
остаются непроверенными. CI и CodeRabbit нового пакета пока не запускались:
это потребует разрешённой публикации.

## Источники семантики

- [systemd.exec / EnvironmentFile](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#EnvironmentFile=): optional-префикс и чтение env при запуске процесса.
- [systemctl](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html): различие disk/manager, daemon-reload, reload и restart.
- [Python os.replace](https://docs.python.org/3/library/os.html#os.replace): атомарное переименование при успешной операции; это не сравнение-и-замена expected inode.
