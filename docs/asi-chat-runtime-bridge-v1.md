# ASI Chat → Runtime Bridge v1

## Назначение

Bridge принимает решение из ChatGPT, сохраняет одну durable-задачу и передаёт её одному ASI Runtime runner. В ChatGPT возвращаются только безопасный machine-readable итог или настоящий owner gate. Snapshot-контур кабинета не используется как очередь.

Контур приватный и server-only:

- Chat, owner-decision и runner используют три разных Bearer-токена;
- client/owner scope берётся только из server env;
- таблицы и RPC закрыты RLS и доступны только `service_role`;
- request, result и owner gate имеют строгие allowlist-схемы;
- raw stdout/stderr, env, локальные пути и секреты не возвращаются.

## Операции ChatGPT

OpenAPI: [`asi-chat-runtime-bridge-v1.openapi.yaml`](asi-chat-runtime-bridge-v1.openapi.yaml).

| operationId | Назначение |
| --- | --- |
| `runtime_submit_task` | Идемпотентно поставить задачу в очередь. |
| `runtime_get_task` | Получить состояние точной задачи. |
| `runtime_get_result` | Получить только безопасный итог; до terminal state `result=null`. |
| `runtime_list_owner_gates` | Получить pending owner gates текущего server-side owner scope. |
| `runtime_submit_owner_decision` | Передать явное решение владельца для точных task/gate/cycle. |

Одинаковые `client_id + idempotencyKey + request hash + Chat identity` возвращают исходный `taskId`. Повтор с изменённой нагрузкой получает `409 idempotency_conflict`.

## Очередь и восстановление

Postgres — единственный источник истины. Atomic RPC:

1. восстанавливает `running` с истёкшей lease обратно в `queued`;
2. через global advisory lock и partial unique index допускает только одну `running` задачу;
3. выбирает FIFO-задачу;
4. выдаёт новый fencing `leaseToken`;
5. принимает heartbeat/result/gate/failure только от точного `runnerId + taskId + leaseToken`.

`queued`, `awaiting_owner`, terminal result, Chat identity и owner decision переживают restart. Активная lease никогда не выдаётся повторно, даже тому же `runnerId`: после потери claim response задача ждёт истечения lease, затем повторно выдаётся с тем же `taskId`, новым fence и увеличенным `attemptCount`. Старый runner не может записать итог.

Каждый runner process добавляет случайный session UUID к `runnerId`. Heartbeat не перекрываются; короткий request timeout и локальный deadline останавливают process tree до server lease expiry и запрещают stale outcome. Executor запускается через отдельный guard process: runner сначала получает PID executor и только затем передаёт task envelope. При обычном завершении runner, timeout, output overflow и при обрыве IPC после hard crash guard уничтожает своё дерево процессов. Если аварийно завершился сам guard, runner уничтожает сохранённое дерево executor и подтверждает его исчезновение до retry. Если cleanup подтвердить нельзя и lease ещё действительна, задача завершается без retry с `executor_cleanup_unconfirmed`. После уже подтверждённой потери lease runner не имеет права менять durable state; последующее recovery остаётся at-least-once и требует Runtime-idempotency по стабильному `taskId`. На Unix guard и executor находятся в отдельной process group; на Windows используется `taskkill /T /F`. Execution deadline ограничивает зависший child; stdout и stderr независимо ограничены 512 KiB. После трёх crash/retry cycles отдельный `recovery_count` завершает задачу machine-readable failure, не расходуя budget на обычные owner-gate resume. Просроченный owner gate атомарно становится `expired`, а задача — `failed` при любом task/result/gate poll или runner claim.

Доставка в Runtime — at-least-once после crash. Для effectively-once внешнего выполнения отдельный ASI Runtime обязан использовать стабильный bridge `taskId` как idempotency key. Bridge не обещает exactly-once side effects внешнего executor.

## Owner gate

Runner может вернуть `asi.runtime.owner-gate.v1` только с:

- exact action, target и identity;
- причиной и evidence;
- допустимым side effect;
- rollback и post-action verification;
- `taskCycle` и `expiresAt`.

