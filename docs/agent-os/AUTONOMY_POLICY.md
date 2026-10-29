# ASI Agent OS v0 — autonomy policy

## Принцип

Агент работает до проверяемого результата и не останавливается ради обычных обратимых решений. Остановка обязательна перед red-действием, при неоднозначной цели или когда нельзя доказать safety prerequisite.

Уровень классифицируется по самому рискованному действию задачи. Разбиение задачи не может искусственно понизить уровень.

## Beget G2 — ограниченный bootstrap одного владельца

**Решение владельца 29.10.2026:** для **единственного** существующего Engine #549 на Beget разрешается отдельный путь `OWNER_VERIFIED_CI` вместо обязательного второго человека для проверки исходного кода и **ровно двух заранее закреплённых G2 witness-задач**. Это не утверждение `independent:true`: автоматическая GitHub CI и подписанная ответственность владельца называются своими именами. Владелец принимает риск отсутствия второго человека, но не даёт право обойти технические предохранители.

Допуск имеет силу **только после реализации и проверки** этого режима в установщике, host-runtime и тестах. Условия обязательны одновременно:

1. Зафиксированы точные repo, source SHA, фактический защищённый main SHA, install manifest, unit и два неизменяемых дельта-хэша. GitHub-подписанный идентификатор владельца и явно проверенное подтверждение его действия на точном SHA обязательны.
2. Независимо от заявлений в JSON проверены через GitHub API успешные `validate` и `release_governance` на этом SHA; без свежих подтверждений режим блокируется. Для двух свидетелей проверяются их фактические изменения, отдельные тесты, внешние CI и точное соответствие опубликованных Draft PR.
3. **Сохраняются** независимая проверка происхождения GitHub-provider события отзыва старого писателя и прекращения иных его токенов, физическая изоляция bubblewrap/systemd под сервисным UID, один исполнитель/lock, защищённый owner-signed one-use install grant, root-owned authority files и fail-closed поведение. UI-экспорт журнала, комментарий и синтетическая fixture сами по себе этих проверок не заменяют.
4. Запрещены auto-merge, изменение `main` самим Engine, production deploy, реальные сообщения/платежи, новые задачи и превышение подписанных бюджетов. Максимум две отдельные G2 Draft PR, ноль оплачиваемых вызовов, права только на заранее указанные source paths; подписанный срок не больше 14 дней, без автоматического продления.
5. При непроверенном свидетельстве, подмене файлов, несоответствии SHA, отказе сети/API или неизвестном состоянии — `BLOCKED`, без попытки обойти отказ или повторить неопределённую запись.

Это узкое исключение для одной ограниченной приёмки, **не** ослабление общего RED-правила и не право объявлять Engine установленным/24×7 до физической приёмки. Существующий строгий путь независимого review остаётся поддерживаемым для других задач.

## Постоянное правило: один безопасный рабочий цикл вместо микросогласований

Применяется к Astra/Work, Dispatcher, Engine и другим исполнителям **на любом текущем этапе**, включая S4-G2–G6, но не расширяет права ни одной установленной службы. Более строгие утверждённые release contract, owner gate, test budget и защищённые настройки имеют приоритет.

