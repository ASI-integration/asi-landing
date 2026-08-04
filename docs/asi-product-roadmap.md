# ASI Product Roadmap Dashboard v1

Наглядная карта готовности ASI для development owner: `/dashboard/roadmap`.

## Source of truth

Единственный version-controlled источник:

- `src/lib/roadmap/asi-product-roadmap.ts`

Типы: `RoadmapStatus`, `RoadmapDepartment`, `RoadmapStage`, `RoadmapEvidence`.

Статусы:

| Статус | Смысл |
|---|---|
| `done` | Реализовано и подтверждено кодом / тестом / UI / docs |
| `in_progress` | Частично есть; нужны ручные шаги или завершение |
| `blocked` | Отсутствует или блокирует полный цикл |
| `later` | После пилотного запуска |

**Нельзя** ставить `done` только из-за типов, таблиц, placeholder, draft intent или одной документации без реализации.

Опционально: `criticalForPilot: true` — этап на ближнем пути к пилоту. Полоса «распределение по статусам» считает **только количество** этапов и не является процентом готовности ASI.

## Доступ

Пункт «План ASI» в левом меню виден только `isDevelopmentOwner` — тот же allowlist, что и «Разработка ASI». Страница обёрнута в `DevelopmentOwnerGuard`.

## Правило актуальности (PR)

Каждый PR, который меняет готовность функции, должен:

1. обновить соответствующий stage в `asi-product-roadmap.ts` (status, currentState, nextStep, evidence, blocker, criticalForPilot), **или**
2. явно объяснить в описании PR, почему статус не изменился.

CI-блокировка для всех PR в v1 **не** добавляется — дисциплина ручная + focused tests на целостность данных.

## Аудит

Поле `ROADMAP_LAST_AUDITED_AT` и `lastReviewedAt` у этапов фиксируют дату ограниченного аудита main. При существенном пересмотре готовности обновите дату.

## Проверки

```bash
npx vitest run src/lib/roadmap src/app/dashboard/roadmap src/app/dashboard/__tests__/layout.sidebar-scroll.test.ts
npm run typecheck
npx eslint src/lib/roadmap src/app/dashboard/roadmap src/app/dashboard/layout.tsx
git diff --check
```
