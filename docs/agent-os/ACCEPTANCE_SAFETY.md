# ASI Agent OS v0 — acceptance runner safety contract (AO-008)

## Проблема

`AO-008` в `BLOCKERS.md` фиксирует, что acceptance runners в репозитории разнородны: часть fixture-based staging сценариев создаёт/изменяет/удаляет данные, часть production acceptance скриптов пишет напрямую в production, и почти ни один runner не выдавал machine-readable доказательство того, что он сделал.

## Контракт

Два новых JSON Schema (Draft 2020-12) в `docs/agent-os/schemas/`:

- `acceptance-plan.schema.json` — что runner **собирается** делать: `target.environment`/`target.identity`, `safety.noExternalActions` (+ обязательное обоснование, если `false`), `fixtureOwnership.isolated`/`namespace`, `cleanup.required`/`strategy`, `ownerGateRequired`.
- `acceptance-result.schema.json` — что runner **реально** сделал: `status`, `safety.noExternalActions`/`productionMutation`, `cleanup.performed`/`verifyZeroResidue`, `evidence[]`.

Валидаторы `validateAcceptancePlan`/`validateAcceptanceResult` в `scripts/agent-os/contracts.mjs` добавляют fail-closed инварианты поверх схемы:

- external actions без justification — отклоняется;
- production plan без `ownerGateRequired: true` — отклоняется;
- production result с `productionMutation: true` — отклоняется;
- `status: PASS` без выполненного cleanup — отклоняется.

`scripts/agent-os/acceptance-contract.mjs` — тонкий helper (`buildAcceptancePlan`, `buildAcceptanceResult`, `emitAcceptancePlan`, `emitAcceptanceResult`) для runners, которые хотят напрямую использовать этот контракт: печатает JSON evidence в stdout за стабильным маркером (`ACCEPTANCE_PLAN_EVIDENCE:` / `ACCEPTANCE_RESULT_EVIDENCE:`), который CI может парсить так же, как уже парсит `GUEST_LIFECYCLE_CLEANUP_PG_PROOF`.

## Inventory и fail-closed coverage

`docs/agent-os/acceptance-runners.json` — единый machine-readable реестр всех acceptance runner entrypoints под `scripts/` (schema: `acceptance-runner-registry.schema.json`). Каждая запись объявляет `evidenceStatus`: `emits-contract` (доказано) или `not-yet-instrumented` (честно непокрыто).

`scripts/agent-os/check-acceptance-coverage.mjs`:

1. Сканирует `scripts/` по паттерну реестра (`*acceptance*.{mjs,ts,js}`, исключая `.runner.ts`, `.ps1`, тесты).
2. Сверяет найденные файлы со списком в реестре — новый/незарегистрированный runner **проваливает** проверку (`undeclared`).
3. Проверяет, что зарегистрированные файлы ещё существуют (`stale`) и что путь/паттерн реестра не разошёлся с реальным discovery (`missingFromDiscovery`).
4. Для записей `emits-contract` статически ищет доказательство в исходном файле (импорт `acceptance-contract.mjs`, либо legacy `noExternalActions` для guest-lifecycle seam) — не доверяет декларации без proof.
5. Возвращает `ok: false`, если есть хотя бы один `not-yet-instrumented` runner или любой drift — CI-шаг падает без `--report-only`.

Так реализуется требование AO-008 буквально: **каждый runner либо A) выдаёт валидное plan/result evidence, либо B) роняет CI как uncovered.**

## Текущее состояние (на момент этого коммита)

- 21 runner найдено.
- 2 покрыты (`guest-lifecycle-db-acceptance`, `guest-lifecycle-synthetic-acceptance`) — через уже существующий, проверенный в CI, guest-lifecycle-specific JSON contract.
- 19 честно помечены `not-yet-instrumented` — это не сокрытие пробела, это его доказательство. `check-acceptance-coverage.mjs` **проваливает CI**, пока они не инструментированы.

`npm run agent-os:validate-contracts`, `npm run agent-os:test`, `npm run acceptance:check-coverage` — команды для локальной проверки; те же команды подключены в `.github/workflows/pr-validation.yml`.

## Что дальше (вне scope этой задачи)

Чтобы полностью закрыть AO-008 по букве критерия закрытия, оставшиеся 19 runners должны либо начать вызывать `acceptance-contract.mjs` (`buildAcceptancePlan`/`buildAcceptanceResult` + `emitAcceptancePlan`/`emitAcceptanceResult`), либо получить другой доказанный evidence-механизм и обновить `evidenceMechanism` в реестре. До этого `check-acceptance-coverage.mjs` намеренно держит CI red — это ожидаемое, а не ошибочное поведение согласно `AUTONOMY_POLICY.md`.