1. **GREEN — автономно по умолчанию.** После конкретного задания исполнитель без повторного «продолжать?» выполняет read-only preflight, анализ, локальные обратимые source-only изменения, изолированные focused tests, lint/typecheck, исправление ошибок и проверку результатов. Для каждого очередного коммита не нужно новое разрешение на **запуск тестов**. Если релизная проверка блокирует публикацию/merge, безопасная подготовка и тестирование могут продолжаться; не выдавать заблокированный CI за PASS.
2. **YELLOW — один согласованный scope, один связный пакет.** В пределах подтверждённой ветки/файлов/цели исполнитель самостоятельно делает необходимые коммиты, push, обновляет **один** Draft PR, исправляет CI и доводит пакет до проверяемого итогового SHA. Сначала завершить изменения, затем запросить **один** допуск на окончательный SHA, если он обязателен. Не плодить PR и approval по каждому отдельному тесту, если можно безопасно продолжить тот же task.
3. **RED — неизменные защищённые границы.** Merge, изменения релизного/управляющего контракта, GitHub branch protection, secrets, DNS/TLS, privileged witness installation, изменения systemd/env/доступов, реальные staging/prod mutations или dispatch защищённого workflow, любые реальные отправки и платежи, физическая приёмка этапа — только после отдельно применимого owner approval с действительным exact target/SHA/side effects/rollback и независимой проверкой. YELLOW-классификация staging в общем документе не отменяет более строгий stage-specific gate.
4. **Делегирование на этап, когда реально поддерживается.** Предпочтителен один подписанный/проверяемый владельческий policy manifest со списком разрешённых ограниченных GREEN/YELLOW work orders, фиксированными путями, branch/base, лимитом операций и сроком **до 14 суток**, а не запрос ключа для каждого задания. Такой grant действует **только если** соответствующий проверяющий адаптер реализован, интегрирован, протестирован и подтверждён в работающем контуре. Draft PR, комментарий или это описание сами по себе не устанавливают grant и не дают права на RED.
5. **Остановить именно опасное действие, не всю задачу.** При защищённой границе оставить неразрешённую операцию AWAITING_OWNER/BLOCKED и завершить остальные независимые безопасные шаги; не обходить неизменяемые locks, UNKNOWN или failed receipts, не повторять потенциально совершённую запись вслепую. Если дальнейшая работа действительно зависит от запретного действия, подготовить **один консолидированный** owner handoff: что готово, точная граница, доказательства, SHA/target, эффект, rollback и одно требуемое решение.
6. **Запрет ложного ускорения.** Зелёные source tests не считаются real human login, physical PASS, соответствием effective runtime flags или разрешением G2→G3. Не ослаблять обязательные проверки, не подменять approval собственным комментарием и не снижать уровень риска дроблением задач. Отсутствующую GitHub branch protection считать **UNKNOWN/BLOCK**, а не доказанной защитой.

Это правило — постоянный контракт поведения агента для новых заданий; действовать в новых запусках оно начинает после отдельного защищённого включения соответствующего кода/документов в принятую ветку. Не обещать, что один Draft PR или одно сообщение обновили уже запущенные сессии и серверный Engine.

## Green — выполнить самостоятельно

Агент выполняет без предварительного разрешения и включает результат в обычный отчёт:

- read-only аудит tracked-файлов, истории и CI metadata;
- поиск, анализ, план и оценка риска;
- изменения документации, тестов и внутреннего tooling без продуктового side effect;
- локальные изменения кода в согласованном scope, если они не затрагивают red-контракты;
- создание task branch;
- focused tests, typecheck и ESLint touched-файлов в пределах `AGENTS.md`;
- локальный dry-run, который доказуемо не пишет данные и не вызывает внешние сервисы;
- подготовка diff, commit message и draft PR body.

## Yellow — выполнить автономно с обязательным отчётом

Агент может выполнить действие без предварительной остановки только при доказанных prerequisites. В отчёте обязательны target, команда/механизм, результат, evidence и rollback/cleanup:

- commit, push task branch и создание/обновление draft PR;
- установка обычных project dependencies из lockfile;
- изменение внутренних API, схем типов или lifecycle seams при наличии focused regression tests;
- создание новой migration без применения к любой базе;
- change-aware расширение тестов сверх минимума, но не broad suite без согласования;
- staging deploy на подтверждённый изолированный target;
- staging data setup/mutation только для deterministic acceptance fixtures с cleanup;
- staging acceptance без реальных сообщений, платежей и production credentials;
- read-only production diagnostics по установленному runbook без вывода secret values или персональных данных.

Если staging identity, isolation, safety flags, fixture ownership или rollback не доказаны, yellow-действие не выполняется и становится blocker. В Agent OS v0 внешние yellow-действия допустимы только после устранения соответствующих блокеров из `BLOCKERS.md`.

## Red — остановиться и получить явное разрешение Николая

Всегда red:

- merge в `main` или изменение release source;
- production deploy и rollback;
- production migrations и любые production DDL;
- production data insert/update/delete/reconciliation/backfill;
- работа с secret values: создание, чтение, замена, копирование или ротация;
- DNS, TLS и публичная маршрутизация;
- платежи, возвраты, provider activation и реальные финансовые операции;
- любые реальные исходящие сообщения или вызовы внешних провайдеров;
- изменение утверждённого UX, публичного RU copy или продуктового обещания;
- изменение location scoring, SSOT или public score contracts;
- изменение GitHub protection rules, environments, reviewers или repository secrets;
- создание/экспорт production backup либо доступ к его содержимому;
- destructive Git rewrite опубликованной ветки, если он явно не заказан;
- широкие тестовые прогоны за пределами бюджета `AGENTS.md`.

