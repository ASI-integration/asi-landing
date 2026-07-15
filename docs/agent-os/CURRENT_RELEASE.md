# ASI Agent OS v0 — current release

## Baseline

Снимок подготовлен 2026-07-15 по tracked-состоянию `origin/main`.

| Поле | Значение |
| --- | --- |
| Репозиторий | `ASI-integration/asi-landing` |
| Source branch | `main` |
| Baseline SHA | `b2cfa055206d9d932ecb8e46004a7fa0ff8d15a3` |
| Package | `landing-asi` |
| Package version | `0.1.0` |
| Production source | `main` + manual artifact deploy |
| Staging source | выбранный SHA/ref + отдельный staging workflow |
| Migration history | 82 tracked SQL-файла в `supabase/migrations/` |

Baseline SHA — это состояние source branch, а не утверждение о текущем production SHA. В рамках Agent OS v0 production не проверялся и не изменялся.

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

## Ограничения baseline

- GitHub API не показал branch protection или rulesets для `main` на момент аудита.
- GitHub API не показал environment protection rules/reviewers, хотя workflows ссылаются на `staging` и `production`.
- `docs/BOOKING_OPS_STAGING_BOOTSTRAP.md` указывает 80 migrations, tracked baseline содержит 82.
- Migration execution распределён между ordered SQL, прямыми CLI-командами, Python helpers и тремя специализированными production workflows.
- Acceptance scripts различаются по способности писать/удалять данные и по наличию явного confirmation gate.
- До этой ветки не было единого Agent OS контракта, blocker registry и agent-ready GitHub templates.

Актуальный статус пробелов ведётся в `docs/agent-os/BLOCKERS.md`.

## Правило обновления

Обновлять этот файл в каждом release PR, который меняет source baseline, активные контуры, migrations или release gates. Не объявлять production SHA без отдельной live-проверки по утверждённому runbook.
