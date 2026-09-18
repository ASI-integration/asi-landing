# ASI Agent OS v0 — Skills proposal

## Статус

Четыре repository-specific Skills установлены в `.agents/skills/`:

- `asi-task-execution` — intake → focused validation → draft PR;
- `asi-staging-acceptance` — isolated staging contract preflight/result; no live staging mutation;
- `asi-production-rollout` — read-only production preflight; no dispatch/mutation;
- `asi-website-editor` — visitor-first RU public-copy review; owner-gated apply; no merge/deploy.

Machine validation:

- `scripts/agent-os/validate-skills.mjs`
- `scripts/agent-os/__tests__/skills.test.mjs`
- PR Validation step `Agent OS contract and project skills validation`

Подробные контракты ссылаются на Agent OS документы и schemas, а не копируют их в каждый Skill.

## 1. `asi-task-execution`

### Trigger description

```yaml
---
name: asi-task-execution
description: Execute agent-ready tasks in ASI-integration/asi-landing from intake through focused validation, exact-path commit, push, and draft PR. Use for repository code, test, documentation, or workflow changes that must follow ASI Agent OS autonomy, testing-budget, protected-area, and blocker rules.
---
```

### Ответственность

- прочитать Issue, `AGENTS.md` и Agent OS contracts;
- определить autonomy level и затронутые seams;
- создать task branch от точного baseline;
- реализовать минимальный patch;
- выбрать focused checks по change-to-test map;
- stage exact paths, commit, push и создать draft PR;
- вернуть стандартный result bundle;
- остановиться перед red-действием.

### Предлагаемые resources

- `references/change-to-test-map.md` — mapping директорий/контрактов к focused tests;
- `references/report-contract.md` — machine-readable поля итогового отчёта;
- `scripts/preflight.ps1` — branch, dirty tree, baseline и protected-path audit;
- `scripts/validate-scope.ps1` — exact `origin/main...HEAD` file allowlist и запрет `tmp/`.

### Forward tests

1. Docs-only задача в грязном worktree не захватывает unrelated files.
2. Lifecycle bug выбирает точные tests и не запускает broad suite.
3. Запрос на UX change останавливается с `AWAITING_OWNER`.

## 2. `asi-staging-acceptance`

### Trigger description

```yaml
---
name: asi-staging-acceptance
description: Prepare and run isolated ASI staging deployment and acceptance with exact SHA, database identity, safety flags, deterministic fixtures, cleanup, and rollback evidence. Use only for staging verification after local checks pass; never use production credentials, real outbound messages, payments, or production targets.
---
```

### Ответственность

- проверить закрытие AO-002/AO-005/AO-008 prerequisites;
- доказать staging host/path/port/database identity без вывода secrets;
- проверить exact SHA и safety flags;
- сначала выполнить read-only preflight/schema smoke;
- запустить deterministic acceptance fixtures;
- доказать отсутствие external actions и выполнить cleanup;
- собрать health/version, acceptance и rollback evidence;
- немедленно остановиться при target mismatch.

### Предлагаемые resources

- `references/staging-contract.md` — fixed targets и safety invariants;
- `references/acceptance-fixtures.md` — ownership, prefixes, TTL и cleanup;
- `scripts/staging-preflight.mjs` — machine-readable JSON preflight;
- `scripts/staging-result.mjs` — единый JSON result с `noExternalActions`.

### Forward tests

1. Неверный project ref останавливает Skill до SSH/data writes.
2. Missing dry-run flag блокирует acceptance.
3. Успешный fixture run оставляет нулевой residue и возвращает exact SHA.

## 3. `asi-production-rollout`

### Trigger description

```yaml
---
name: asi-production-rollout
description: Prepare owner-gated ASI production rollout, migration, reconciliation, rollback, or verification runbooks with exact target and SHA evidence. Use for production operations only after explicit Nikolay approval; default to preflight and stop before every deploy, DDL, data mutation, secret, DNS, payment, or real-message action.
---
```

### Ответственность

- по умолчанию работать в preflight/read-only режиме;
- проверить explicit scoped owner approval для каждого red action;
- доказать repository, target, exact SHA, migration state и record identity;
- выполнить dry-run перед write, если он предусмотрен;
- запускать только canonical workflow/runbook;
- применять stop conditions при любом mismatch;
- после разрешённого действия проверить persisted/runtime state и audit evidence;
- никогда не переносить approval на следующий red action.

### Предлагаемые resources

- `references/production-preflight.md` — required evidence и stop conditions;
- `references/rollout-report.md` — deploy/migration/data result schemas;
- `scripts/verify-release-identity.mjs` — сравнение requested, source и runtime SHA;
- `scripts/red-approval-check.mjs` — локальная проверка полноты approval artifact без secret values.

### Forward tests

1. Без approval Skill выдаёт готовый preflight и `AWAITING_OWNER`, но не dispatch.
2. SHA mismatch прекращает rollout.
3. Разрешение на deploy не разрешает migration или data mutation.

## 4. `asi-website-editor`

### Trigger description

```yaml
---
name: asi-website-editor
description: Review ASI-integration/asi-landing public RU site copy as a first-time visitor, ground findings in approved product/pricing contracts, and (only with an explicit owner-approved public-copy gate) apply the smallest source edit, verify it with the deterministic Website Auditor, and open a draft PR. Use for RU acquisition-page editorial clarity work; never merges or deploys.
---
```

### Ответственность

- прочитать публичный маршрут как посетитель без внутреннего контекста ASI, прежде чем читать implementation source;
- обосновать findings через `docs/agent-os/PRODUCT_CONTRACT.md` и `RU_PUBLIC_SITE_CONTRACT`;
- подготовить edit plan без диктовки точной формулировки owner'у;
- запросить owner-gate через `scripts/preflight.mjs` и остановиться на `AWAITING_OWNER`, если scope/action не совпадает;
- в authorized apply внести минимальное изменение только в allowlisted source;
- проверить изменение deterministic Website Auditor'ом, focused tests, lint и typecheck;
- stage exact paths, commit, push и создать draft PR;
- никогда не merge и не deploy.

### Предлагаемые resources

- `references/editorial-contract.md` — first-time-visitor критерии и claim-safety grounding;
- `references/ru-public-site-map.md` — RU route-to-source mapping и auditor entrypoint;
- `references/result-contract.md` — machine-readable поля review/apply результата;
- `scripts/preflight.mjs` — read-only market/mode/route/owner-gate resolution.

### Forward tests

1. `review` на `/ru` возвращает `READY` и `applyAllowed: false` без owner-gate.
2. `apply` без gate возвращает `AWAITING_OWNER` с предложенным scope, а не готовую формулировку.
3. Gate с другим action/target (например, production-разрешение) блокирует apply — approval атомарен.
4. Валидный совпадающий gate переводит preflight в `READY_TO_APPLY`, но не выполняет edit, commit или merge сам по себе.

## Порядок реализации во второй фазе

1. Ввести machine-readable task preflight/result schemas и единый owner-gate contract.
2. Добавить change-to-test map и реализовать/validate `asi-task-execution`.
3. Провести docs-only пилот, затем отдельный безопасный code-fix пилот.
4. Добавить staging JSON preflight/result и тестировать `asi-staging-acceptance` только на изолированных deterministic fixtures.
5. Реализовать `asi-production-rollout` только в read-only/preflight режиме; любой write path активировать отдельным red-решением Николая.
6. GitHub protection, environment reviewers и repository settings не настраивать без отдельного red-разрешения.
