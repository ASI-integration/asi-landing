# ASI Agent OS v0 — current release

## Machine-readable baseline

Live repository baseline is owned by the CI-generated release manifest:

- `docs/agent-os/generated/release-manifest.json`
- generator: `scripts/agent-os/generate-release-manifest.mjs`
- drift check: `scripts/agent-os/check-release-manifest.mjs`

PR Validation regenerates the canonical manifest from repository state and fails when the committed manifest or this document drift from tracked `HEAD`, package metadata, migration history, or the explicit release gate list in `docs/agent-os/release-gates.json`.

Do not manually maintain baseline SHA, package version, migration count, or active gate inventory in this file. Those values are machine-derived and checked by CI.

Baseline SHA in the manifest is the checked-out source branch state, not a claim about the current production runtime SHA. Production deploy still requires a separate live verification through the approved runbook.

## Текущие продуктовые контуры

- RU-first landing и продуктовые страницы.
- MVP-stable location-модуль с защищёнными scoring/public contracts.
- Booking Ops lifecycle, worker tasks, readiness, communication drafts и операторские сценарии.
- Zero-touch onboarding и canonical reservation/lifecycle convergence, описанные документами OPS v17.
- Отдельные staging и production artifact paths с `/api/health` и `/api/version` проверками.
- Production logical backup workflow с ручным запуском.

Этот список служит навигацией, а не полной спецификацией функций. Детали подтверждаются кодом, tests и соответствующим acceptance-документом.

## Уже существующие gates

| Контур | Что существует |
| --- | --- |
| Локальная разработка | testing budget и protected areas в `AGENTS.md` |
| Pull request | `.github/workflows/pr-validation.yml`: lint, typecheck, фиксированный набор Vitest-тестов, build и artifact smoke |
| Staging | ручной `.github/workflows/deploy-staging.yml`, отдельный GitHub environment name, identity checks, schema smoke, typecheck, build, health/version и optional acceptance |
| Production deploy | ручной `.github/workflows/deploy.yml`, точная фраза подтверждения, build gates, artifact smoke, environment name и SHA health checks |
| Production migrations | три ручных workflow для отдельных Booking migrations с точной фразой подтверждения |
| Production acceptance | несколько ручных workflows; уровень подтверждения и safety contract между ними неодинаков |
| Migration ordering | numeric-prefix и dependency test в `src/lib/__tests__/migration-dependency-order.test.ts` |

Machine-enforced active release gates are listed in `docs/agent-os/release-gates.json` and copied into the generated manifest. Additional operational workflows may exist without being part of the Agent OS release baseline.

## Ограничения baseline

- GitHub API не показал branch protection или rulesets для `main` на момент аудита.
- GitHub API не показал environment protection rules/reviewers, хотя workflows ссылаются на `staging` и `production`.
- `docs/BOOKING_OPS_STAGING_BOOTSTRAP.md` больше не содержит ручной migration count; CI проверяет drift через `scripts/agent-os/check-migration-count-docs.mjs`.
- Migration execution распределён между ordered SQL, прямыми CLI-командами, Python helpers и тремя специализированными production workflows.
- Acceptance scripts различаются по способности писать/удалять данные и по наличию явного confirmation gate.
- До Agent OS v0 не было единого Agent OS контракта, blocker registry и agent-ready GitHub templates.

Актуальный статус пробелов ведётся в `docs/agent-os/BLOCKERS.md`.

## Правило обновления

Обновлять narrative sections этого файла, когда меняются продуктовые контуры, operational context или release-gate semantics. Любое изменение machine-owned baseline fields должно происходить только через `docs/agent-os/release-gates.json`, migration history, package metadata, или regeneration of `docs/agent-os/generated/release-manifest.json` under CI. Не объявлять production SHA без отдельной live-проверки по утверждённому runbook.