## Что считается разрешением

Разрешение должно быть дано Николаем явно и указывать:

1. конкретное действие;
2. точный target/environment;
3. ref/SHA, migration или идентификатор записи, если применимо;
4. допустимый side effect;
5. ожидаемую проверку после выполнения.

Разрешение действует только на указанное действие в текущем цикле. Значение `confirm_*` в workflow — технический предохранитель, но не доказательство разрешения владельца.

## Обязательный red preflight

Перед запросом разрешения агент готовит, но не выполняет:

- точный plan и команды/workflow inputs;
- доказательство target identity;
- dry-run или read-only preview, если он безопасен;
- ожидаемый diff/data impact;
- rollback и stop conditions;
- список секретов по именам без значений;
- post-action verification;
- ссылку на зелёный CI/acceptance evidence.

## Эскалация и запреты

- Не подменять blocker догадкой.
- Не повторять red-действие по старому разрешению.
- Не печатать secrets в логах или отчёте.
- Не использовать production credential для staging.
- Не считать успешный PR check доказательством deploy или live acceptance.
- При конфликте правил применять более строгий уровень и записывать причину в `BLOCKERS.md`.


## DRAFT #551 — standing release envelope (не вступил в силу)

Предложение не меняет v0, действующие owner gates, main/protection или права служб.
Одна будущая подпись ограничивает repository, target/environment, action-class,
App/installation, policy/security digest, точные разрешённые пути, срок до 14 суток,
нулевой paid API budget, счётчик операций и отзыв. Текущий HEAD и artifact digest
проверяются заново по независимому CI/review; смена HEAD внутри этих границ сама
по себе не требует подписи владельца. Изменение security contract, policy, secrets,
permissions или границ требует отдельного решения. Source, release и activation
не взаимозаменяемы; production не входит в данный проект envelope.

`assessReleaseEnvelopeProposal` в существующем governance-модуле — чистая модель,
не используемая `checkPr`, CI admission или host Authority. Она всегда возвращает
`authorized=false`, включая PROPOSAL_ELIGIBLE. JSON от PR не является доверенным
evidence. Существующие exact-HEAD approvals остаются обязательными.

До защищённого включения необходимы: отдельное утверждение policy digest;
trusted-base verifier с аутентифицированным owner/signed envelope и свежим отзывом;
проверка полного diff без rename hiding, policy/security hash из доверенного base;
связанные с exact HEAD независимые CI/review и artifact evidence; интеграция с
существующим durable claim/Authority (atomic budget reservation + task idempotency);
повторная проверка отзыва непосредственно перед effect. UNKNOWN/FAILED_LOCKED
сохраняются, расход бюджета и срок не сбрасываются при рестарте. Подпись не заменяет
branch protection, environments, fencing, native isolation, rollback и host checks.
Криптографический envelopeDigest должен вычисляться по каноническому payload без
поля самого digest; чистая модель сама не проверяет подпись — disabled adapter ниже
проверяет её отдельно, без предоставления live authority.

Миграция: draft/tests → independent review → отдельное принятие новой policy →
интеграция existing Authority/Verifier и CI → изолированные replay/concurrency tests →
отдельно разрешённый physical acceptance. До этого любые release/install остаются
BLOCKED. Откат будущей политики: прекратить новые claims, сохранить журнал и
UNKNOWN, вернуться к v0; не отзывать/менять ключи неявно.


Draft adapter update: `assessSignedReleaseEnvelopeProposal` использует извлечённую
криптографическую функцию существующего host-authority, с реальной Ed25519-проверкой.
Ключ в production не читается и не создаётся. Подписывается compact JSON payload
без envelopeDigest; повторные ключи/неканоническая сериализация отклоняются,
SHA256 вычисляется по точным подписанным байтам. Это не принятие policy и не live
admission: `authorized=false` всегда. Trusted public key обязан поступать из
защищённой конфигурации; переданный вызывающим кодом ключ не доказывает identity.
Повторное использование подписи при новом HEAD требует новых независимых evidence.
Atomic reservation, свежий отзыв и исчерпывающая проверка security diff по прежнему
не подключены: поля evidence в draft-тестах — fixtures, не provider evidence.