Решение принимается только с `source=explicit_owner_message`. Typed confirmation не считается approval. Повтор того же `decisionId` для того же gate идемпотентен; другой decision для уже решённого gate возвращает conflict. Один `decisionId` нельзя повторно использовать для другого gate в том же client scope. Approval ставит ту же задачу обратно в очередь. Rejection завершает её безопасным machine result.

## Конфигурация

Нужны только server-side env names (значения не выводить в логи):

```text
ASI_RUNTIME_BRIDGE_CHAT_TOKEN
ASI_RUNTIME_BRIDGE_OWNER_TOKEN
ASI_RUNTIME_BRIDGE_RUNNER_TOKEN
ASI_RUNTIME_BRIDGE_CLIENT_ID
ASI_RUNTIME_BRIDGE_URL
ASI_RUNTIME_BRIDGE_EXECUTOR_JSON
ASI_RUNTIME_BRIDGE_EXECUTION_TIMEOUT_MS
ASI_RUNTIME_BRIDGE_LEASE_SECONDS
ASI_RUNTIME_BRIDGE_POLL_MS
ASI_RUNTIME_BRIDGE_RUNNER_ID
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Все три токена должны быть не короче 32 символов и попарно различаться. Owner token доступен только доверенному контуру, который получает явное сообщение владельца; обычный Chat token не может вызвать owner-decision endpoint. Bridge URL должен быть HTTPS; HTTP разрешён только для loopback.

Runner принимает lease от 30 до 900 секунд (default 120), poll interval от 250 до 60 000 ms (default 2 000) и execution timeout от 30 секунд до 6 часов (default 30 минут). `ASI_RUNTIME_BRIDGE_RUNNER_ID` — только короткий стабильный prefix; к нему всегда добавляется случайный session UUID. Ожидание между poll прерывается SIGINT/SIGTERM.

`ASI_RUNTIME_BRIDGE_EXECUTOR_JSON` — JSON-массив executable и аргументов, например `["node","/opt/asi-runtime/bridge-executor.mjs"]`. Runner вызывает внутренний guard через `spawn(..., {shell:false})`; guard запускает executor без shell. Executor получает только allowlisted OS env, `ASI_RUNTIME_BRIDGE_TASK_ID`, `ASI_RUNTIME_BRIDGE_LEASE_TOKEN` и task envelope в stdin. Lease token нужен как fencing context, но Runtime всё равно обязан идемпотентно связывать внешние side effects со стабильным `taskId`. Runner принимает ровно один JSON:

```json
{"type":"result","result":{"schemaVersion":"asi.runtime.result.v1","status":"completed","summary":"Done","changedFiles":[],"checks":[],"artifacts":[],"blockers":[]}}
```

или:

```json
{"type":"owner_gate","gate":{"schemaVersion":"asi.runtime.owner-gate.v1","action":"production_deploy","exactTarget":"production","identity":"commit SHA","reason":"Owner approval required","evidence":[],"allowedSideEffect":"Deploy exact SHA","rollback":"Use approved rollback runbook","postActionVerification":["Verify health/version SHA"],"taskCycle":"cycle-1","expiresAt":"2026-07-25T12:00:00.000Z"}}
```

`runtime-bridge:runner` не применять до отдельного migration/deploy owner gate. Эта ветка migration не применяет и Runtime не запускает.

## Локальная проверка без внешних действий

После установки зависимостей:

```powershell
npm.cmd run runtime-bridge:smoke
```

Smoke использует изолированное in-memory durable fixture и проверяет duplicate submit, единственный claim, restart recovery, owner gate, idempotent decision, resume того же `taskId` и final result. Он не подключается к базе, Runtime или внешним сервисам.

Полная focused-проверка:

```powershell
npm.cmd exec vitest -- run src/lib/asi-runtime/__tests__/bridge.test.ts
npm.cmd exec vitest -- run src/lib/__tests__/migration-dependency-order.test.ts
npm.cmd run typecheck
```

Migration `20260724120000_asi_chat_runtime_bridge_v1.sql` append-only. Применение к любой базе, настройка секретов, запуск runner на сервере, merge и deploy требуют отдельных разрешений/процедур.
