# Аттестация диспетчера one.com

Дата проверки: 2026-11-26. Живая служба на one.com этой аттестацией не изменялась.

## Что уже подтверждено на production

Автозапуск включён: `RECOVERY_ENABLE_OK`, `AUTOSTART_ENABLED`.
Штатный цикл даёт `RECOVER_OK`, `QUEUE_EMPTY`, `boot:false`, `retry:false` и `Deactivated successfully`.
Интервал около 36 секунд совпадает с `RestartSec=30` и коротким простоем очереди.
`ASI_DISPATCHER_EXECUTE=NO`, `ASI_PAID_CALLS_ENABLED=NO`, cap 0 ₽, Issue #686 на HOLD, Gold не пересобирался.

## Источник остаточного python3

Это не ledger и не основной `ExecStart`. Воспроизведение на systemd 255 с тем же каркасом unit (`Type=simple`, `ExecStartPre=+`, `Restart=always`, без своего `KillMode`) и со serve-скриптом без Python оставляет в журнале:

`Found left-over process <pid> (python3) in control group while starting unit. Ignoring.`

Командная строка процесса: `python3 -c`. Его родитель — bash-подоболочка `coproc`, а не сам helper. `KillMode` в unit не задан, действует `control-group`, но systemd 255 при следующем старте эту запись не завершает, а помечает `Ignoring`. Каждый цикл получает новый PID. Защитный механизм recovery (lock, pidfd, проверка inode) из-за этого не ослаблен и не является причиной утечки: лок держит дочерний Python, которого trap убивает не по его PID.

## Исправление

Lock держит сам процесс `python3`. Перед выходом `ExecStartPre` helper отправляет `RELEASE`, закрывает канал, дожидается выхода и при необходимости шлёт `SIGTERM`, затем `SIGKILL`. Каналы помечены `CLOEXEC`, чтобы node не удерживал Python. Проверки pidfd, inode и запрет на расширение каталога работы сохранены.

Новый пакет, ещё не допущенный к установке:

- exact SHA `39b75b7770fce0297954f7e24418dbe5f08c0ce7`
- package SHA256 `cbf301ac7bf9663daf72a5a6081aa2b2622b52ec778feee3899fdad629e883b7`
- helper SHA256 `e85a1d8da10fd19f44d952bf7712c95a3f81a86db341f0849803b62a7077ce6d`
- scenario SHA256 без изменений `1f80857c356067054671b855e4e24f131436a50c7fea5658adbaf3d892e568fc`

Install-gate для этого пакета имеет статус `missing`. Пока владелец отдельно его не утвердит, действующая служба остаётся на прежнем helper.

## Десять циклов

Локальный systemd 255, тот же тип unit, `RestartSec=1`:

- `RECOVER_OK` не меньше 10
- строк `left-over` ноль
- одновременно в cgroup не больше одного `python3 -c`, и только пока идёт `ExecStartPre`
- `NRestarts=9`, `Result=success`
- после остановки cgroup пуст

Полный прогон helper завершился `RECOVERY_HELPER_PROVED`, включая этот этап `systemd-ten-cycles`.

## Готовность к 24/7

Холостой цикл на one.com уже работает сам и автозапуск включён. Для непрерывной работы без накопления Python нужен установленный исправленный helper. Это отдельное утверждение install-gate, без смены `ASI_DISPATCHER_EXECUTE`, без платных вызовов, без изменения cap, без снятия HOLD и без пересборки Gold.

Первый сквозной цикл Issue #686 до Draft PR описан в `issue-686-draft-pr-owner-gate.json`. Статус `missing`: цикл не разрешён.
