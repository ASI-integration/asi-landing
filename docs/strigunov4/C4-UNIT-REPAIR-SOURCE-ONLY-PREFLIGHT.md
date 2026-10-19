# C4 unit repair: самостоятельный локальный пакет (2026-10-19)

## Точка GitHub и граница разрешения

- Source baseline: защищённая `main` `af468d85c8eaf308796bbdbb29b60a59270c45eb`.
- PR #508: `8ac8e8ac11e39ac070ccc058218e3b73190cb43f`; **не объединять до независимого OLD admission и защищённого применения**.
- Проверенный run `39261951787` (attempt 1) подтвердил квитанцию и NEW hash.
- OLD unit SHA256: `9072dd1a276c7bea2bb7d17031a51b250177e2806cd632e26728028c0a8a01d9`.
- NEW unit SHA256: `6e0ce12922e015738368c89deeef154c195f19b2a0678d72d27d58e5414bf62c`.
- Точное преобразование: 454 → 453 байта, удаление одного optional `-` в EnvironmentFile.
- Действующий сервер до ремонта — OLD; `historicalWrite=UNKNOWN`; replay ранее использованных операций запрещён.

## Новый код в отдельной локальной ветке

- `c4_unit_repair_phase_contract.py`: независимый фазовый допуск OLD+optional; NEW+mandatory после; защита от подмены квитанции, processToken и otherStateToken.
- `c4_unit_repair_host_preflight.py`: фиксированная staging-идентичность; чтение unit с контролем inode, metadata и перечитыванием пути; точное соответствие OLD/NEW; проверка systemd и PID/InvocationID/start, root/host/release; два ограниченных чтения /proc/*/environ с проверкой семи no-send; только два localhost GET, bounded timeout; отказ при дрейфе.
- Два автономных набора unit-тестов подтверждают 24/24 PASS на Windows с mocked внешним I/O, включая сквозную композицию читающего preflight. Никакой тест не обращается к действующему серверу.

## Важная граница

**Это безопасная часть исходного кода, а НЕ полномочный live-адаптер.**
`fixed_observation` намеренно возвращает `otherStateToken=NOT_PROVEN`,
`isolation=MANAGER_WIDE_NOT_PROVEN`. Транзакция отвергнет такое свидетельство.
Нельзя заменить NOT_PROVEN случайным SHA или подписью без независимого доказательства.

До разрешения записи необходимо отдельно обеспечить и проверить:

1. Источник реальных manager-wide systemd фактов: остальные units, drop-ins,
   генераторы, manager reload/jobs, их состояния до и после.
2. Запрет затрагивать production/Sentinel; доказать границы host topology.
   `daemon-reload` общесистемен. Предварительная хеш-проверка одного unit
   не доказывает изоляцию других служб или отсутствие side effects генераторов.
3. Fixed staging adapter, позволяющий проверенно открыть реальную директорию
   `/etc/systemd/system`. Нынешний `c4_unit_transaction.apply` намеренно
   требует приватного unit.parent mode 0700 и потому не применим к /etc напрямую.
   Не менять режим /etc и не обходить проверку подстановкой mock в production.
4. Независимый OLD+optional admission до первого изменения, новый приватный
   backup/claim + fsync, четыре pins в новой main и отдельное разрешение владельца.
5. Один разрешённый `daemon-reload` только при доказанной изоляции;
   никакого перезапуска или замены G0. Контроль manager NEW+mandatory,
   `NeedDaemonReload=no`, прежнего process identity/health/no-send.
6. При SIGKILL/lost SSH: запрет повторного apply, сохранение evidence,
   отдельная owner-authorized recovery после проверки неизменности менеджера.
7. Защищённый GitHub workflow с единственным dispatch, staging approval,
   current-main SHA, pinned host key, без database credentials и без
   пользовательских путей/команд, с CI на Linux.

## Следующий конкретный ход

Готовить manager-wide read-only survey как часть будущего source-owned
ремонтного механизма. До чтения реального server topology нельзя честно
утверждать, что daemon-reload изолирован. Публикацию отдельного PR,
staging read-only run и любую mutation согласовывать отдельно.

Использованные run #39235934084 и #39261951787 не повторять.
PR #508 оставлять HOLD, пока защищённый ремонт не готов.
Production, Sentinel, данные, бронирования и серверы не тронуты.