Draft evidence adapter: владелец подписывает fingerprint независимого verifier
(SHA256 SPKI DER) в envelope. Отдельная Ed25519-подпись witness связывает digest
этого envelope с current HEAD/base/artifact, временем, отзывом и бюджетом. Тот же
ключ владельца не может выступать независимым verifier. Проверяется подпись и
binding, но истинность утверждений verifier требует отдельно проверенного
producer; self-signed fixture не является GitHub/provider evidence.
Изолированный тест использует существующий state.execute/ledger: два разных
задания, reopen между ними и отказ третьему при исчерпании бюджета. Нового ledger
нет; это test-only verifier внутри существующего lock, не разрешённая публикация.
До live-интеграции необходимы защищённый key registry, независимый producer,
полный security-diff inventory и атомарное связывание envelope ID с резервами
существующего Publisher. Подписи и source tests сами по себе не открывают release.

Draft witness binds the complete `changedPaths` inventory in the same signature as
HEAD/base/artifact. The adapter rejects a missing or different request inventory
and applies the protected-path gate to the signed list. The protected producer
must derive that list from the trusted complete diff, including both rename paths;
a signature alone still does not prove inventory completeness. No live admission.


### P0 trust boundaries and adoption inventory (DRAFT, 29 October)

All non-governance ASI development is on hold by the current owner task. This
appendix changes no live admission. CODE_PREPARED, GOVERNANCE_ADOPTED and
ENGINE_ENABLED are independent states; none implies the next.

Existing loops and invariants:
- `requiredApproval` / `checkPr`: governance changes require exact-head
  CONTRACT-CHANGE; out-of-stage/legacy exceptions require RELEASE-EXCEPTION.
  These are source exceptions, never merge/deploy grants.
- `verifiedOwnerComment`: authenticated numeric owner identity and exact text;
  agent-authored comments and PR bodies do not count as owner evidence.
- protected-base `pull_request_target`: checkout base only, fetch head as Git
  data; never execute PR scripts with trusted credentials. Required protection
  remains enforced independently of the proposed envelope.
- Native Authority: signed root-owned artifacts, fixed identities/targets,
  expiry and catalog bindings. Publisher: existing durable operation reservations,
  idempotency and unknown-outcome locks; no parallel budget ledger is permitted.

The disabled `assessRepositoryReleaseEnvelopeProposal` now derives the entire
base...head inventory through the existing `prChanges` helper, with rename
recognition disabled (both old and new paths), external diff/text conversion
explicitly disabled. It verifies request SHAs against a separate trusted
comparison and requires exact equality with signed witness paths. Missing objects
fail as ENVELOPE_DIFF_UNAVAILABLE, never signature error. It does not checkout or
execute head content. `trustedComparison` must come from authenticated PR metadata
in the protected base runner and an operator-controlled object store; accepting
that object or repoRoot from PR JSON would destroy this boundary. This producer
seam remains disabled until provenance/configuration and adoption are verified.

Remaining adoption blockers: protected signer registry and authenticated revocation;
trusted numeric executor/reviewer identities and latest non-dismissed exact-head
review; trusted required workflow identity/current attempt/base/head and freshness;
security inventory/digest from protected base; aggregate API/write reservations
bound atomically to the existing Publisher effect under its existing lock.
A caller's PASS string, distinct generated test key or local record count cannot
replace those facts. Authorization still always false. No checkPr bypass is wired.

One policy transition package must pin the final PR552 SHA, policy/security digest,
independent human authorization under v0, trusted issuer/executor/reviewer/workflow
identities, finite scope/budget/expiry, protected configuration provenance, test
receipts and rollback. It must show two different routine HEADs progressing with
one unchanged valid delegation and fresh trusted CI/review, with all out-of-bounds
cases blocked, before claiming adoption. Current protected integration is forbidden
without that verified authority. Rollback stops new admissions while preserving
claims, budget and UNKNOWN; it does not replay effects or reset durable history.

