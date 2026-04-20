# Wave 1 — первая волна реализации (3–4 задачи максимального value)

Контекст: после аудита главный системный bottleneck — **spatial truth для Commercial Location**; параллельно критично закрыть **честность sellable vs demo** для revenue-прокси и **усилить comm safety/observability** как уже зрелый модуль.

---

## Задача 1: Commercial spatial foundation v1 (micro-catchment + barriers stub)

| Поле | Содержание |
|------|------------|
| **Цель** | Ввести в core **явный spatial tier** и минимальную геометрию: штраф за барьеры (вода/ж/д/крупная дорога) + определение «коридора» до ближайшей оси улицы, чтобы магниты «за стеной» не кормили footfall/format-fit без пометки. |
| **Expected impact** | Самый большой **product jump** для commercial standalone: вердикты перестают противоречить здравому смыслу на контрольных «за барьером» кейсах; снижается репутационный риск. |
| **Файлы / контуры** | `src/lib/location/gravity-scoring.ts`, `src/lib/location/overpass.ts` (или отдельный `spatial-barriers.ts`), `src/lib/location/types.ts`, `src/lib/location/standalone-report.ts` (meta `spatial_tier`), `src/components/location/CommercialReportView.tsx`, тесты `src/lib/location/__tests__/*` (новые). |
| **Acceptance criteria** | (1) В типах отчёта есть `spatial_tier: stub|graph|provider`. (2) На **≥3 синтетических layout** (юнит-тест с координатами) барьер снижает вклад дальнего магнита ≥ порога. (3) Если tier=`stub`, format-fit не отображается как «высокая геометрическая уверенность» (копирайт/бейдж). (4) Нет молчаливого изменения legacy residential без флага. |
| **Проверка приближения к ~90%** | Добавление секции в `docs/platform-validation-loop-plan.md` подкреплено **новыми** кейсами в commercial control set; регрессионные инварианты зелёные; explainability JSON содержит `barrier_penalty_applied`. |

---

## Задача 2: Residential + Commercial unified location validation runner

| Поле | Содержание |
|------|------------|
| **Цель** | Один CLI-прогон (на базе существующих `scripts/validate-locations.mjs`, `scripts/commercial-format-fit-validation.ts`), который пишет единый `validation-report.json` с порогами и **кодом выхода** при регрессии. |
| **Expected impact** | Ускорение итераций tuning; **формальный gate** к merge для location core — ключ к 90% по framework. |
| **Файлы / контуры** | `scripts/` (новый orchestrator или расширение существующих), `package.json` script, лёгкая документация в комментарии README **не создавать** отдельно если не просили — достаточно ссылки из wave в validation doc. |
| **Acceptance criteria** | (1) Одна команда запускает residential поднабор + commercial JSON check. (2) Детерминированный output path. (3) Fail при нарушении заданных порогов. (4) Время прогона документировано (fast vs full). |
| **Проверка** | После intentional micro-change в весах — runner ловит отклонение; после «ожидаемого» changelog конфига — pass с обновлённым эталоном через review. |

---

## Задача 3: Communication — knowledge provenance + запрет тихого mock в prod

| Поле | Содержание |
|------|------------|
| **Цель** | Устранить класс ошибок «гость получил выдуманный wifi из PROPERTY_DB» в production-like окружении: явный `source`, env-guard, audit поле. |
| **Expected impact** | Повышает **доверие** и снижает юридический/операционный риск; быстрый выигрыш на пути comm ~90%. |
| **Файлы / контуры** | `src/lib/communication/knowledge.ts`, `src/lib/communication/audit.ts`, `src/lib/communication/orchestrator.ts`, тесты `__tests__`. |
| **Acceptance criteria** | (1) `getGroundedKnowledge` всегда возвращает `source` enum. (2) При `NODE_ENV=production` (или отдельном флаге) mock DB не используется без `ALLOW_MOCK_KNOWLEDGE=1`. (3) Тесты покрывают ветку «нет данных — честный unavailable». |
| **Проверка** | Control set comm расширяется 5 сообщениями про wifi/check-in; audit JSON содержит source; нет регресса в `execution-order` тестах. |

---

## Задача 4 (опционально в рамках Wave 1 если параллельный ресурс): PlatformDecision schema v0 + comm adapter

| Поле | Содержание |
|------|------------|
| **Цель** | Задать **минимальный** кросс-модульный контракт без переписывания orchestrator: типы + маппинг исхода comm в `PlatformDecision`. |
| **Expected impact** | Подготовка почвы для единой оркестрации location/pricing/ops; уменьшение дублирования «решений» в будущем. |
| **Файлы / контуры** | Новый `src/lib/platform/decision.ts` (или схожий путь), тонкий адаптер из `processMessage` outcome, unit tests. |
| **Acceptance criteria** | (1) Zod/schema валидирует объект. (2) Каждый `ProcessOutcome` маппится в decision с `limitations[]`. (3) Нет циклических импортов тяжёлых модулей. |
| **Проверка** | Snapshot тесты JSON; отсутствие влияния на runtime latency (чистые типы + лёгкий mapper). |

---

## Порядок выполнения Wave 1

1. **Задача 1** и **Задача 2** можно вести параллельно (разные ветки), merge после согласования формата `validation-report.json`.  
2. **Задача 3** — независима, рекомендуется merge рано (низкий риск).  
3. **Задача 4** — после стабилизации типов comm outcomes (или параллельно, если команда >1).

---

## Итог Wave 1 относительно цели ~90%

- Location Commercial core: ожидаемый скачок **~48% → ~58–62%** (не 90% — для 90% нужен full graph/provider).  
- Location Residential core: **+validation gate** → **~72–78%** стабильности процесса, не обязательно сдвиг модели.  
- Communication: **+3–5 п.п.** к sellable/core за счёт provenance.  
- Cross-module: задел **+5–8 п.п.** только при задаче 4.