Dependency distinction: PR552 reuses the Publisher intent/readback journal and
state lock. The earlier observation that PR549 was unmerged is historical: the
independent Engine lane integrated it into main at
`f5e64b276786f8427619378d4fa93e71fdc671de`. This proposal preserves that baseline's
fencing, stage policy and host request counter, and reviews its own integration
separately. Source integration is not physical Engine acceptance or standing
policy adoption; this P0 task does not activate or approve the Engine lane.

### Disabled authenticated reader and protected security inventory

`readAuthenticatedProviderSnapshot` now implements the read-only producer for the
existing predicate: fixed GitHub host/repository, authenticated GET only, no
redirects or automatic retry, maximum 11 requests, 30 seconds overall and 5 seconds
per response, 2 MiB per response. Required workflow inventories are complete with
stable counts and unique IDs; ambiguous/truncated pagination blocks. Reviews are
fully paginated within the cap; a newer dismissal/change request supersedes old
approval, and an approval expires after one hour. PR identity/base/head are checked
again after collection. Transport errors never serialize credential/body details.

The protected caller must supply the token, reviewer identity and expected SHAs;
PR JSON is not configuration. The test transport and clock are offline injection
ports, not permission to replace the protected runtime transport. GitHub does not
provide an atomic snapshot across PR/runs/reviews: this observation must be
revalidated before reservation/publication under the existing lock. The current
trusted workflow lacks `actions:read`; installing a reviewed reader and changing
that protected permission is a separately authorized adoption step, not performed
by this draft. No reader call is wired into `checkPr/main`.

`inspectProtectedRepositorySecurity` inventories base and head Git objects without
checkout, including path, mode and object ID. Required policy/workflow/Authority/
Publisher/state/dependency files cannot disappear; symlinks and submodules in the
protected inventory block. All Agent OS, workflow, agent-skill and execution-adapter
paths are outside routine source delegation. The repository adapter requires the
same protected inventory in both trees and compares its actual SHA256 and policy
bytes digest with the signed envelope. This also closes the prior path-pattern
gap for `host-authority.mjs` and `github-publisher.mjs`.

These are source-prepared functions and offline proofs only. The separately
protected issuer/verifier registry and current authenticated revocation source,
Publisher aggregate budget integration and actual trusted workflow adoption are
still incomplete. Do not turn PROVIDER_EVIDENCE_VERIFIED into AUTHORIZED. The
adoption design must also avoid requiring a successful invocation of the same
governance job before that job can admit a routine update; its independent CI and
post-integration acceptance phases must be explicitly reviewed. No new owner
decision is requested while these source integration items remain.


### Draft Publisher phase composition (source only)

The existing Publisher now distinguishes signed `ADMISSION_READ`,
`LOCAL_DELTA_VERIFIED` and `EXACT_HEAD_VERIFIED` proposal evidence. Read admission
before STARTED does not assert a future PR/head or successful future CI. Local
publication evidence binds the actual prepared delta, whole task identity and
independent delta-review receipt. Final evidence binds the published Git HEAD,
complete diff and independently checked provider CI/review. Native evidence is
transaction-bound and does not confer authority; a copied event is invalid.

The isolated standing preview shares the existing execution lock and journal for
all request phases. Request wire identity prevents a new signed envelope from
replaying a previously reserved write. The complete budget history and a durable
clock floor are validated; denial after fsync retains the spent claim. Old
proposal journals missing required wire fields fail closed; this change contains
no live journal migration or reset.

`PROPOSAL_ELIGIBLE` / `RESERVED_PREVIEW` are never `AUTHORIZED`. The preview's
`beforeRequest` remains false, existing Publisher authorization stays mandatory,
and protected-base `checkPr` still enforces v0. Loopback tests with fixture keys
and fixture authority do not adopt delegation. A separately verified policy
transition and trusted enforcement/issuer/verifier configuration are required
before any live standing capability. Stop/rollback preserves claims, revocation
history and UNKNOWN/FAILED_LOCKED; no automatic refund, retry or key change.

Scope clarification (owner override, 29 October 2026): this P0 lane does not
freeze, stop, edit or approve the independent Engine #549 and RU-auth #554
workstreams. Earlier global-freeze wording is superseded; their protected gates
and separate permissions remain mandatory.
